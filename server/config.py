"""全局配置常量"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).parent
PROJECT_ROOT = BASE_DIR.parent
PACKAGES_DIR = BASE_DIR / "packages"

SECRET_FILE = BASE_DIR / "secret.txt"


def _load_admin_key() -> str:
    env_key = os.environ.get("ADMIN_API_KEY", "")
    if env_key:
        return env_key
    if SECRET_FILE.exists():
        stored = SECRET_FILE.read_text().strip()
        if stored:
            return stored
    generated = str(uuid.uuid4())
    SECRET_FILE.write_text(generated + "\n")
    return generated


ADMIN_API_KEY = _load_admin_key()

PLUGIN_REPORT_KEYS = {ADMIN_API_KEY}
# ─── 外部服务 ───────────────────────────────────────

AIG_BASE_URL = "https://matrix.tencent.com/clawscan"
COS_BASE_URL = os.environ.get(
    "COS_PLUGIN_URL",
    "https://your-cos-bucket.cos.ap-beijing.myqcloud.com/openclaw-guardrail",
)

# ─── MySQL ──────────────────────────────────────────

MYSQL_HOST = os.environ.get("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT = int(os.environ.get("MYSQL_PORT", "3306"))
MYSQL_USER = os.environ.get("MYSQL_USER", "root")
MYSQL_PASSWORD = os.environ.get("MYSQL_PASSWORD", "")
MYSQL_DB = os.environ.get("MYSQL_DB", "openclaw_security")

# ─── Redis ──────────────────────────────────────────

REDIS_HOST = os.environ.get("REDIS_HOST", "127.0.0.1")
REDIS_PORT = int(os.environ.get("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.environ.get("REDIS_PASSWORD", "")

REDIS_PREFIX = "openclaw:"
DEVICE_CACHE_TTL = 300       # 设备验证缓存 5 分钟
POLICY_CACHE_TTL = 60        # 策略缓存 1 分钟
SKILL_INTEL_TTL = 10800      # skill 情报 Redis 缓存 3 小时
ADVISORY_TTL = 10800         # 漏洞情报 Redis 缓存 3 小时

# ─── 默认安全策略 ─────────────────────────────────────

DEFAULT_POLICY: dict[str, Any] = {
    "version": "1.0.0",
    "blocked_domains": [
        "example.com",
        "*.example2.com",
    ],
    "sensitive_tools": [
        "WebFetch",
        "WebSearch",
        "Bash",
        "browser_navigate",
        "browser_click",
        "mcp__.*browser",
        "mcp__.*fetch",
    ],
    "sensitive_keywords": [
        "密码", "password", "passwd", "secret", "token",
        "api_key", "apikey", "access_key", "private_key",
        "身份证", "银行卡", "手机号",
        "薪资", "salary", "工资",
        "内网", "vpn", "堡垒机",
        "openclaw",
    ],
    "dangerous_commands": [
        # ── 破坏性操作 ──
        {"pattern": "\\brm\\s+(-[a-zA-Z]*f[a-zA-Z]*\\s+|.*--force\\b)", "category": "destructive", "severity": "block", "description": "强制删除文件 (rm -f/--force)"},
        {"pattern": "\\brm\\s+(-[a-zA-Z]*r[a-zA-Z]*f|rf|-[a-zA-Z]*fr)\\b", "category": "destructive", "severity": "block", "description": "递归强制删除 (rm -rf)"},
        {"pattern": "\\brm\\s+(-[a-zA-Z]*r[a-zA-Z]*\\s+|\\s+--recursive\\b).*(\\s+/\\s*$|\\s+/[a-z]*\\s|\\s+~\\s|\\s+\\$HOME\\b)", "category": "destructive", "severity": "block", "description": "递归删除根目录或家目录"},
        {"pattern": "\\bmkfs\\b", "category": "destructive", "severity": "block", "description": "格式化磁盘 (mkfs)"},
        {"pattern": "\\bdd\\s+.*\\bof=/dev/", "category": "destructive", "severity": "block", "description": "dd 写入设备"},
        {"pattern": ">\\s*/dev/[sh]d[a-z]", "category": "destructive", "severity": "block", "description": "重定向写入磁盘设备"},
        {"pattern": ":\\(\\)\\{ :\\|:& \\};:", "category": "destructive", "severity": "block", "description": "Fork bomb"},
        # ── 数据外发（curl/wget） ──
        {"pattern": "\\bcurl\\b.*\\s+(-d\\s|--data\\b|-F\\s|--form\\b|-T\\s|--upload-file\\b|--data-binary\\b|--data-raw\\b|--data-urlencode\\b)", "category": "exfiltration", "severity": "block", "description": "curl 外发数据 (POST/上传)"},
        {"pattern": "\\bcurl\\b.*\\|\\s*bash", "category": "exfiltration", "severity": "block", "description": "curl pipe to bash (远程代码执行)"},
        {"pattern": "\\bwget\\b.*--post-(data|file)\\b", "category": "exfiltration", "severity": "block", "description": "wget POST 外发数据"},
        # ── 数据外发（ftp/scp/rsync/nc） ──
        {"pattern": "\\bftp\\b.*\\bput\\b", "category": "exfiltration", "severity": "block", "description": "FTP 上传文件"},
        {"pattern": "\\bsftp\\b", "category": "exfiltration", "severity": "warn", "description": "SFTP 文件传输"},
        {"pattern": "\\bscp\\b.*\\s+\\S+@\\S+:", "category": "exfiltration", "severity": "block", "description": "SCP 外发文件"},
        {"pattern": "\\brsync\\b.*\\s+\\S+@\\S+:", "category": "exfiltration", "severity": "block", "description": "rsync 外发数据到远程"},
        {"pattern": "\\bnc\\b.*\\s+-[a-zA-Z]*[lp]", "category": "exfiltration", "severity": "block", "description": "netcat 网络传输"},
        {"pattern": "\\bncat\\b", "category": "exfiltration", "severity": "block", "description": "ncat 网络传输"},
        # ── 反弹 Shell ──
        {"pattern": "\\bbash\\s+-i\\s+>&?\\s*/dev/tcp/", "category": "reverse_shell", "severity": "block", "description": "Bash 反弹 shell (/dev/tcp)"},
        {"pattern": "\\bnc\\b.*\\s+-e\\s+(/bin/(ba)?sh|cmd)", "category": "reverse_shell", "severity": "block", "description": "nc 反弹 shell"},
        {"pattern": "\\bpython[23]?\\b.*\\bsocket\\b.*\\bconnect\\b", "category": "reverse_shell", "severity": "block", "description": "Python 反弹 shell"},
        {"pattern": "\\bperl\\b.*\\bsocket\\b.*\\bINET\\b", "category": "reverse_shell", "severity": "block", "description": "Perl 反弹 shell"},
        {"pattern": "\\bruby\\b.*\\bTCPSocket\\b", "category": "reverse_shell", "severity": "block", "description": "Ruby 反弹 shell"},
        {"pattern": "\\bphp\\b.*\\bfsockopen\\b", "category": "reverse_shell", "severity": "block", "description": "PHP 反弹 shell"},
        {"pattern": "\\bmkfifo\\b.*\\bnc\\b", "category": "reverse_shell", "severity": "block", "description": "mkfifo + nc 反弹 shell"},
        {"pattern": "/dev/tcp/\\d+\\.\\d+\\.\\d+\\.\\d+/\\d+", "category": "reverse_shell", "severity": "block", "description": "/dev/tcp 反弹连接"},
        {"pattern": "\\bsocat\\b.*\\bexec\\b", "category": "reverse_shell", "severity": "block", "description": "socat 反弹 shell"},
        # ── 提权 / 权限篡改 ──
        {"pattern": "\\bsudo\\s+su\\b", "category": "privilege_escalation", "severity": "warn", "description": "sudo 提权"},
        {"pattern": "\\bchmod\\s+[0-7]*777\\b", "category": "privilege_escalation", "severity": "warn", "description": "chmod 777 全开权限"},
        {"pattern": "\\bchmod\\s+[+]?[ugo]*[+]s\\b", "category": "privilege_escalation", "severity": "block", "description": "chmod +s 设置 SUID/SGID"},
        {"pattern": "\\bpasswd\\b", "category": "privilege_escalation", "severity": "warn", "description": "修改密码"},
        {"pattern": "\\buseradd\\b", "category": "privilege_escalation", "severity": "warn", "description": "添加用户"},
        # ── 凭证窃取 ──
        {"pattern": "\\bcat\\b.*\\.(ssh/|aws/|gnupg/|env|netrc|npmrc|pypirc)", "category": "credential_theft", "severity": "block", "description": "读取凭证文件"},
        {"pattern": "\\bcat\\b.*/etc/(shadow|passwd|sudoers)\\b", "category": "credential_theft", "severity": "block", "description": "读取系统敏感文件"},
        {"pattern": "\\bexport\\b.*\\b(API_KEY|SECRET|TOKEN|PASSWORD|AWS_SECRET)\\b.*\\bcurl\\b", "category": "credential_theft", "severity": "block", "description": "导出凭证并外发"},
        # ── 持久化 / 后门 ──
        {"pattern": "\\bcrontab\\b.*-[lr]?\\s*$", "category": "persistence", "severity": "warn", "description": "修改 crontab"},
        {"pattern": ">>?\\s*~?/?\\. bashrc\\b", "category": "persistence", "severity": "warn", "description": "写入 .bashrc"},
        {"pattern": ">>?\\s*~?/?\\. ssh/authorized_keys\\b", "category": "persistence", "severity": "block", "description": "写入 SSH authorized_keys"},
        # ── DNS / 隧道 ──
        {"pattern": "\\bdig\\b.*\\+short\\b.*\\bTXT\\b", "category": "exfiltration", "severity": "warn", "description": "DNS TXT 记录查询（疑似 DNS 隧道）"},
        {"pattern": "\\bnslookup\\b.*\\b[a-f0-9]{16,}\\.", "category": "exfiltration", "severity": "block", "description": "DNS 隧道外发数据"},
    ],
    "protected_files": [
        "openclaw\\.json(\\.bak)?$",
        "openclaw\\.jsonc(\\.bak)?$",
        "\\.openclaw/config(\\.json)?(\\.bak)?$",
        "\\.openclaw/settings(\\.json)?(\\.bak)?$",
    ],
    "contacts": "王五",
    "scan_interval_hours": 4,
}

TRUSTED_SKILLS = {
    "openclaw-agent-scan",
    "openclaw-guardrail",
}

# ─── 插件版本（从 package.json 读取，单一版本源） ────

def _read_plugin_version() -> str:
    pkg = PROJECT_ROOT / "openclaw-guardrail-plugin" / "package.json"
    try:
        return json.loads(pkg.read_text())["version"]
    except Exception:
        return "0.0.0"

def get_marketplace_registry() -> dict[str, dict[str, Any]]:
    """动态生成注册表，版本号每次实时读取（发版无需重启服务）"""
    return {
        "openclaw-guardrail": {
            "id": "openclaw-guardrail",
            "name": "openclaw-guardrail",
            "description": "域名黑名单注入、工具/消息审计、DLP扫描、Skill供应链审计、定时扫描上报",
            "version": _read_plugin_version(),
            "type": "plugin",
            "source_dir": "openclaw-guardrail-plugin",
        },
    }
