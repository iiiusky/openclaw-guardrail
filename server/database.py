"""MySQL 数据库连接、建表、自动迁移"""

from __future__ import annotations

import json
import logging

import pymysql
import pymysql.cursors

from config import MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB, DEFAULT_POLICY

logger = logging.getLogger("openclaw-guardrail")


def get_db() -> pymysql.Connection:
    return pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DB,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )


# ─── 建表 DDL ───────────────────────────────────────

_TABLE_DDLS = [
    """
    CREATE TABLE IF NOT EXISTS reports (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        received_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        timestamp       VARCHAR(64) NOT NULL,
        device_id       VARCHAR(64) NOT NULL,
        client_ip       VARCHAR(64) NOT NULL DEFAULT '',
        openclaw_version VARCHAR(32) NOT NULL DEFAULT '',
        os              VARCHAR(128) NOT NULL DEFAULT '',
        scan_type       VARCHAR(32) NOT NULL DEFAULT 'all',
        source          VARCHAR(32) NOT NULL DEFAULT 'manual',
        scan_json       MEDIUMTEXT NOT NULL,
        report_markdown MEDIUMTEXT NOT NULL,
        INDEX idx_reports_device (device_id),
        INDEX idx_reports_time (timestamp)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS violations (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        received_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        timestamp       VARCHAR(64) NOT NULL,
        device_id       VARCHAR(64) NOT NULL,
        client_ip       VARCHAR(64) NOT NULL DEFAULT '',
        os              VARCHAR(128) NOT NULL DEFAULT '',
        hostname        VARCHAR(256) NOT NULL DEFAULT '',
        username        VARCHAR(128) NOT NULL DEFAULT '',
        openclaw_version VARCHAR(32) NOT NULL DEFAULT '',
        plugin_version  VARCHAR(32) NOT NULL DEFAULT '',
        session_id      VARCHAR(128) NOT NULL DEFAULT '',
        tool_name       VARCHAR(128) NOT NULL DEFAULT '',
        hook_source     VARCHAR(32) NOT NULL DEFAULT '',
        category        VARCHAR(32) NOT NULL DEFAULT '',
        matched_domain  VARCHAR(256) NOT NULL DEFAULT '',
        matched_keyword VARCHAR(256) NOT NULL DEFAULT '',
        action          VARCHAR(32) NOT NULL DEFAULT 'detected',
        context         TEXT NOT NULL,
        INDEX idx_violations_device (device_id),
        INDEX idx_violations_domain (matched_domain)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS policy_versions (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        version         VARCHAR(16) NOT NULL,
        policy_json     MEDIUMTEXT NOT NULL,
        updated_by      VARCHAR(64) NOT NULL DEFAULT 'admin',
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_pv_version (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS activation_keys (
        `key`       VARCHAR(64) PRIMARY KEY,
        user_name   VARCHAR(128) NOT NULL,
        department  VARCHAR(128) NOT NULL DEFAULT '',
        email       VARCHAR(256) NOT NULL DEFAULT '',
        feishu_id   VARCHAR(128),
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        used_at     DATETIME,
        device_id   VARCHAR(64)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS devices (
        device_id       VARCHAR(64) PRIMARY KEY,
        activation_key  VARCHAR(64) NOT NULL,
        machine_id      VARCHAR(128) NOT NULL DEFAULT '',
        user_name       VARCHAR(128) NOT NULL,
        department      VARCHAR(128) NOT NULL DEFAULT '',
        hostname        VARCHAR(256) NOT NULL DEFAULT '',
        username        VARCHAR(128) NOT NULL DEFAULT '',
        os              VARCHAR(128) NOT NULL DEFAULT '',
        activated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen       DATETIME,
        INDEX idx_devices_user (user_name),
        INDEX idx_devices_machine (machine_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS device_policies (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        device_id   VARCHAR(64) NOT NULL,
        user_name   VARCHAR(128) NOT NULL DEFAULT '',
        department  VARCHAR(128) NOT NULL DEFAULT '',
        policy_json MEDIUMTEXT NOT NULL,
        updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE INDEX idx_device_policy_device (device_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS skills (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        skill_name  VARCHAR(256) NOT NULL,
        source      VARCHAR(64) NOT NULL DEFAULT 'clawhub',
        verdict     VARCHAR(32) NOT NULL DEFAULT 'unknown',
        reason      TEXT NOT NULL,
        detail_json MEDIUMTEXT,
        updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE INDEX idx_skills_name_source (skill_name, source)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS advisories (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        product_name    VARCHAR(128) NOT NULL,
        product_version VARCHAR(64) NOT NULL DEFAULT '',
        response_json   MEDIUMTEXT NOT NULL,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE INDEX idx_advisories_name_ver (product_name, product_version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS asset_reports (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        received_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        device_id       VARCHAR(64) NOT NULL,
        machine_id      VARCHAR(128) NOT NULL DEFAULT '',
        client_ip       VARCHAR(64) NOT NULL DEFAULT '',
        openclaw_version VARCHAR(32) NOT NULL DEFAULT '',
        plugin_version  VARCHAR(32) NOT NULL DEFAULT '',
        os              VARCHAR(128) NOT NULL DEFAULT '',
        hostname        VARCHAR(256) NOT NULL DEFAULT '',
        platform        VARCHAR(32) NOT NULL DEFAULT '',
        arch            VARCHAR(32) NOT NULL DEFAULT '',
        ip              VARCHAR(64) NOT NULL DEFAULT '',
        skills_json     MEDIUMTEXT NOT NULL,
        plugins_json    MEDIUMTEXT NOT NULL,
        providers_json  MEDIUMTEXT NOT NULL,
        gateway_json    VARCHAR(512) NOT NULL DEFAULT '{}',
        agents_json     MEDIUMTEXT NOT NULL,
        INDEX idx_asset_device (device_id),
        INDEX idx_asset_time (received_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS asset_skills (
        id          CHAR(36) PRIMARY KEY,
        name        VARCHAR(256) NOT NULL,
        UNIQUE INDEX idx_asset_skills_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS asset_plugins (
        id          CHAR(36) PRIMARY KEY,
        name        VARCHAR(256) NOT NULL,
        version     VARCHAR(64) NOT NULL DEFAULT '',
        UNIQUE INDEX idx_asset_plugins_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS asset_providers (
        id          CHAR(36) PRIMARY KEY,
        name        VARCHAR(256) NOT NULL,
        base_url    VARCHAR(1024) NOT NULL DEFAULT '',
        detail_json MEDIUMTEXT NOT NULL,
        UNIQUE INDEX idx_asset_providers_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS asset_device_items (
        id          CHAR(36) PRIMARY KEY,
        device_id   VARCHAR(64) NOT NULL,
        item_type   ENUM('skill', 'plugin', 'provider') NOT NULL,
        item_id     CHAR(36) NOT NULL,
        updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE INDEX idx_adi_device_type_item (device_id, item_type, item_id),
        INDEX idx_adi_item (item_id),
        INDEX idx_adi_type (item_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
]

# ─── 自动迁移列表 ───────────────────────────────────

_MIGRATIONS = [
    ("activation_keys", "email", "VARCHAR(256) NOT NULL DEFAULT ''"),
    ("activation_keys", "feishu_id", "VARCHAR(128)"),
    ("violations", "client_ip", "VARCHAR(64) NOT NULL DEFAULT ''"),
    ("reports", "client_ip", "VARCHAR(64) NOT NULL DEFAULT ''"),
    ("reports", "scan_type", "VARCHAR(32) NOT NULL DEFAULT 'all'"),
    ("reports", "source", "VARCHAR(32) NOT NULL DEFAULT 'manual'"),
    ("violations", "hook_source", "VARCHAR(32) NOT NULL DEFAULT ''"),
    ("violations", "category", "VARCHAR(32) NOT NULL DEFAULT ''"),
    ("devices", "machine_id", "VARCHAR(128) NOT NULL DEFAULT ''"),
]


def init_db() -> None:
    """建表 + 自动迁移缺失列"""
    conn = get_db()
    cur = conn.cursor()

    for ddl in _TABLE_DDLS:
        cur.execute(ddl)

    for table, column, definition in _MIGRATIONS:
        cur.execute(
            "SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = %s",
            (MYSQL_DB, table, column),
        )
        count_row = cur.fetchone() or {}
        count = count_row.get("cnt", 0) if isinstance(count_row, dict) else 0
        if count == 0:
            cur.execute(f"ALTER TABLE `{table}` ADD COLUMN `{column}` {definition}")
            logger.info("自动迁移: %s 表新增列 %s", table, column)

    conn.commit()
    cur.close()
    conn.close()

    _init_default_policy()
    logger.info("数据库初始化完成")


def _init_default_policy():
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM policy_versions WHERE version = '1.0.0' LIMIT 1")
        if not cur.fetchone():
            import json as _json
            policy = dict(DEFAULT_POLICY)
            policy["version"] = "1.0.0"
            cur.execute(
                "INSERT INTO policy_versions (version, policy_json, updated_by) VALUES (%s, %s, %s)",
                ("1.0.0", _json.dumps(policy, ensure_ascii=False), "system"),
            )
            conn.commit()
            logger.info("已写入初始策略版本 1.0.0")
    except Exception as e:
        logger.warning(f"策略初始化失败: {e}")
    finally:
        cur.close()
        conn.close()


def get_next_policy_version(conn) -> str:
    cur = conn.cursor()
    cur.execute("SELECT version FROM policy_versions ORDER BY id DESC LIMIT 1")
    row = cur.fetchone()
    cur.close()

    if not row:
        return "1.0.0"

    current = row.get("version", "1.0.0") if isinstance(row, dict) else "1.0.0"
    parts = current.split(".")
    if len(parts) != 3:
        return "1.0.0"

    try:
        x, y, z = int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        return "1.0.0"

    z += 1
    if z > 9:
        z = 0
        y += 1
    if y > 9:
        y = 0
        x += 1

    return f"{x}.{y}.{z}"


def save_policy_version(policy_json: str, updated_by: str = "admin") -> str:
    conn = get_db()
    version = get_next_policy_version(conn)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO policy_versions (version, policy_json, updated_by) VALUES (%s, %s, %s)",
        (version, policy_json, updated_by),
    )
    conn.commit()
    cur.close()
    conn.close()
    return version


def insert_report(payload, client_ip: str = "") -> int:
    """插入扫描报告，返回 report_id"""
    scan_json_dict = payload.scan_json if isinstance(payload.scan_json, dict) else {}
    scan_type = scan_json_dict.get("scan_type", "all")
    source = scan_json_dict.get("source", "manual")

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO reports (
            timestamp, device_id, client_ip, openclaw_version, os,
            scan_type, source, scan_json, report_markdown
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            payload.timestamp,
            payload.device_id,
            client_ip,
            payload.openclaw_version,
            payload.os,
            scan_type,
            source,
            json.dumps(payload.scan_json, ensure_ascii=False),
            payload.report_markdown[:50000],
        ),
    )
    report_id = cur.lastrowid

    conn.commit()
    cur.close()
    conn.close()
    return report_id


def verify_device(device_id: str) -> bool:
    """校验 device_id 是否为已激活设备，并更新 last_seen。使用 Redis 缓存加速。"""
    from cache import redis_get, redis_set
    from config import DEVICE_CACHE_TTL

    if not device_id:
        return False

    cache_key = f"device:{device_id}"
    cached = redis_get(cache_key)
    if cached == "1":
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("UPDATE devices SET last_seen = NOW() WHERE device_id = %s", (device_id,))
            conn.commit()
            cur.close()
            conn.close()
        except Exception:
            pass
        return True
    if cached == "0":
        return False

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT device_id FROM devices WHERE device_id = %s", (device_id,))
    row = cur.fetchone()
    if row:
        cur.execute("UPDATE devices SET last_seen = NOW() WHERE device_id = %s", (device_id,))
        conn.commit()
        redis_set(cache_key, "1", DEVICE_CACHE_TTL)
    else:
        redis_set(cache_key, "0", 60)
    cur.close()
    conn.close()
    return row is not None
