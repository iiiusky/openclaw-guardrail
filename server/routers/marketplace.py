"""Marketplace 插件/Skill 分发 + 版本发布"""

from __future__ import annotations

import io
import json
import tarfile
from typing import Any

from auth import require_admin, require_device_or_admin
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from config import COS_BASE_URL, get_marketplace_registry, PROJECT_ROOT, PACKAGES_DIR

router = APIRouter(prefix="/api/v1", tags=["marketplace"])




def build_tarball(source_dir_name: str) -> io.BytesIO:
    """将源目录打成 tgz 包"""
    src = PROJECT_ROOT / source_dir_name
    if not src.exists():
        pre_built = PACKAGES_DIR / f"{source_dir_name}.tgz"
        if pre_built.exists():
            buf = io.BytesIO(pre_built.read_bytes())
            buf.seek(0)
            return buf
        raise FileNotFoundError(f"源目录不存在: {src}")

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for item in src.rglob("*"):
            if item.is_file():
                rel = item.relative_to(src)
                parts = rel.parts
                if any(p in ("node_modules", ".git", "__pycache__", "dist") for p in parts):
                    continue
                # 跳过 macOS 扩展属性文件
                if rel.name.startswith("._"):
                    continue
                info = tar.gettarinfo(str(item), arcname=str(rel))
                # 清除 uid/gid，避免 Linux 端 "suspicious ownership" 警告
                info.uid = info.gid = 0
                info.uname = info.gname = "root"
                with open(str(item), "rb") as fh:
                    tar.addfile(info, fh)
    buf.seek(0)
    return buf


@router.get("/marketplace/plugins")
async def marketplace_list(
    type: str | None = None,
    authorization: str | None = Header(default=None),
):
    """列出 marketplace 中可用的插件和 skill"""
    
    items = list(get_marketplace_registry().values())
    if type:
        items = [i for i in items if i.get("type") == type]
    return {
        "plugins": [
            {k: v for k, v in item.items() if k != "source_dir"}
            for item in items
        ]
    }


@router.get("/marketplace/plugins/{plugin_id:path}/metadata")
async def marketplace_metadata(
    plugin_id: str,
    authorization: str | None = Header(default=None),
):
    """获取单个插件/skill 的元数据"""
    
    entry = get_marketplace_registry().get(plugin_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"未找到: {plugin_id}")
    return {k: v for k, v in entry.items() if k != "source_dir"}


@router.get("/marketplace/plugins/{plugin_id:path}/download")
async def marketplace_download(
    plugin_id: str,
    authorization: str | None = Header(default=None),
):
    """下载插件/skill 的 tgz 包"""
    
    entry = get_marketplace_registry().get(plugin_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"未找到: {plugin_id}")

    try:
        buf = build_tarball(entry["source_dir"])
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    filename = f"{plugin_id.replace('/', '-').replace('@', '')}.tgz"
    return StreamingResponse(
        buf,
        media_type="application/gzip",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


import httpx as _httpx


def _fetch_cos_version_json(cos_base: str) -> dict[str, Any]:
    """从 COS 拉取 version.json"""
    try:
        resp = _httpx.get(f"{cos_base}/version.json", timeout=5)
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return {}


@router.get("/plugin-release")
async def plugin_release(request: Request):
    """返回最新插件版本和下载地址，供 install_plugin.sh 使用"""
    base = str(request.base_url).rstrip("/")
    cos = COS_BASE_URL.rstrip("/")
    cos_info = _fetch_cos_version_json(cos)
    # version 和 sha256 都从 COS 的 version.json 读取，保证一致
    version = cos_info.get("version", "0.0.0")
    sha256 = cos_info.get("sha256", "")
    result: dict[str, Any] = {
        "version": version,
        "download_url": f"{cos}/openclaw-guardrail-plugin-v{version}.tgz",
        "download_url_latest": f"{cos}/openclaw-guardrail-plugin.tgz",
        "server_url": base,
        "cos_base_url": cos,
    }
    if sha256:
        result["sha256"] = sha256
    return JSONResponse(content=result, headers={
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
    })
