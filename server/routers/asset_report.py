"""资产可见性上报 — 接收设备资产信息快照，支持 UPSERT（同 device_id 保留最新）"""

from __future__ import annotations

import json
import uuid
from typing import Any, Sequence

from auth import require_admin, require_device_or_admin
from fastapi import APIRouter, Header, HTTPException, Request

from database import get_db, verify_device
from models import AssetReportPayload

router = APIRouter(prefix="/api/v1", tags=["asset-report"])


def _upsert_skills(cur, device_id: str, skills: Sequence[Any]) -> None:
    current_item_ids: set[str] = set()
    for s in skills:
        name = s if isinstance(s, str) else (s.get("name") or s.get("id") or str(s))
        if not name:
            continue

        cur.execute("SELECT id FROM asset_skills WHERE name = %s", (name,))
        row = cur.fetchone()
        if row:
            item_id = row["id"]
        else:
            item_id = str(uuid.uuid4())
            cur.execute("INSERT INTO asset_skills (id, name) VALUES (%s, %s)", (item_id, name))

        current_item_ids.add(item_id)
        link_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO asset_device_items (id, device_id, item_type, item_id)
               VALUES (%s, %s, 'skill', %s)
               ON DUPLICATE KEY UPDATE updated_at = NOW()""",
            (link_id, device_id, item_id),
        )

    if current_item_ids:
        placeholders = ",".join(["%s"] * len(current_item_ids))
        cur.execute(
            f"DELETE FROM asset_device_items WHERE device_id = %s AND item_type = 'skill' AND item_id NOT IN ({placeholders})",
            (device_id, *current_item_ids),
        )
    else:
        cur.execute("DELETE FROM asset_device_items WHERE device_id = %s AND item_type = 'skill'", (device_id,))


def _upsert_plugins(cur, device_id: str, plugins: Sequence[Any]) -> None:
    current_item_ids: set[str] = set()
    for p in plugins:
        if isinstance(p, str):
            name, version = p, ""
        else:
            name = p.get("name") or p.get("id") or str(p)
            version = p.get("version") or ""

        if not name:
            continue

        cur.execute("SELECT id FROM asset_plugins WHERE name = %s", (name,))
        row = cur.fetchone()
        if row:
            item_id = row["id"]
            cur.execute("UPDATE asset_plugins SET version = %s WHERE id = %s", (version, item_id))
        else:
            item_id = str(uuid.uuid4())
            cur.execute("INSERT INTO asset_plugins (id, name, version) VALUES (%s, %s, %s)", (item_id, name, version))

        current_item_ids.add(item_id)
        link_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO asset_device_items (id, device_id, item_type, item_id)
               VALUES (%s, %s, 'plugin', %s)
               ON DUPLICATE KEY UPDATE updated_at = NOW()""",
            (link_id, device_id, item_id),
        )

    if current_item_ids:
        placeholders = ",".join(["%s"] * len(current_item_ids))
        cur.execute(
            f"DELETE FROM asset_device_items WHERE device_id = %s AND item_type = 'plugin' AND item_id NOT IN ({placeholders})",
            (device_id, *current_item_ids),
        )
    else:
        cur.execute("DELETE FROM asset_device_items WHERE device_id = %s AND item_type = 'plugin'", (device_id,))


def _upsert_providers(cur, device_id: str, providers: Sequence[Any]) -> None:
    current_item_ids: set[str] = set()
    for p in providers:
        if isinstance(p, str):
            name, base_url, detail = p, "", "{}"
        else:
            name = p.get("name") or p.get("id") or str(p)
            base_url = p.get("baseUrl") or p.get("base_url") or ""
            detail = (
                json.dumps(
                    {k: v for k, v in p.items() if k not in ("name", "id", "baseUrl", "base_url")},
                    ensure_ascii=False,
                )
                if isinstance(p, dict)
                else "{}"
            )

        if not name:
            continue

        cur.execute("SELECT id FROM asset_providers WHERE name = %s", (name,))
        row = cur.fetchone()
        if row:
            item_id = row["id"]
            cur.execute("UPDATE asset_providers SET base_url = %s, detail_json = %s WHERE id = %s", (base_url, detail, item_id))
        else:
            item_id = str(uuid.uuid4())
            cur.execute("INSERT INTO asset_providers (id, name, base_url, detail_json) VALUES (%s, %s, %s, %s)", (item_id, name, base_url, detail))

        current_item_ids.add(item_id)
        link_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO asset_device_items (id, device_id, item_type, item_id)
               VALUES (%s, %s, 'provider', %s)
               ON DUPLICATE KEY UPDATE updated_at = NOW()""",
            (link_id, device_id, item_id),
        )

    if current_item_ids:
        placeholders = ",".join(["%s"] * len(current_item_ids))
        cur.execute(
            f"DELETE FROM asset_device_items WHERE device_id = %s AND item_type = 'provider' AND item_id NOT IN ({placeholders})",
            (device_id, *current_item_ids),
        )
    else:
        cur.execute("DELETE FROM asset_device_items WHERE device_id = %s AND item_type = 'provider'", (device_id,))


@router.post("/asset-report")
async def receive_asset_report(
    payload: AssetReportPayload,
    request: Request,
    authorization: str | None = Header(default=None),
    x_sec_device_id: str | None = Header(default=None, alias="x-sec-device-id"),
):
    """接收资产上报（UPSERT：同 device_id 只保留最新快照）"""
    require_device_or_admin(authorization)
    client_ip = request.client.host if request.client else ""
    effective_device_id = x_sec_device_id or payload.device_id
    if not verify_device(effective_device_id):
        raise HTTPException(status_code=401, detail="设备未激活")
    payload.device_id = effective_device_id

    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT id FROM asset_reports WHERE device_id = %s", (payload.device_id,))
    existing = cur.fetchone()

    system = payload.system
    skills_json = json.dumps(payload.skills, ensure_ascii=False)
    plugins_json = json.dumps(payload.plugins, ensure_ascii=False)
    providers_json = json.dumps(payload.providers, ensure_ascii=False)
    gateway_json = json.dumps(payload.gateway, ensure_ascii=False)
    agents_json = json.dumps(payload.agents, ensure_ascii=False)

    if existing:
        cur.execute(
            """UPDATE asset_reports SET
                received_at = NOW(),
                machine_id = %s, client_ip = %s,
                openclaw_version = %s, plugin_version = %s,
                os = %s, hostname = %s, platform = %s, arch = %s, ip = %s,
                skills_json = %s, plugins_json = %s, providers_json = %s,
                gateway_json = %s, agents_json = %s
            WHERE device_id = %s""",
            (
                payload.machine_id,
                client_ip,
                payload.openclaw_version,
                payload.plugin_version,
                f"{system.platform} {system.os_version}",
                system.hostname,
                system.platform,
                system.arch,
                system.ip,
                skills_json,
                plugins_json,
                providers_json,
                gateway_json,
                agents_json,
                payload.device_id,
            ),
        )
    else:
        cur.execute(
            """INSERT INTO asset_reports (
                device_id, machine_id, client_ip,
                openclaw_version, plugin_version,
                os, hostname, platform, arch, ip,
                skills_json, plugins_json, providers_json,
                gateway_json, agents_json
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                payload.device_id,
                payload.machine_id,
                client_ip,
                payload.openclaw_version,
                payload.plugin_version,
                f"{system.platform} {system.os_version}",
                system.hostname,
                system.platform,
                system.arch,
                system.ip,
                skills_json,
                plugins_json,
                providers_json,
                gateway_json,
                agents_json,
            ),
        )

    _upsert_skills(cur, payload.device_id, payload.skills)
    _upsert_plugins(cur, payload.device_id, payload.plugins)
    _upsert_providers(cur, payload.device_id, payload.providers)

    conn.commit()
    cur.close()
    conn.close()

    return {"status": "ok"}


@router.get("/asset-reports")
async def list_asset_reports(
    authorization: str | None = Header(default=None),
):
    """管理员查询所有设备最新资产快照"""
    require_admin(authorization)
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """SELECT id, received_at, device_id, machine_id, openclaw_version,
                  plugin_version, os, hostname, platform, arch, ip,
                  skills_json, plugins_json, providers_json, gateway_json, agents_json
           FROM asset_reports ORDER BY received_at DESC"""
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()

    results = []
    for row in rows:
        item = dict(row)
        for field in ("skills_json", "plugins_json", "providers_json", "gateway_json", "agents_json"):
            try:
                item[field] = json.loads(item.get(field) or "[]")
            except Exception:
                pass
        results.append(item)

    return {"total": len(results), "assets": results}


@router.get("/asset-reports/{device_id}")
async def get_device_asset(
    device_id: str,
    authorization: str | None = Header(default=None),
):
    """查看单个设备的资产详情（含 JSON 字段）"""
    require_admin(authorization)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM asset_reports WHERE device_id = %s", (device_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail=f"设备 {device_id} 无资产记录")

    report = dict(row)
    for field in ("skills_json", "plugins_json", "providers_json", "gateway_json", "agents_json"):
        try:
            report[field] = json.loads(report.get(field) or "[]")
        except Exception:
            pass

    return report


@router.get("/asset-distribution")
async def get_asset_distribution(
    authorization: str | None = Header(default=None),
):
    """资产分布统计 — skills/plugins/providers 各有多少设备在用"""
    require_admin(authorization)
    conn = get_db()
    cur = conn.cursor()

    result: dict[str, list[dict[str, object]]] = {}

    cur.execute(
        """
        SELECT t.id, t.name, COUNT(adi.device_id) AS device_count,
               GROUP_CONCAT(DISTINCT adi.device_id) AS device_ids
        FROM asset_skills t
        LEFT JOIN asset_device_items adi ON t.id = adi.item_id AND adi.item_type = 'skill'
        GROUP BY t.id
        ORDER BY device_count DESC
        """
    )
    skill_rows = cur.fetchall()
    skill_items = []
    for row in skill_rows:
        item = dict(row)
        device_ids_str = item.pop("device_ids", "") or ""
        item["devices"] = [d for d in device_ids_str.split(",") if d] if device_ids_str else []
        skill_items.append(item)
    result["skills"] = skill_items

    cur.execute(
        """
        SELECT t.id, t.name, t.version, COUNT(adi.device_id) AS device_count,
               GROUP_CONCAT(DISTINCT adi.device_id) AS device_ids
        FROM asset_plugins t
        LEFT JOIN asset_device_items adi ON t.id = adi.item_id AND adi.item_type = 'plugin'
        GROUP BY t.id
        ORDER BY device_count DESC
        """
    )
    plugin_rows = cur.fetchall()
    plugin_items = []
    for row in plugin_rows:
        item = dict(row)
        device_ids_str = item.pop("device_ids", "") or ""
        item["devices"] = [d for d in device_ids_str.split(",") if d] if device_ids_str else []
        plugin_items.append(item)
    result["plugins"] = plugin_items

    cur.execute(
        """
        SELECT t.id, t.name, t.base_url, COUNT(adi.device_id) AS device_count,
               GROUP_CONCAT(DISTINCT adi.device_id) AS device_ids
        FROM asset_providers t
        LEFT JOIN asset_device_items adi ON t.id = adi.item_id AND adi.item_type = 'provider'
        GROUP BY t.id
        ORDER BY device_count DESC
        """
    )
    provider_rows = cur.fetchall()
    provider_items = []
    for row in provider_rows:
        item = dict(row)
        device_ids_str = item.pop("device_ids", "") or ""
        item["devices"] = [d for d in device_ids_str.split(",") if d] if device_ids_str else []
        provider_items.append(item)
    result["providers"] = provider_items

    cur.close()
    conn.close()
    return result
