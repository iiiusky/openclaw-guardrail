"""安全策略下发（支持全局 + 设备/用户级覆盖）"""

from __future__ import annotations

import json
from typing import Any

from auth import require_admin, require_device_or_admin
from fastapi import APIRouter, Header, HTTPException

from cache import load_policy, redis_delete, redis_get, redis_set
from config import POLICY_CACHE_TTL
from database import get_db, save_policy_version

router = APIRouter(prefix="/api/v1", tags=["policy"])




def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = dict(base)
    for k, v in override.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = _deep_merge(result[k], v)
        elif k in result and isinstance(result[k], list) and isinstance(v, list):
            merged = list(result[k])
            for item in v:
                if item not in merged:
                    merged.append(item)
            result[k] = merged
        else:
            result[k] = v
    return result


def _load_device_override(device_id: str) -> dict[str, Any] | None:
    cache_key = f"device_policy:{device_id}"
    cached = redis_get(cache_key)
    if cached is not None:
        try:
            return json.loads(cached) if cached else None
        except Exception:
            pass

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT policy_json FROM device_policies WHERE device_id = %s",
        (device_id,),
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    if row:
        policy_json = row.get("policy_json", "{}") if isinstance(row, dict) else "{}"
        override = json.loads(policy_json)
        redis_set(cache_key, json.dumps(override, ensure_ascii=False), POLICY_CACHE_TTL)
        return override

    redis_set(cache_key, "", POLICY_CACHE_TTL)
    return None


@router.get("/policy")
async def get_policy(
    device_id: str | None = None,
    authorization: str | None = Header(default=None),
    x_sec_device_id: str | None = Header(default=None, alias="x-sec-device-id"),
):
    require_device_or_admin(authorization)
    policy = load_policy()

    effective_device_id = x_sec_device_id or device_id
    if effective_device_id:
        override = _load_device_override(effective_device_id)
        if override:
            policy = _deep_merge(policy, override)

    return policy


@router.put("/policy")
async def update_global_policy(
    policy: dict[str, Any],
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    policy_str = json.dumps(policy, ensure_ascii=False)
    new_version = save_policy_version(policy_str)
    policy["version"] = new_version
    redis_delete("policy")
    return {"status": "ok", "version": new_version, "message": f"全局策略已更新 (v{new_version})"}


@router.get("/policy/versions")
async def list_policy_versions(
    authorization: str | None = Header(default=None),
    limit: int = 20,
):
    require_admin(authorization)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT id, version, updated_by, updated_at FROM policy_versions ORDER BY id DESC LIMIT %s", (limit,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return {"versions": rows}


@router.put("/policy/device/{device_id}")
async def update_device_policy(
    device_id: str,
    policy_override: dict[str, Any],
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    conn = get_db()
    cur = conn.cursor()
    policy_json = json.dumps(policy_override, ensure_ascii=False)

    cur.execute(
        """INSERT INTO device_policies (device_id, policy_json)
           VALUES (%s, %s)
           ON DUPLICATE KEY UPDATE policy_json = %s""",
        (device_id, policy_json, policy_json),
    )
    conn.commit()
    cur.close()
    conn.close()

    redis_delete(f"device_policy:{device_id}")
    return {"status": "ok", "message": f"设备 {device_id} 策略已更新"}


@router.get("/policy/device/{device_id}")
async def get_device_policy(
    device_id: str,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    override = _load_device_override(device_id)
    if not override:
        raise HTTPException(status_code=404, detail=f"设备 {device_id} 无自定义策略")
    return override


@router.delete("/policy/device/{device_id}")
async def delete_device_policy(
    device_id: str,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM device_policies WHERE device_id = %s", (device_id,))
    conn.commit()
    cur.close()
    conn.close()
    redis_delete(f"device_policy:{device_id}")
    return {"status": "ok", "message": f"设备 {device_id} 自定义策略已删除"}


@router.get("/policy/devices")
async def list_device_policies(
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT device_id, user_name, department, updated_at FROM device_policies ORDER BY updated_at DESC"
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return {"devices": rows}
