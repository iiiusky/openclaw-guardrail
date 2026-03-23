"""报告接收 + 查询 + 统计"""

from __future__ import annotations

import json
from typing import Any

from auth import require_admin, require_device_or_admin
from fastapi import APIRouter, Header, HTTPException, Request

from database import get_db, insert_report, verify_device
from models import ReportPayload

router = APIRouter(prefix="/api/v1", tags=["reports"])




@router.post("/openclaw-report")
async def receive_report(
    payload: ReportPayload,
    request: Request,
    authorization: str | None = Header(default=None),
    x_sec_device_id: str | None = Header(default=None, alias="x-sec-device-id"),
):
    require_device_or_admin(authorization)
    client_ip = request.client.host if request.client else ""
    effective_device_id = x_sec_device_id or payload.device_id
    if not verify_device(effective_device_id):
        raise HTTPException(status_code=401, detail="设备未激活")
    payload.device_id = effective_device_id
    report_id = insert_report(payload, client_ip=client_ip)
    return {"status": "ok", "report_id": report_id}


@router.get("/reports")
async def list_reports(
    device_id: str | None = None,
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
        conditions.append("r.device_id = %s")
        params.append(device_id)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    count_params = list(params)
    params.extend([limit, offset])

    cur.execute(
        f"""
        SELECT r.id, r.received_at, r.timestamp, r.device_id, r.openclaw_version, r.os,
               r.scan_type, r.source, COALESCE(d.user_name, '') AS user_name
        FROM reports r
        LEFT JOIN devices d ON r.device_id = d.device_id
        {where}
        ORDER BY r.id DESC LIMIT %s OFFSET %s
        """,
        params,
    )
    rows = cur.fetchall()

    cur.execute(f"SELECT COUNT(*) AS cnt FROM reports r {where}", count_params)
    total_row = cur.fetchone() or {}
    total = total_row.get("cnt", 0) if isinstance(total_row, dict) else 0
    cur.close()
    conn.close()

    return {"total": total, "reports": rows}


@router.get("/reports/{report_id}")
async def get_report(
    report_id: int,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    conn = get_db()
    cur = conn.cursor()

    cur.execute(
        """SELECT r.*, COALESCE(d.user_name, '') AS user_name
           FROM reports r
           LEFT JOIN devices d ON r.device_id = d.device_id
           WHERE r.id = %s""",
        (report_id,),
    )
    row = cur.fetchone()
    if not row:
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail="报告不存在")

    cur.close()
    conn.close()

    report = dict(row)
    report["scan_json"] = json.loads(report.get("scan_json") or "{}")

    return report


@router.get("/stats/capabilities")
async def get_capability_stats(
    days: int = 14,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    conn = get_db()
    cur = conn.cursor()

    cur.execute(
        """SELECT category, COUNT(*) AS total,
                  SUM(CASE WHEN action = 'blocked' THEN 1 ELSE 0 END) AS blocked
           FROM violations
           WHERE received_at >= DATE_SUB(NOW(), INTERVAL %s DAY)
             AND category != ''
           GROUP BY category""",
        (days,),
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()

    result = {}
    for row in rows:
        cat = row.get("category", "") if isinstance(row, dict) else ""
        total = row.get("total", 0) if isinstance(row, dict) else 0
        blocked = row.get("blocked", 0) if isinstance(row, dict) else 0
        if cat:
            result[cat] = {"total": total, "blocked": blocked}

    return {"capabilities": result, "days": days}


@router.get("/stats")
async def get_stats(authorization: str | None = Header(default=None)):
    require_admin(authorization)
    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) AS cnt FROM reports")
    total_reports_row = cur.fetchone() or {}
    total_reports = total_reports_row.get("cnt", 0) if isinstance(total_reports_row, dict) else 0

    cur.execute("SELECT COUNT(DISTINCT device_id) AS cnt FROM reports")
    total_devices_row = cur.fetchone() or {}
    total_devices = total_devices_row.get("cnt", 0) if isinstance(total_devices_row, dict) else 0

    cur.execute(
        """SELECT r.id, r.received_at, r.timestamp, r.device_id, r.openclaw_version,
                  r.scan_type, r.source, COALESCE(d.user_name, '') AS user_name
           FROM reports r
           LEFT JOIN devices d ON r.device_id = d.device_id
           ORDER BY r.id DESC LIMIT 10"""
    )
    recent = cur.fetchall()

    cur.close()
    conn.close()

    return {
        "total_reports": total_reports,
        "total_devices": total_devices,
        "recent_reports": recent,
    }


@router.get("/stats/trend")
async def get_trend_stats(
    days: int = 14,
    authorization: str | None = Header(default=None),
):
    """获取最近 N 天的违规和报告趋势数据"""
    require_admin(authorization)
    conn = get_db()
    cur = conn.cursor()

    # 违规趋势（按天统计）
    cur.execute(
        """SELECT DATE(received_at) AS date, COUNT(*) AS count,
                  SUM(CASE WHEN action = 'blocked' THEN 1 ELSE 0 END) AS blocked,
                  SUM(CASE WHEN action = 'detected' THEN 1 ELSE 0 END) AS detected
           FROM violations
           WHERE received_at >= DATE_SUB(NOW(), INTERVAL %s DAY)
           GROUP BY DATE(received_at)
           ORDER BY date""",
        (days,),
    )
    violation_trend = cur.fetchall()

    # 报告趋势（按天统计）
    cur.execute(
        """SELECT DATE(received_at) AS date, COUNT(*) AS count
           FROM reports
           WHERE received_at >= DATE_SUB(NOW(), INTERVAL %s DAY)
           GROUP BY DATE(received_at)
           ORDER BY date""",
        (days,),
    )
    report_trend = cur.fetchall()

    # 违规 Top 设备
    cur.execute(
        """SELECT device_id, COUNT(*) AS count
           FROM violations
           WHERE received_at >= DATE_SUB(NOW(), INTERVAL %s DAY)
           GROUP BY device_id
           ORDER BY count DESC
           LIMIT 10""",
        (days,),
    )
    top_devices = cur.fetchall()

    # 违规 Top 工具
    cur.execute(
        """SELECT tool_name, COUNT(*) AS count
           FROM violations
           WHERE received_at >= DATE_SUB(NOW(), INTERVAL %s DAY)
           GROUP BY tool_name
           ORDER BY count DESC
           LIMIT 10""",
        (days,),
    )
    top_tools = cur.fetchall()

    # 今日/昨日对比
    cur.execute(
        "SELECT COUNT(*) AS cnt FROM violations WHERE DATE(received_at) = CURDATE()"
    )
    row = cur.fetchone()
    today_violations = row.get("cnt", 0) if isinstance(row, dict) else 0

    cur.execute(
        "SELECT COUNT(*) AS cnt FROM violations "
        "WHERE DATE(received_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)"
    )
    row = cur.fetchone()
    yesterday_violations = row.get("cnt", 0) if isinstance(row, dict) else 0

    cur.execute(
        "SELECT COUNT(*) AS cnt FROM reports WHERE DATE(received_at) = CURDATE()"
    )
    row = cur.fetchone()
    today_reports = row.get("cnt", 0) if isinstance(row, dict) else 0

    # 活跃设备数（最近24小时有资产上报的）
    try:
        cur.execute(
            "SELECT COUNT(*) AS cnt FROM asset_reports "
            "WHERE received_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)"
        )
        row = cur.fetchone()
        active_devices = row.get("cnt", 0) if isinstance(row, dict) else 0
    except Exception:
        active_devices = 0

    cur.close()
    conn.close()

    return {
        "violation_trend": violation_trend,
        "report_trend": report_trend,
        "top_devices": top_devices,
        "top_tools": top_tools,
        "today": {
            "violations": today_violations,
            "yesterday_violations": yesterday_violations,
            "reports": today_reports,
            "active_devices": active_devices,
        },
    }
