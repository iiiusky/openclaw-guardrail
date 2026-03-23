"""违规记录上报 + 查询"""

from __future__ import annotations

import json
from typing import Any

from auth import require_admin, require_device_or_admin
from fastapi import APIRouter, Header, HTTPException, Request

from database import get_db, verify_device

router = APIRouter(prefix="/api/v1", tags=["violations"])




@router.post("/violations")
async def receive_violation(
    request: Request,
    authorization: str | None = Header(default=None),
    x_sec_device_id: str | None = Header(default=None, alias="x-sec-device-id"),
):
    require_device_or_admin(authorization)
    body: dict[str, Any] = await request.json()

    client_ip = request.client.host if request.client else ""
    device_id = x_sec_device_id or body.get("device_id", "")
    if not verify_device(device_id):
        raise HTTPException(status_code=401, detail="设备未激活")

    raw_context = str(body.get("context", "") or "").strip()
    context = raw_context
    if not context:
        tool = str(body.get("tool_name", "") or "unknown")
        matched_domain = str(body.get("matched_domain", "") or "")
        matched_keyword = str(body.get("matched_keyword", "") or "")
        action = str(body.get("action", "detected") or "detected")
        context = f"tool={tool}; action={action}; domain={matched_domain}; keyword={matched_keyword}"

    hook_source = str(body.get("hook_source", "") or "")
    category = str(body.get("category", "") or "")

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO violations (timestamp, device_id, client_ip, os, hostname, username,
           openclaw_version, plugin_version, session_id, tool_name, hook_source, category,
           matched_domain, matched_keyword, action, context)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (body.get("timestamp", ""), device_id, client_ip, body.get("os", ""),
         body.get("hostname", ""), body.get("username", ""),
         body.get("openclaw_version", ""), body.get("plugin_version", ""),
         body.get("session_id", ""), body.get("tool_name", ""), hook_source, category,
         body.get("matched_domain", ""), body.get("matched_keyword", ""),
         body.get("action", "detected"), context),
    )
    conn.commit()
    cur.close()
    conn.close()
    return {"status": "ok"}


@router.get("/violations")
async def list_violations(
    device_id: str | None = None,
    domain: str | None = None,
    action: str | None = None,
    limit: int = 50,
    offset: int = 0,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    conn = get_db()
    cur = conn.cursor()

    conditions: list[str] = []
    params: list[Any] = []
    if device_id:
        conditions.append("v.device_id = %s")
        params.append(device_id)
    if domain:
        conditions.append("v.matched_domain LIKE %s")
        params.append(f"%{domain}%")
    if action:
        conditions.append("v.action = %s")
        params.append(action)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    count_params = list(params)
    params.extend([limit, offset])

    cur.execute(
        f"""SELECT v.*, COALESCE(d.user_name, '') AS user_name
            FROM violations v
            LEFT JOIN devices d ON v.device_id = d.device_id
            {where} ORDER BY v.id DESC LIMIT %s OFFSET %s""", params
    )
    rows = cur.fetchall()

    cur.execute(f"SELECT COUNT(*) AS cnt FROM violations v {where}", count_params)
    total_row = cur.fetchone() or {}
    total = total_row.get("cnt", 0) if isinstance(total_row, dict) else 0
    cur.close()
    conn.close()

    return {"total": total, "violations": rows}
