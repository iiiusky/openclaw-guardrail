#!/usr/bin/env bash
# OpenClaw 安全围栏插件 — 一键安装/升级
#
# 用法:
#   curl -sL <COS地址>/install.sh | KEY=<激活key> bash
#   curl -sL <COS地址>/install.sh | KEY=<激活key> SERVER=http://10.0.1.100:9720 bash
#
# 环境变量:
#   KEY     — 激活 key（必填，由管理员通过 manage keys generate 生成）
#   SERVER  — 安全服务地址（优先级：环境变量 > 脚本内置 > 默认值）
set -eo pipefail

# ── Debug 模式 ──
DEBUG="${DEBUG:-false}"
AUTO_RESTART="${AUTO_RESTART:-false}"
# 支持 --debug / --autoRestart 参数
for arg in "$@"; do
  [[ "$arg" == "--debug" ]] && DEBUG=true
  [[ "$arg" == "--autoRestart" ]] && AUTO_RESTART=true
done
debug() { [[ "$DEBUG" == "true" || "$DEBUG" == "TRUE" || "$DEBUG" == "1" ]] && echo "  [debug] $*" || true; }

json_val() {
  node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(d['$2']||'')}catch{}" <<< "$1" 2>/dev/null || echo ""
}
json_file_val() {
  node -e "try{const d=JSON.parse(require('fs').readFileSync('$1','utf-8'));console.log(d['$2']||'')}catch{}" 2>/dev/null || echo ""
}

# ── OpenClaw 调用模式检测 ──
CALL_METHOD="global"

is_openclaw_globally_installed() {
  command -v openclaw &>/dev/null && openclaw --version &>/dev/null
}

is_openclaw_locally_installed() {
  command -v pnpm &>/dev/null && pnpm openclaw --version &>/dev/null 2>&1
}

run_openclaw() {
  if [[ "$CALL_METHOD" == "global" ]]; then
    openclaw "$@"
  else
    pnpm openclaw "$@"
  fi
}

# __DEFAULT_SERVER__ 会在 package.sh 打包时被替换为实际地址
BUILTIN_SERVER="__DEFAULT_SERVER__"
# 如果没被替换过（开发环境直接运行），用默认值
if [[ "$BUILTIN_SERVER" == "__DEFAULT"*"__" ]]; then
  BUILTIN_SERVER="http://127.0.0.1:9720"
fi
# 环境变量优先
SERVER="${SERVER:-$BUILTIN_SERVER}"
KEY="${KEY:-}"

PLUGIN_ID="openclaw-guardrail"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

echo "OpenClaw Guardrail 安装"
debug "安全服务: $SERVER"

# 检查激活 key
PLUGIN_CONFIG_FILE="$HOME/.openclaw/plugin-configs/openclaw-guardrail.json"
EXISTING_DEVICE_ID=""
DEVICE_ID=""
USER_NAME=""
SERVER_FROM_CFG=""
if [ -f "$PLUGIN_CONFIG_FILE" ]; then
  EXISTING_DEVICE_ID=$(json_file_val "$PLUGIN_CONFIG_FILE" "device_id")
fi

if [ -z "$KEY" ] && [ -z "$EXISTING_DEVICE_ID" ]; then
  echo ""
  echo "❌ 缺少激活 key（首次安装必须提供）"
  echo "   请联系信息安全团队管理员获取激活 key，然后执行:"
  echo "   curl -sL <COS地址>/install.sh | KEY=你的key bash"
  exit 1
fi

if is_openclaw_globally_installed; then
  CALL_METHOD="global"
  debug "OpenClaw (全局): $(openclaw --version 2>/dev/null || echo 'found')"
elif is_openclaw_locally_installed; then
  CALL_METHOD="local"
  debug "OpenClaw (pnpm 局部): $(pnpm openclaw --version 2>/dev/null || echo 'found')"
else
  echo "❌ 未找到 openclaw 命令（全局或 pnpm 局部均未检测到）"
  echo "   请先安装 OpenClaw"
  exit 1
fi

debug ""
debug "── 激活设备 ──"

if [ -n "$EXISTING_DEVICE_ID" ]; then
  debug "设备已激活（升级模式），设备 ID: ${EXISTING_DEVICE_ID:0:12}..."
  DEVICE_ID="$EXISTING_DEVICE_ID"
  USER_NAME=$(json_file_val "$PLUGIN_CONFIG_FILE" "user_name")
  USER_NAME="${USER_NAME:-}"
  SERVER_FROM_CFG=$(json_file_val "$PLUGIN_CONFIG_FILE" "server_url")
  SERVER_FROM_CFG="${SERVER_FROM_CFG:-}"
  if [ -n "$SERVER_FROM_CFG" ] && [ "$SERVER" = "$BUILTIN_SERVER" ]; then
    SERVER="$SERVER_FROM_CFG"
    debug "从已有配置读取服务地址: $SERVER"
  fi
else
  MACHINE_ID=""
  if [[ "$(uname -s)" == "Darwin" ]]; then
    RAW_ID=$(/usr/sbin/ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | grep IOPlatformUUID | sed 's/.*"\(.*\)"/\1/')
  elif [ -f /etc/machine-id ]; then
    RAW_ID=$(cat /etc/machine-id 2>/dev/null)
  elif [ -f /var/lib/dbus/machine-id ]; then
    RAW_ID=$(cat /var/lib/dbus/machine-id 2>/dev/null)
  fi
  if [ -n "$RAW_ID" ]; then
    MACHINE_ID=$(echo -n "$RAW_ID" | sha256sum 2>/dev/null | cut -d' ' -f1 || echo -n "$RAW_ID" | shasum -a 256 2>/dev/null | cut -d' ' -f1 || echo "")
    MACHINE_ID="${MACHINE_ID:0:32}"
  fi
  debug "machine_id: ${MACHINE_ID:0:12}..."

  ACTIVATE_RESP=$(curl -sf -X POST "$SERVER/api/v1/activate" \
    -H "Content-Type: application/json" \
    -d "{\"key\":\"$KEY\",\"machine_id\":\"$MACHINE_ID\",\"hostname\":\"$(hostname)\",\"username\":\"$(whoami)\",\"os\":\"$(uname -s) $(uname -r)\"}" \
    2>/dev/null || echo "")

  debug "激活响应: $ACTIVATE_RESP"

  if [ -z "$ACTIVATE_RESP" ]; then
    echo "❌ 无法连接安全服务: $SERVER"
    echo "   请确认服务地址正确: SERVER=http://你的地址:9720 KEY=$KEY bash install.sh"
    exit 1
  fi

  DEVICE_ID=$(json_val "$ACTIVATE_RESP" "device_id")
  USER_NAME=$(json_val "$ACTIVATE_RESP" "user_name")

  if [ -z "$DEVICE_ID" ]; then
    ERROR_MSG=$(json_val "$ACTIVATE_RESP" "detail")
    echo "❌ 激活失败: ${ERROR_MSG:-未知错误}"
    echo "   请检查 key 是否正确，或联系信息安全团队管理员"
    exit 1
  fi

  debug "激活成功（用户: $USER_NAME）"
  debug "设备 ID: $DEVICE_ID"
fi

# ── 获取版本信息 ──
debug ""
debug "── 检查版本 ──"

VERSION_INFO=$(curl -sf -H "Cache-Control: no-cache" "$SERVER/api/v1/plugin-release" 2>/dev/null || echo "")
debug "版本信息响应: $VERSION_INFO"
if [ -z "$VERSION_INFO" ]; then
  echo "❌ 无法获取版本信息"
  exit 1
fi

REMOTE_VERSION=$(json_val "$VERSION_INFO" "version")
DOWNLOAD_URL=$(json_val "$VERSION_INFO" "download_url")

if [ -z "$REMOTE_VERSION" ]; then
  echo "❌ 无法获取版本号"
  exit 1
fi
debug "最新版本: $REMOTE_VERSION"

if [ -z "$DOWNLOAD_URL" ]; then
  DOWNLOAD_URL="$SERVER/api/v1/marketplace/plugins/openclaw-guardrail/download"
fi
debug "下载地址: $DOWNLOAD_URL"

# 检查本地是否已安装
LOCAL_VERSION=""
DEST_DIR="$HOME/.openclaw/extensions/openclaw-guardrail"
if [ -f "$DEST_DIR/package.json" ]; then
  LOCAL_VERSION=$(json_file_val "$DEST_DIR/package.json" "version")
fi

if [ -n "$LOCAL_VERSION" ]; then
  debug "本地版本: $LOCAL_VERSION"
  if [ "$LOCAL_VERSION" = "$REMOTE_VERSION" ]; then
    echo "✓ 已是最新版本 ($LOCAL_VERSION)"
  else
    echo "✓ 升级: $LOCAL_VERSION → $REMOTE_VERSION"
  fi
else
  debug "未检测到已安装版本，执行全新安装"
fi

# 写入设备配置
debug ""
debug "── 写入设备配置 ──"
PLUGIN_CONFIG_DIR="$HOME/.openclaw/plugin-configs"
mkdir -p "$PLUGIN_CONFIG_DIR"
cat > "$PLUGIN_CONFIG_DIR/openclaw-guardrail.json" <<EOF
{
  "server_url": "$SERVER",
  "device_id": "$DEVICE_ID",
  "user_name": "$USER_NAME"
}
EOF
debug "配置文件: $PLUGIN_CONFIG_DIR/openclaw-guardrail.json"

# 拉取策略写入本地
POLICY_FILE="$PLUGIN_CONFIG_DIR/openclaw-guardrail-policy.json"
POLICY_RESP=$(curl -sf -H "x-sec-device-id: $DEVICE_ID" "$SERVER/api/v1/policy" 2>/dev/null || echo "")
if [ -n "$POLICY_RESP" ] && echo "$POLICY_RESP" | node -e "try{JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));process.exit(0)}catch{process.exit(1)}" 2>/dev/null; then
  echo "$POLICY_RESP" > "$POLICY_FILE"
  POLICY_VER=$(echo "$POLICY_RESP" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(d.version||'')}catch{}" 2>/dev/null || echo "")
  debug "策略已写入本地 (v${POLICY_VER:-unknown})"
else
  debug "策略拉取失败，插件启动时将使用内置兜底策略"
fi

# 如果版本相同，到这里就结束
if [ -n "$LOCAL_VERSION" ] && [ "$LOCAL_VERSION" = "$REMOTE_VERSION" ]; then
  echo ""
  echo "✅ 完成（版本无变化，设备配置已更新）"
  exit 0
fi

# 下载插件包
debug ""
debug "── 下载插件 v$REMOTE_VERSION ──"
PLUGIN_TGZ="$TMP_DIR/plugin.tgz"
if ! curl -sfL "$DOWNLOAD_URL" -o "$PLUGIN_TGZ" 2>/dev/null || [ ! -s "$PLUGIN_TGZ" ]; then
  # 带版本号的 tgz 不存在，尝试无版本号的兼容地址
  FALLBACK_URL=$(json_val "$VERSION_INFO" "download_url_latest")
  if [ -n "$FALLBACK_URL" ]; then
    debug "版本化地址不可用，尝试: $FALLBACK_URL"
    curl -sfL "$FALLBACK_URL" -o "$PLUGIN_TGZ" 2>/dev/null || true
  fi
fi
if [ ! -s "$PLUGIN_TGZ" ]; then
  echo "❌ 插件下载失败"
  debug "下载地址: $DOWNLOAD_URL"
  exit 1
fi
debug "下载文件大小: $(du -h "$PLUGIN_TGZ" 2>/dev/null | cut -f1)"
debug "已下载"

# 校验 sha256
EXPECTED_SHA256=$(json_val "$VERSION_INFO" "sha256")
if [ -n "$EXPECTED_SHA256" ]; then
  debug "服务端 sha256: $EXPECTED_SHA256"
  if command -v shasum &>/dev/null; then
    ACTUAL_SHA256=$(shasum -a 256 "$PLUGIN_TGZ" | awk '{print $1}')
  elif command -v sha256sum &>/dev/null; then
    ACTUAL_SHA256=$(sha256sum "$PLUGIN_TGZ" | awk '{print $1}')
  else
    ACTUAL_SHA256=""
    debug "未找到 shasum/sha256sum，跳过校验"
  fi
  if [ -n "$ACTUAL_SHA256" ]; then
    debug "本地文件 sha256: $ACTUAL_SHA256"
    if [ "$ACTUAL_SHA256" = "$EXPECTED_SHA256" ]; then
      debug "sha256 校验通过"
    else
      echo "❌ sha256 校验失败！文件可能被篡改"
      echo "   期望: $EXPECTED_SHA256"
      echo "   实际: $ACTUAL_SHA256"
      exit 1
    fi
  fi
else
  debug "服务端未返回 sha256，跳过校验"
fi

# 解压
PLUGIN_DIR="$TMP_DIR/plugin"
mkdir -p "$PLUGIN_DIR"
debug "解压到: $PLUGIN_DIR"
if ! tar xzf "$PLUGIN_TGZ" --no-same-owner -C "$PLUGIN_DIR" 2>/dev/null && \
   ! tar xzf "$PLUGIN_TGZ" -C "$PLUGIN_DIR" 2>/dev/null; then
  echo "❌ 解压失败"
  debug "tgz 文件: $PLUGIN_TGZ ($(file "$PLUGIN_TGZ" 2>/dev/null))"
  exit 1
fi
# 确保解压文件属于当前用户（macOS 打包 uid=501，Linux root 下 uid 不匹配）
chown -R "$(id -u):$(id -g)" "$PLUGIN_DIR" 2>/dev/null || true
# 清理 macOS 扩展属性文件
find "$PLUGIN_DIR" -name '._*' -delete 2>/dev/null || true
debug "解压内容: $(ls -la "$PLUGIN_DIR" 2>/dev/null)"

# ── 安装插件（直接拷贝 + patch 配置文件） ──
debug ""
debug "── 安装插件 ──"

# 1. 清理旧插件目录
for d in "$HOME/.openclaw/extensions/openclaw-guardrail"; do
  if [ -d "$d" ]; then
    rm -rf "$d" 2>/dev/null
    debug "已清理旧目录: $d"
  fi
done

# 2. 拷贝插件文件
mkdir -p "$DEST_DIR"
cp -r "$PLUGIN_DIR"/* "$DEST_DIR"/
chown -R "$(id -u):$(id -g)" "$DEST_DIR" 2>/dev/null || true
debug "已拷贝到: $DEST_DIR"
debug "目录内容: $(ls -la "$DEST_DIR" 2>/dev/null)"
debug "插件文件已安装"

# 3. Patch openclaw.json 配置文件
#    - 写入 plugins.entries + plugins.installs
PLUGINS_CONFIG="$HOME/.openclaw/openclaw.json"
PLUGIN_VERSION="${REMOTE_VERSION:-1.0.0}"
debug "Patch 配置: $PLUGINS_CONFIG"

if [ -f "$PLUGINS_CONFIG" ]; then
  if command -v node &>/dev/null; then
    OC_CFG_PATH="$PLUGINS_CONFIG" \
    OC_INSTALL_PATH="$DEST_DIR" \
    OC_PLUGIN_VER="$PLUGIN_VERSION" \
    node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(process.env.OC_CFG_PATH, 'utf-8'));
const installPath = process.env.OC_INSTALL_PATH;
const pluginVer = process.env.OC_PLUGIN_VER;
if (!cfg.plugins) cfg.plugins = {};
if (cfg.plugins.load && Array.isArray(cfg.plugins.load.paths)) {
  cfg.plugins.load.paths = cfg.plugins.load.paths.filter(p =>
    !p.includes('openclaw-guardrail') && !p.includes('/tmp/')
  );
  if (cfg.plugins.load.paths.length === 0) delete cfg.plugins.load;
}
if (!Array.isArray(cfg.plugins.allow)) cfg.plugins.allow = [];
cfg.plugins.allow = cfg.plugins.allow.filter(x => x !== 'openclaw-guardrail');
cfg.plugins.allow.push('openclaw-guardrail');
if (!cfg.plugins.entries) cfg.plugins.entries = {};
cfg.plugins.entries['openclaw-guardrail'] = { enabled: true };
if (!cfg.plugins.installs) cfg.plugins.installs = {};
cfg.plugins.installs['openclaw-guardrail'] = {
  source: 'path',
  sourcePath: installPath,
  installPath: installPath,
  version: pluginVer,
  installedAt: new Date().toISOString(),
};
if (!cfg.tools) cfg.tools = {};
if (!cfg.tools.profile) cfg.tools.profile = 'coding';
if (!Array.isArray(cfg.tools.alsoAllow)) cfg.tools.alsoAllow = [];
if (!cfg.tools.alsoAllow.includes('openclaw_security_scan')) {
  cfg.tools.alsoAllow.push('openclaw_security_scan');
}
fs.writeFileSync(process.env.OC_CFG_PATH, JSON.stringify(cfg, null, 2) + '\n');
" 2>/dev/null && debug "node patch 成功"
  elif command -v python3 &>/dev/null; then
    OC_CFG_PATH="$PLUGINS_CONFIG" \
    OC_INSTALL_PATH="$DEST_DIR" \
    OC_PLUGIN_VER="$PLUGIN_VERSION" \
    python3 -c "
import json, os
from datetime import datetime, timezone
cfg_path = os.environ['OC_CFG_PATH']
install_path = os.environ['OC_INSTALL_PATH']
plugin_ver = os.environ['OC_PLUGIN_VER']
with open(cfg_path, 'r') as f: cfg = json.load(f)
plugins = cfg.setdefault('plugins', {})
load = plugins.get('load', {})
paths = load.get('paths', [])
if isinstance(paths, list):
    paths = [p for p in paths if 'openclaw-guardrail' not in p and '/tmp/' not in p]
    if paths:
        load['paths'] = paths
    else:
        plugins.pop('load', None)
allow = plugins.setdefault('allow', [])
if not isinstance(allow, list):
    allow = []
allow = [x for x in allow if x != 'openclaw-guardrail']
allow.append('openclaw-guardrail')
plugins['allow'] = allow
entries = plugins.setdefault('entries', {})
entries['openclaw-guardrail'] = {'enabled': True}
installs = plugins.setdefault('installs', {})
installs['openclaw-guardrail'] = {
    'source': 'path',
    'sourcePath': install_path,
    'installPath': install_path,
    'version': plugin_ver,
    'installedAt': datetime.now(timezone.utc).isoformat(),
}
tools = cfg.setdefault('tools', {})
tools.setdefault('profile', 'coding')
also_allow = tools.setdefault('alsoAllow', [])
if isinstance(also_allow, list) and 'openclaw_security_scan' not in also_allow:
    also_allow.append('openclaw_security_scan')
with open(cfg_path, 'w') as f: json.dump(cfg, f, indent=2); f.write('\n')
" 2>/dev/null && debug "python patch 成功"
  else
    echo "  ⚠️  无 node/python3，无法 patch 配置，请手动启用插件"
  fi
  debug "Patch 后: plugins.allow=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$PLUGINS_CONFIG','utf-8'));console.log(JSON.stringify(c.plugins?.allow||[]))}catch{}" 2>/dev/null)"
else
  # 配置文件不存在，创建最小配置
  debug "配置文件不存在，创建新配置"
  mkdir -p "$(dirname "$PLUGINS_CONFIG")"
  cat > "$PLUGINS_CONFIG" <<CFGEOF
{
  "plugins": {
    "allow": ["openclaw-guardrail"],
    "entries": {
      "openclaw-guardrail": {
        "enabled": true
      }
    },
    "installs": {
      "openclaw-guardrail": {
        "source": "path",
        "sourcePath": "${DEST_DIR}",
        "installPath": "${DEST_DIR}",
        "version": "${PLUGIN_VERSION}",
        "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      }
    }
  },
  "tools": {
    "profile": "coding",
    "alsoAllow": ["openclaw_security_scan"]
  }
}
CFGEOF
fi
debug "配置文件已更新"
debug "插件安装完成"

debug ""
debug "── 重启 Gateway ──"
do_restart() {
  if run_openclaw gateway restart 2>"$TMP_DIR/gw_err.log"; then
    echo "  ✅ Gateway 已重启"
  else
    GW_ERR=$(cat "$TMP_DIR/gw_err.log" 2>/dev/null)
    debug "gateway restart 失败: $GW_ERR"
    if pgrep -f "openclaw.*gateway" >/dev/null 2>&1; then
      pkill -f "openclaw.*gateway" 2>/dev/null
      sleep 1
      echo "  ✅ Gateway 进程已重启（请手动启动 gateway）"
    else
      echo "  ⚠️  未检测到运行中的 Gateway，请手动启动"
    fi
  fi
}

if [[ "$AUTO_RESTART" == "true" ]]; then
  do_restart
else
  if [[ -t 0 ]]; then
    echo -n "  是否立即重启 OpenClaw 以使配置生效？(Y/n) "
    read -r answer
    answer=$(echo "$answer" | tr '[:upper:]' '[:lower:]')
    if [[ "$answer" != "n" ]]; then
      do_restart
    else
      echo "  ⚠️  请稍后手动重启 OpenClaw 以使配置生效"
    fi
  else
    do_restart
  fi
fi

# ── 安装 openclaw-guardrail skill ──
debug ""
debug "── 安装安全扫描 Skill ──"
SKILL_NAME="openclaw-guardrail"
SKILL_SRC="$DEST_DIR/$SKILL_NAME"
SKILL_DEST=""

if [ -d "$HOME/.openclaw/skills" ]; then
  SKILL_DEST="$HOME/.openclaw/skills/$SKILL_NAME"
elif [ -d "$HOME/.agents/skills" ]; then
  SKILL_DEST="$HOME/.agents/skills/$SKILL_NAME"
elif [ -d "$HOME/.claude/skills" ]; then
  SKILL_DEST="$HOME/.claude/skills/$SKILL_NAME"
else
  mkdir -p "$HOME/.openclaw/skills"
  SKILL_DEST="$HOME/.openclaw/skills/$SKILL_NAME"
fi

if [ -d "$SKILL_SRC" ]; then
  rm -rf "$SKILL_DEST" 2>/dev/null
  cp -r "$SKILL_SRC" "$SKILL_DEST"
  chown -R "$(id -u):$(id -g)" "$SKILL_DEST" 2>/dev/null || true
  debug "Skill 安装目录: $SKILL_DEST"
  debug "$SKILL_NAME skill 已安装"

  mkdir -p "$HOME/.openclaw/openclaw-guardrail/report"
  mkdir -p "$HOME/.openclaw/openclaw-guardrail/json"
else
  echo "  ⚠️  未找到 skill 源文件: $SKILL_SRC"
  debug "插件目录内容: $(ls -la "$DEST_DIR" 2>/dev/null)"
fi

echo ""
echo "✅ 安装完成 (v$REMOTE_VERSION)"
debug "用户: $USER_NAME"
debug "版本: $REMOTE_VERSION"
debug "设备: $DEVICE_ID"
debug "服务: $SERVER"
