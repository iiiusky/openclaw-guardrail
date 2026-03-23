"""Redis 缓存工具"""

from __future__ import annotations

import json
import logging
from typing import Any

import redis

from config import (
    REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_PREFIX,
    POLICY_CACHE_TTL, DEFAULT_POLICY,
    MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB,
)

logger = logging.getLogger("openclaw-guardrail")

_redis_client: redis.Redis | None = None
_redis_disabled = False
_policy_mem_cache: dict[str, Any] | None = None


def get_redis() -> redis.Redis | None:
    global _redis_client, _redis_disabled
    if _redis_disabled:
        return None
    if _redis_client is None:
        if not REDIS_HOST:
            _redis_disabled = True
            logger.info("REDIS_HOST 未配置，跳过 Redis")
            return None
        try:
            _redis_client = redis.Redis(
                host=REDIS_HOST,
                port=REDIS_PORT,
                password=REDIS_PASSWORD or None,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
            _redis_client.ping()
        except Exception as e:
            logger.warning(f"Redis 连接失败，已禁用: {e}")
            _redis_disabled = True
            _redis_client = None
            return None
    return _redis_client


def redis_get(key: str) -> str | None:
    try:
        client = get_redis()
        if not client:
            return None
        value = client.get(f"{REDIS_PREFIX}{key}")
        return value if isinstance(value, str) else None
    except Exception:
        return None


def redis_set(key: str, value: str, ttl: int = 300) -> None:
    try:
        client = get_redis()
        if client:
            client.setex(f"{REDIS_PREFIX}{key}", ttl, value)
    except Exception:
        pass


def redis_delete(key: str) -> None:
    try:
        client = get_redis()
        if client:
            client.delete(f"{REDIS_PREFIX}{key}")
    except Exception:
        pass


def load_policy() -> dict[str, Any]:
    global _policy_mem_cache

    cached = redis_get("policy")
    if cached:
        try:
            return json.loads(cached)
        except Exception:
            pass

    try:
        import pymysql
        import pymysql.cursors
        db_conn = pymysql.connect(
            host=MYSQL_HOST, port=MYSQL_PORT, user=MYSQL_USER,
            password=MYSQL_PASSWORD, database=MYSQL_DB,
            charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=3, read_timeout=3,
        )
        cur = db_conn.cursor()
        cur.execute("SELECT version, policy_json FROM policy_versions ORDER BY id DESC LIMIT 1")
        row = cur.fetchone()
        cur.close()
        db_conn.close()
        if row and row.get("policy_json"):
            policy = json.loads(row["policy_json"])
            policy["version"] = row.get("version", "1.0.0")
            _policy_mem_cache = policy
            redis_set("policy", json.dumps(policy, ensure_ascii=False), POLICY_CACHE_TTL)
            return policy
    except Exception as e:
        logger.debug(f"从 MySQL 加载策略失败: {e}")

    if _policy_mem_cache:
        return _policy_mem_cache

    policy = dict(DEFAULT_POLICY)
    policy.setdefault("version", "1.0.0")
    _policy_mem_cache = policy
    return policy
