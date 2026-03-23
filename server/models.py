"""Pydantic 数据模型"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ReportPayload(BaseModel):
    version: str = "2.0"
    timestamp: str
    device_id: str
    openclaw_version: str = ""
    os: str = ""
    scan_json: dict[str, Any] = {}
    report_markdown: str = ""


class SystemInfo(BaseModel):
    platform: str = ""
    arch: str = ""
    os_version: str = ""
    hostname: str = ""
    ip: str = ""


class AssetReportPayload(BaseModel):
    device_id: str
    machine_id: str = ""
    plugin_version: str = ""
    openclaw_version: str = ""
    system: SystemInfo = SystemInfo()
    skills: list[dict[str, Any]] = []
    plugins: list[dict[str, Any]] = []
    providers: list[dict[str, Any]] = []
    gateway: dict[str, Any] = {}
    agents: list[dict[str, Any]] = []
