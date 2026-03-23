"""LLM 内容安全检查 — 基于服务端策略的 prompt/response 审查"""

from __future__ import annotations

import re
from typing import Any

from auth import require_device_or_admin
from fastapi import APIRouter, Header, Request

from cache import load_policy

router = APIRouter(prefix="/api/v1", tags=["llm-check"])


def _domain_match(text: str, pattern: str) -> str | None:
    regex = re.compile(
        pattern.replace(".", r"\.").replace("*", r"[\w.-]*"),
        re.IGNORECASE,
    )
    m = regex.search(text)
    return m.group(0) if m else None


def _keyword_match(text: str, keywords: list[str]) -> str | None:
    if not keywords:
        return None
    escaped = [re.escape(k) for k in keywords]
    pattern = re.compile(f"({'|'.join(escaped)})", re.IGNORECASE)
    m = pattern.search(text)
    return m.group(0) if m else None


@router.post("/llm-check")
async def check_llm_content(
    request: Request,
    direction: str = "req",
    authorization: str | None = Header(default=None),
):
    """检查 LLM 请求/响应内容是否命中安全策略。"""
    _ = direction
    require_device_or_admin(authorization)
    body: dict[str, Any] = await request.json()
    content = body.get("content", "")
    url = body.get("url", "")

    if not content and not url:
        return {"action": "pass", "content": ""}

    policy = load_policy()
    text_to_check = f"{url} {content}" if url else content

    for domain_pattern in policy.get("blocked_domains", []):
        match = _domain_match(text_to_check, domain_pattern)
        if match:
            return {"action": "block", "content": f"安全策略已拦截: 受保护域名 {match}"}

    for rule in policy.get("dangerous_commands", []):
        pattern_str = rule.get("pattern", "")
        severity = rule.get("severity", "warn")
        if severity != "block":
            continue
        try:
            if re.search(pattern_str, text_to_check, re.IGNORECASE):
                return {
                    "action": "block",
                    "content": f"安全策略已拦截: {rule.get('description', '高危命令')}",
                }
        except re.error:
            pass

    keywords = policy.get("sensitive_keywords", [])
    kw_match = _keyword_match(text_to_check, keywords)
    if kw_match:
        return {"action": "hint", "content": f"⚠️ 内容包含敏感关键字: {kw_match}"}

    return {"action": "pass", "content": ""}
