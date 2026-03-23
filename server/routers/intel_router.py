"""Skill 情报 + 漏洞情报（数据库优先，远程兜底）"""

from __future__ import annotations

import json

import httpx
from auth import require_admin, require_device_or_admin
from fastapi import APIRouter, Header

from cache import redis_set
from config import AIG_BASE_URL, SKILL_INTEL_TTL, ADVISORY_TTL, TRUSTED_SKILLS
from database import get_db

router = APIRouter(prefix="/api/v1", tags=["intel"])




@router.get("/skill-security")
async def skill_security(
    skill_name: str,
    source: str = "clawhub",
    authorization: str | None = Header(default=None),
):
    require_device_or_admin(authorization)

    if skill_name in TRUSTED_SKILLS:
        return {"verdict": "safe", "skill_name": skill_name, "source": source, "reason": "trusted"}

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT verdict, reason, detail_json FROM skills WHERE skill_name = %s AND source = %s",
        (skill_name, source),
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    if row:
        detail = {}
        try:
            detail = json.loads(row.get("detail_json") or "{}") if isinstance(row, dict) else {}
        except Exception:
            detail = {}
        data = {
            "verdict": row.get("verdict", "unknown") if isinstance(row, dict) else "unknown",
            "skill_name": skill_name,
            "source": source,
            "reason": row.get("reason", "") if isinstance(row, dict) else "",
            "detail": detail,
        }
        redis_set(f"skill_intel:{skill_name}:{source}", json.dumps(data, ensure_ascii=False), SKILL_INTEL_TTL)
        return data

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{AIG_BASE_URL}/skill_security",
                params={"skill_name": skill_name, "source": source},
            )
            if resp.status_code == 200:
                data = resp.json()
                data["skill_name"] = skill_name
                data["source"] = source
                conn = get_db()
                cur = conn.cursor()
                cur.execute(
                    """INSERT INTO skills (skill_name, source, verdict, reason, detail_json)
                       VALUES (%s, %s, %s, %s, %s)
                       ON DUPLICATE KEY UPDATE verdict = %s, reason = %s, detail_json = %s""",
                    (
                        skill_name,
                        source,
                        str(data.get("verdict", "unknown")),
                        str(data.get("reason", "")),
                        json.dumps(data.get("detail", data), ensure_ascii=False),
                        str(data.get("verdict", "unknown")),
                        str(data.get("reason", "")),
                        json.dumps(data.get("detail", data), ensure_ascii=False),
                    ),
                )
                conn.commit()
                cur.close()
                conn.close()
                redis_set(f"skill_intel:{skill_name}:{source}", json.dumps(data, ensure_ascii=False), SKILL_INTEL_TTL)
                return data
    except Exception:
        pass

    return {"verdict": "unknown", "skill_name": skill_name, "source": source, "reason": "AIG 不可达"}


@router.get("/advisories")
async def advisories(
    name: str,
    version: str = "",
    authorization: str | None = Header(default=None),
):
    require_device_or_admin(authorization)

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT response_json FROM advisories WHERE product_name = %s AND product_version = %s",
        (name, version),
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    if row:
        try:
            data = json.loads(row.get("response_json") or "{}") if isinstance(row, dict) else {}
            redis_set(f"advisory:{name}:{version}", json.dumps(data, ensure_ascii=False), ADVISORY_TTL)
            return data
        except Exception:
            pass

    params: dict[str, str] = {"name": name}
    if version:
        params["version"] = version

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{AIG_BASE_URL}/advisories", params=params)
            if resp.status_code == 200:
                data = resp.json()
                conn = get_db()
                cur = conn.cursor()
                cur.execute(
                    """INSERT INTO advisories (product_name, product_version, response_json)
                       VALUES (%s, %s, %s)
                       ON DUPLICATE KEY UPDATE response_json = %s""",
                    (
                        name,
                        version,
                        json.dumps(data, ensure_ascii=False),
                        json.dumps(data, ensure_ascii=False),
                    ),
                )
                conn.commit()
                cur.close()
                conn.close()
                redis_set(f"advisory:{name}:{version}", json.dumps(data, ensure_ascii=False), ADVISORY_TTL)
                return data
    except Exception:
        pass

    return {"advisories": [], "message": "AIG 不可达"}
