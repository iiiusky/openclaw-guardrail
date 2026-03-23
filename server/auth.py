from __future__ import annotations

from fastapi import HTTPException

from config import ADMIN_API_KEY


def require_admin(authorization: str | None) -> None:
    if not authorization:
        raise HTTPException(status_code=401, detail="缺少 Authorization header")
    token = authorization.strip()
    lower = token.lower()
    if lower.startswith("bearer "):
        token = token[7:].strip()
    if token != ADMIN_API_KEY:
        raise HTTPException(status_code=403, detail="无效的管理密钥")


def require_device_or_admin(authorization: str | None) -> None:
    if not authorization:
        return
    token = authorization.strip()
    lower = token.lower()
    if lower.startswith("bearer "):
        token = token[7:].strip()
    if token == ADMIN_API_KEY:
        return
