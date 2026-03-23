#!/usr/bin/env python3
"""OpenClaw 企业安全管理 CLI（精简版）"""

from __future__ import annotations

import argparse
import os
import sys

import httpx

_base_url = os.environ.get("SERVER_URL", "http://127.0.0.1:80")
_admin_key = os.environ.get("ADMIN_KEY", "")
CLIENT_TIMEOUT = 10.0


def api(method: str, path: str, **kwargs) -> dict:
    headers = kwargs.pop("headers", {})
    if _admin_key:
        headers["Authorization"] = f"Bearer {_admin_key}"
    with httpx.Client(base_url=_base_url, timeout=CLIENT_TIMEOUT, headers=headers) as c:
        resp = getattr(c, method)(path, **kwargs)
        resp.raise_for_status()
        return resp.json()


def _build_key_indexes() -> tuple[dict[str, dict], dict[str, dict], dict[str, list[dict]], dict[str, list[dict]]]:
    data = api("get", "/api/v1/keys")
    keys = data.get("keys", [])
    by_device: dict[str, dict] = {}
    by_key: dict[str, dict] = {}
    by_user: dict[str, list[dict]] = {}
    by_email: dict[str, list[dict]] = {}
    for k in keys:
        key_val = k.get("key", "")
        dev = k.get("device_id") or ""
        user = (k.get("user_name") or "").strip()
        email = (k.get("email") or "").strip().lower()
        if key_val:
            by_key[key_val] = k
        if dev:
            by_device[dev] = k
        if user:
            by_user.setdefault(user, []).append(k)
        if email:
            by_email.setdefault(email, []).append(k)
    return by_device, by_key, by_user, by_email


def cmd_keys_generate(args: argparse.Namespace) -> None:
    count = max(1, int(getattr(args, "count", 1) or 1))
    generated: list[dict] = []
    for _ in range(count):
        generated.append(
            api(
                "post",
                "/api/v1/keys",
                json={
                    "user_name": args.user,
                    "department": args.dept or "",
                    "email": args.email or "",
                    "feishu_id": args.feishu_id or None,
                },
            )
        )

    print(f"✅ 已生成 {len(generated)} 个激活 key:\n")
    for r in generated:
        print(f"  {r['key']}  ({r.get('user_name', '')}  {r.get('department', '')}  {r.get('email', '')})")


def cmd_keys_list(args: argparse.Namespace) -> None:
    data = api("get", "/api/v1/keys")
    keys = data.get("keys", [])
    print(f"激活 Key (共 {len(keys)} 个)\n")
    if not keys:
        print("  暂无")
        return

    print(f"{'Key':<24}  {'用户':<12}  {'邮箱':<24}  {'状态':<12}  {'设备 ID':<16}")
    print("─" * 110)
    for k in keys:
        status = f"已激活 {str(k.get('used_at', ''))[:10]}" if k.get("used_at") else "未使用"
        device = (k.get("device_id") or "—")[:14]
        print(
            f"{k['key']:<24}  {k.get('user_name', ''):<12}  {k.get('email', '')[:22]:<24}  {status:<12}  {device:<16}"
        )


def cmd_keys_revoke(args: argparse.Namespace) -> None:
    data = api("delete", f"/api/v1/keys/{args.key}")
    print(f"✅ {data.get('message', '已吊销')}")


def cmd_keys_reset(args: argparse.Namespace) -> None:
    data = api("post", f"/api/v1/keys/{args.key}/reset")
    print(f"✅ {data.get('message', '已重置')}")


def cmd_keys_activate(args: argparse.Namespace) -> None:
    body = {
        "key": args.key,
        "hostname": args.hostname or "manual-activate",
        "username": args.username or "manual",
        "os": args.os or "manual",
    }
    data = api("post", "/api/v1/activate", json=body)
    print("✅ 激活成功")
    print(f"  设备 ID: {data.get('device_id', '')}")
    print(f"  用户:    {data.get('user_name', '')}")
    print(f"  部门:    {data.get('department', '')}")


def _print_report_detail(report_id: int) -> None:
    report = api("get", f"/api/v1/reports/{report_id}")
    print(f"\n═══ 报告 #{report.get('id')} ═══")
    print(f"设备: {report.get('device_id', '')}")
    print(f"时间: {report.get('timestamp', '')}")
    print(f"OpenClaw: {report.get('openclaw_version', '')}")
    print(f"OS: {report.get('os', '')}")

    scan = report.get("scan_json") or {}
    if scan:
        print("\nscan_json:")
        print(scan)

    md = report.get("report_markdown") or ""
    if md:
        print("\nreport_markdown:")
        print(md)


def cmd_reports(args: argparse.Namespace) -> None:
    if args.report_id:
        _print_report_detail(args.report_id)
        return

    params: dict = {"limit": args.limit}
    if args.device:
        params["device_id"] = args.device

    data = api("get", "/api/v1/reports", params=params)
    reports = data.get("reports", [])
    total = data.get("total", len(reports))

    by_device, by_key, by_user, by_email = _build_key_indexes()

    if args.activation_key:
        match = by_key.get(args.activation_key)
        if not match:
            reports = []
        else:
            reports = [r for r in reports if r.get("device_id") == match.get("device_id")]

    if args.user:
        user_keys = by_user.get(args.user, [])
        user_devices = {k.get("device_id") for k in user_keys if k.get("device_id")}
        reports = [r for r in reports if r.get("device_id") in user_devices]

    if args.email:
        email_keys = by_email.get(args.email.strip().lower(), [])
        email_devices = {k.get("device_id") for k in email_keys if k.get("device_id")}
        reports = [r for r in reports if r.get("device_id") in email_devices]

    print(f"报告列表 (服务端总数 {total}，当前筛选后 {len(reports)} 条)\n")
    if not reports:
        print("  暂无报告")
        return

    print(f"{'Idx':>3}  {'ID':>5}  {'时间':<20}  {'设备':<38}  {'用户':<12}  {'邮箱':<24}")
    print("─" * 120)
    for i, r in enumerate(reports, start=1):
        device_id = r.get("device_id", "")
        key_info = by_device.get(device_id, {})
        print(
            f"{i:>3}  {r.get('id', 0):>5}  {str(r.get('timestamp', ''))[:19]:<20}  {device_id[:36]:<38}  "
            f"{str(key_info.get('user_name', ''))[:10]:<12}  {str(key_info.get('email', ''))[:22]:<24}"
        )

    if args.pick:
        try:
            sel = input("\n输入要查看详情的 Idx（回车跳过）: ").strip()
        except EOFError:
            sel = ""
        if sel:
            try:
                idx = int(sel)
                if 1 <= idx <= len(reports):
                    _print_report_detail(int(reports[idx - 1].get("id", 0)))
                else:
                    print("⚠️  索引超出范围")
            except ValueError:
                print("⚠️  请输入数字")


def main() -> None:
    global _base_url, _admin_key
    parser = argparse.ArgumentParser(prog="manage", description="OpenClaw 企业安全管理 CLI")
    parser.add_argument("--server", default=_base_url, help=f"服务地址 (默认 {_base_url})")
    parser.add_argument("--admin-key", default=_admin_key, dest="admin_key", help="管理密钥 (也可通过 ADMIN_KEY 环境变量设置)")
    sub = parser.add_subparsers(dest="command")

    p_keys = sub.add_parser("keys", help="激活 Key 管理")
    p_keys_sub = p_keys.add_subparsers(dest="keys_action")

    p_keys_gen = p_keys_sub.add_parser("generate", help="生成激活 key")
    p_keys_gen.add_argument("--user", required=True, help="用户姓名/工号")
    p_keys_gen.add_argument("--dept", default="", help="部门")
    p_keys_gen.add_argument("--email", default="", help="邮箱")
    p_keys_gen.add_argument("--feishu-id", default="", help="飞书 ID")
    p_keys_gen.add_argument("--count", type=int, default=1, help="生成数量")

    p_keys_sub.add_parser("list", help="查看激活 key 列表")

    p_keys_revoke = p_keys_sub.add_parser("revoke", help="吊销 key")
    p_keys_revoke.add_argument("key", help="要吊销的 key")

    p_keys_reset = p_keys_sub.add_parser("reset", help="重置 key")
    p_keys_reset.add_argument("key", help="要重置的 key")

    p_keys_activate = p_keys_sub.add_parser("activate", help="手动激活 key（创建设备）")
    p_keys_activate.add_argument("key", help="激活 key")
    p_keys_activate.add_argument("--hostname", default="", help="主机名")
    p_keys_activate.add_argument("--username", default="", help="用户名")
    p_keys_activate.add_argument("--os", default="", help="操作系统")

    p_reports = sub.add_parser("reports", help="报告列表/详情")
    p_reports.add_argument("report_id", nargs="?", type=int, help="报告 ID（填了就直接看详情）")
    p_reports.add_argument("--device", help="按设备 ID 过滤")
    p_reports.add_argument("--activation-key", help="按激活码过滤")
    p_reports.add_argument("--user", help="按用户过滤")
    p_reports.add_argument("--email", help="按邮箱过滤")
    p_reports.add_argument("--limit", type=int, default=100, help="拉取条数")
    p_reports.add_argument("--pick", action="store_true", help="列表后交互选择查看详情")

    args = parser.parse_args()
    _base_url = args.server
    _admin_key = args.admin_key

    if not args.command:
        parser.print_help()
        return

    try:
        if args.command == "keys":
            action = getattr(args, "keys_action", None)
            if action == "generate":
                cmd_keys_generate(args)
            elif action == "revoke":
                cmd_keys_revoke(args)
            elif action == "reset":
                cmd_keys_reset(args)
            elif action == "activate":
                cmd_keys_activate(args)
            else:
                cmd_keys_list(args)
        elif args.command == "reports":
            cmd_reports(args)
    except httpx.ConnectError:
        print("❌ 无法连接服务，请确认服务已启动: uv run serve", file=sys.stderr)
        sys.exit(1)
    except httpx.HTTPStatusError as e:
        print(f"❌ API 错误: {e.response.status_code} {e.response.text}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
