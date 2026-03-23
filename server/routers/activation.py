"""设备激活 + Key 管理"""

from __future__ import annotations

import secrets
import uuid
import json
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request

from cache import redis_delete, redis_set, load_policy
from config import DEVICE_CACHE_TTL
from database import get_db
from auth import require_admin

router = APIRouter(prefix="/api/v1", tags=["activation"])


def generate_activation_key() -> str:
    """生成 24 位激活 key: CG-XXXX-XXXX-XXXX-XXXX"""
    raw = secrets.token_hex(8).upper()
    return f"CG-{raw[:4]}-{raw[4:8]}-{raw[8:12]}-{raw[12:16]}"


@router.post("/activate")
async def activate_device(request: Request):
    body: dict[str, Any] = await request.json()
    key = body.get("key", "").strip()
    machine_id = body.get("machine_id", "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="缺少 key 参数")

    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT * FROM activation_keys WHERE `key` = %s", (key,))
    row = cur.fetchone()
    if not row:
        cur.close()
        conn.close()
        raise HTTPException(status_code=403, detail="激活 key 无效")

    if row["used_at"] is not None:
        existing_device_id = row.get("device_id", "")
        if existing_device_id and machine_id:
            cur.execute("SELECT * FROM devices WHERE device_id = %s", (existing_device_id,))
            device_row = cur.fetchone()
            if device_row and device_row.get("machine_id", "") == machine_id:
                cur.execute("UPDATE devices SET hostname = %s, username = %s, os = %s, last_seen = NOW() WHERE device_id = %s",
                    (body.get("hostname", ""), body.get("username", ""), body.get("os", ""), existing_device_id))
                conn.commit()
                cur.close()
                conn.close()
                redis_set(f"device:{existing_device_id}", "1", DEVICE_CACHE_TTL)
                return {
                    "status": "ok",
                    "device_id": existing_device_id,
                    "user_name": row["user_name"],
                    "message": "同一设备重新激活",
                }
        cur.close()
        conn.close()
        raise HTTPException(status_code=403, detail=f"此 key 已被使用（激活时间: {row['used_at']}）。如需在新设备上使用请联系管理员重置。")

    device_id = str(uuid.uuid4())

    cur.execute(
        """INSERT INTO devices (device_id, activation_key, machine_id, user_name, department, hostname, username, os)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (device_id, key, machine_id, row["user_name"], row.get("department", ""),
         body.get("hostname", ""), body.get("username", ""), body.get("os", "")),
    )

    cur.execute(
        "UPDATE activation_keys SET used_at = NOW(), device_id = %s WHERE `key` = %s",
        (device_id, key),
    )

    cur.execute(
        """INSERT INTO device_policies (device_id, user_name, department, policy_json)
           VALUES (%s, %s, %s, '{}')
           ON DUPLICATE KEY UPDATE user_name = %s, department = %s""",
        (device_id, row["user_name"], row.get("department", ""), row["user_name"], row.get("department", "")),
    )
    conn.commit()
    cur.close()
    conn.close()

    redis_set(f"device:{device_id}", "1", DEVICE_CACHE_TTL)

    return {
        "status": "ok",
        "device_id": device_id,
        "user_name": row["user_name"],
    }


@router.get("/devices")
async def list_devices(authorization: str | None = Header(default=None)):
    """查询已激活设备列表"""
    require_admin(authorization)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM devices ORDER BY activated_at DESC")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return {"devices": rows}


@router.post("/keys")
async def create_key(
    request: Request,
    authorization: str | None = Header(default=None),
):
    """生成激活 key"""
    require_admin(authorization)
    body: dict[str, Any] = await request.json()
    user_name = body.get("user_name", "").strip()
    if not user_name:
        raise HTTPException(status_code=400, detail="缺少 user_name")

    key = generate_activation_key()
    department = body.get("department", "")
    email = body.get("email", "")
    feishu_id = body.get("feishu_id") or None

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO activation_keys (`key`, user_name, department, email, feishu_id) VALUES (%s, %s, %s, %s, %s)",
        (key, user_name, department, email, feishu_id),
    )
    conn.commit()
    cur.close()
    conn.close()

    return {"key": key, "user_name": user_name, "department": department, "email": email, "feishu_id": feishu_id}


@router.get("/keys")
async def list_keys(authorization: str | None = Header(default=None)):
    """查询所有激活 key"""
    require_admin(authorization)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM activation_keys ORDER BY created_at DESC")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return {"keys": rows}


@router.delete("/keys/{key}")
async def revoke_key(
    key: str,
    authorization: str | None = Header(default=None),
):
    """吊销激活 key（同时移除关联设备）"""
    require_admin(authorization)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM activation_keys WHERE `key` = %s", (key,))
    row = cur.fetchone()
    if not row:
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail="key 不存在")

    if row["device_id"]:
        cur.execute("DELETE FROM devices WHERE device_id = %s", (row["device_id"],))
        cur.execute("DELETE FROM device_policies WHERE device_id = %s", (row["device_id"],))
        redis_delete(f"device:{row['device_id']}")
    cur.execute("DELETE FROM activation_keys WHERE `key` = %s", (key,))
    conn.commit()
    cur.close()
    conn.close()

    return {"message": f"已吊销 key: {key}"}


@router.post("/keys/{key}/reset")
async def reset_key(
    key: str,
    authorization: str | None = Header(default=None),
):
    """重置激活 key 为待激活状态（清除关联设备，可重新使用）"""
    require_admin(authorization)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM activation_keys WHERE `key` = %s", (key,))
    row = cur.fetchone()
    if not row:
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail="key 不存在")

    if row["used_at"] is None:
        cur.close()
        conn.close()
        return {"message": f"key 尚未使用，无需重置", "key": key}

    # 删除关联设备 + 清除缓存
    if row["device_id"]:
        cur.execute("DELETE FROM devices WHERE device_id = %s", (row["device_id"],))
        cur.execute("DELETE FROM device_policies WHERE device_id = %s", (row["device_id"],))
        redis_delete(f"device:{row['device_id']}")

    # 重置 key 状态
    cur.execute(
        "UPDATE activation_keys SET used_at = NULL, device_id = NULL WHERE `key` = %s",
        (key,),
    )
    conn.commit()
    cur.close()
    conn.close()

    return {"message": f"已重置 key: {key}，可重新激活", "key": key, "user_name": row["user_name"]}


@router.post("/auth/verify")
async def verify_auth(
    authorization: str | None = Header(default=None),
):
    """验证 Admin API Key 是否有效"""
    if not authorization:
        raise HTTPException(status_code=401, detail="缺少 Authorization header")
    token = authorization.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    from config import ADMIN_API_KEY
    if token != ADMIN_API_KEY:
        raise HTTPException(status_code=403, detail="无效的管理密钥")
    return {"status": "ok", "message": "认证成功"}
