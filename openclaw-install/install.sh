#!/bin/bash
set -euo pipefail

# =============================================================================
# OpenClaw 企业版安装器
#
# 本脚本功能:
#   1. 运行 OpenClaw 官方安装脚本
#   2. 引导用户通过浏览器创建 API Key
#   3. 配置沙箱模式（可选，需要 Docker）
#   4. 自动配置 AI 模型（通过 Lumos 代理）
#
# 环境变量:
#   AI_BASE_URL   API 端点 (默认: https://your-ai-provider.example.com/v1)
#   AI_MODEL      模型名称 (默认: kimi-k2.5)
#
# 用法:
#   bash install.sh                       # 完整安装（所有步骤）
#   bash install.sh only_install_original # 仅安装官方 OpenClaw
#   bash install.sh setup_api_key         # 仅配置 API Key
#   bash install.sh configure             # 仅写入模型配置到 openclaw.json
#   bash install.sh help                  # 显示帮助
# =============================================================================

# ── 颜色常量 ──────────────────────────────────────────────────────────
BOLD='\033[1m'
ACCENT='\033[38;2;255;77;77m'
INFO='\033[38;2;136;146;176m'
SUCCESS='\033[38;2;0;229;204m'
WARN='\033[38;2;255;176;32m'
ERROR='\033[38;2;230;57;70m'
MUTED='\033[38;2;90;100;128m'
NC='\033[0m'

# ── 地址配置 ─────────────────────────────────────────────────────────
OFFICIAL_INSTALL_URL="https://openclaw.ai/install.sh"
LUMOS_LOGIN_URL="${AI_LOGIN_URL:-https://your-ai-provider.example.com/management/api-keys}"

AI_BASE_URL="${AI_BASE_URL:-https://your-ai-provider.example.com/v1}"
AI_MODEL="${AI_MODEL:-kimi-k2.5}"

# ── 配置路径 ─────────────────────────────────────────────────────────
OPENCLAW_CONFIG_DIR="${HOME}/.openclaw"
CONFIG_FILE="${OPENCLAW_CONFIG_DIR}/openclaw.json"

# ── Debug 模式 ────────────────────────────────────────────────────────
DEBUG="${DEBUG:-false}"
for _arg in "$@"; do [[ "$_arg" == "--debug" ]] && DEBUG=true; done
_is_debug() { [[ "$DEBUG" == "true" || "$DEBUG" == "TRUE" || "$DEBUG" == "1" ]]; }

# ── UI 辅助函数 ───────────────────────────────────────────────────────
ui_info()    { echo -e "${MUTED}·${NC} $*"; }
ui_debug()   { _is_debug && echo -e "${MUTED}  [debug] $*${NC}" || true; }
ui_success() { echo -e "${SUCCESS}✓${NC} $*"; }
ui_warn()    { echo -e "${WARN}!${NC} $*"; }
ui_error()   { echo -e "${ERROR}✗${NC} $*"; }

ui_section() {
    echo ""
    echo -e "${ACCENT}${BOLD}$*${NC}"
}

ui_banner() {
    echo ""
    echo -e "${ACCENT}${BOLD}"
    echo "  ╔═══════════════════════════════════════════════════════╗"
    echo "  ║                                                       ║"
    echo "  ║          🦞  OpenClaw 企业版安装器                     ║"
    echo "  ║                                                       ║"
    echo "  ║            Powered by OpenClaw                         ║"
    echo "  ║          Cyber Security Team @ 2026                    ║"
    echo "  ║                                                       ║"
    echo "  ╚═══════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo -e "${INFO}  企业版安装，自动配置 AI 模型${NC}"
    echo ""
}

# ── 平台检测 ───────────────────────────────────────────────────────────
check_platform() {
    local os_type
    os_type="$(uname -s 2>/dev/null || true)"

    case "$os_type" in
        Linux)
            OS="linux"
            ui_success "平台: Linux"
            ;;
        Darwin)
            OS="macos"
            ui_success "平台: macOS"
            ;;
        *)
            ui_error "不支持的操作系统: ${os_type}"
            echo ""
            echo "  本安装器支持 Linux 和 macOS。"
            echo ""
            echo "  Windows 用户请使用:"
            echo "    powershell -c \"irm https://openclaw.ai/install.ps1 | iex\""
            exit 1
            ;;
    esac
}

# ── 依赖检查 ───────────────────────────────────────────────────────────
check_dependencies() {
    local missing=()

    if ! command -v curl &>/dev/null && ! command -v wget &>/dev/null; then
        missing+=("curl 或 wget")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        ui_error "缺少必要依赖: ${missing[*]}"
        exit 1
    fi

    ui_success "依赖检查通过"
}

# ── 下载辅助函数 ──────────────────────────────────────────────────────
download_file() {
    local url="$1"
    local output="$2"

    if command -v curl &>/dev/null; then
        curl -fsSL --retry 3 --retry-delay 2 -o "$output" "$url"
    elif command -v wget &>/dev/null; then
        wget -q --tries=3 -O "$output" "$url"
    else
        ui_error "没有可用的下载工具（需要 curl 或 wget）"
        return 1
    fi
}

# ── 步骤 1: 官方 OpenClaw 安装 ────────────────────────────────────────
run_official_installer() {
    ui_section "[1/8] 安装 OpenClaw（官方安装器）"
    ui_debug "下载地址: ${OFFICIAL_INSTALL_URL}"

    local tmp_script
    tmp_script="$(mktemp /tmp/openclaw-official-XXXXXX.sh)"
    trap "rm -f '$tmp_script'" RETURN

    if ! download_file "$OFFICIAL_INSTALL_URL" "$tmp_script"; then
        ui_error "下载官方安装器失败"
        exit 1
    fi

    chmod +x "$tmp_script"
    ui_info "正在运行官方安装器..."
    echo ""

    if ! /bin/bash "$tmp_script" --no-onboard; then
        ui_error "官方安装器运行失败"
        exit 1
    fi

    rm -f "$tmp_script"
    trap - RETURN

    echo ""
    ui_success "OpenClaw 基础安装完成"
}

# ── 步骤 1.5: 初始化 Hooks 和 Gateway Token ──────────────────────────
init_hooks_and_token() {
    ui_section "[2/8] 初始化 Hooks 和 Gateway Token"

    mkdir -p "$OPENCLAW_CONFIG_DIR"

    # 生成随机 token (48 字节 hex)
    local gw_token
    if command -v openssl &>/dev/null; then
        gw_token="$(openssl rand -hex 24)"
    elif [[ -r /dev/urandom ]]; then
        gw_token="$(head -c 24 /dev/urandom | xxd -p | tr -d '\n')"
    else
        gw_token="$(date +%s%N | sha256sum | head -c 48)"
    fi

    ui_debug "Gateway Token: ${gw_token}"

    if [[ -f "$CONFIG_FILE" ]]; then
        # 合并到已有配置
        if command -v node &>/dev/null; then
            OC_CONFIG_PATH="$CONFIG_FILE" \
            OC_GW_TOKEN="$gw_token" \
            node -e "
const fs = require('fs');
const configPath = process.env.OC_CONFIG_PATH;
const gwToken = process.env.OC_GW_TOKEN;
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// hooks
if (!config.hooks) config.hooks = {};
if (!config.hooks.internal) config.hooks.internal = {};
config.hooks.internal.enabled = true;
if (!config.hooks.internal.entries) config.hooks.internal.entries = {};
['boot-md', 'bootstrap-extra-files', 'command-logger', 'session-memory'].forEach(h => {
  if (!config.hooks.internal.entries[h]) config.hooks.internal.entries[h] = {};
  config.hooks.internal.entries[h].enabled = true;
});

// plugins（openclaw-guardrail 由插件安装器自行注册，此处不预写 entries）
if (!config.plugins) config.plugins = {};
if (!config.plugins.entries) config.plugins.entries = {};
// 确保 plugins.allow 包含 openclaw-guardrail
if (!Array.isArray(config.plugins.allow)) config.plugins.allow = [];
if (!config.plugins.allow.includes('openclaw-guardrail')) config.plugins.allow.push('openclaw-guardrail');

// tools.alsoAllow — 让插件工具不被 profile 过滤
if (!config.tools) config.tools = {};
if (!config.tools.profile) config.tools.profile = 'coding';
if (!Array.isArray(config.tools.alsoAllow)) config.tools.alsoAllow = [];
if (!config.tools.alsoAllow.includes('openclaw_security_scan')) {
  config.tools.alsoAllow.push('openclaw_security_scan');
}

// acp — 启用 IDE 集成
if (!config.acp) config.acp = {};
config.acp.enabled = true;
if (!config.acp.dispatch) config.acp.dispatch = {};
config.acp.dispatch.enabled = true;
if (!config.acp.maxConcurrentSessions) config.acp.maxConcurrentSessions = 10;

// skills — 安装偏好
if (!config.skills) config.skills = {};
if (!config.skills.install) config.skills.install = {};
if (!config.skills.install.nodeManager) config.skills.install.nodeManager = 'pnpm';

// gateway
if (!config.gateway) config.gateway = {};
if (!config.gateway.port) config.gateway.port = 18789;
if (!config.gateway.mode) config.gateway.mode = 'local';
if (!config.gateway.bind) config.gateway.bind = 'loopback';
if (!config.gateway.auth) config.gateway.auth = {};
config.gateway.auth.mode = 'token';
config.gateway.auth.token = gwToken;

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
"
        elif command -v python3 &>/dev/null; then
            OC_CONFIG_PATH="$CONFIG_FILE" \
            OC_GW_TOKEN="$gw_token" \
            python3 <<'PYEOF'
import json, os
config_path = os.environ['OC_CONFIG_PATH']
gw_token = os.environ['OC_GW_TOKEN']
with open(config_path, 'r') as f:
    config = json.load(f)

config.setdefault('hooks', {})
config['hooks'].setdefault('internal', {})
config['hooks']['internal']['enabled'] = True
config['hooks']['internal'].setdefault('entries', {})
for h in ['boot-md', 'bootstrap-extra-files', 'command-logger', 'session-memory']:
    config['hooks']['internal']['entries'].setdefault(h, {})
    config['hooks']['internal']['entries'][h]['enabled'] = True

config.setdefault('plugins', {})
config['plugins'].setdefault('entries', {})
# 确保 plugins.allow 包含 openclaw-guardrail
allow = config['plugins'].setdefault('allow', [])
if isinstance(allow, list) and 'openclaw-guardrail' not in allow:
    allow.append('openclaw-guardrail')

# tools.alsoAllow — 让插件工具不被 profile 过滤
tools = config.setdefault('tools', {})
tools.setdefault('profile', 'coding')
also_allow = tools.setdefault('alsoAllow', [])
if isinstance(also_allow, list) and 'openclaw_security_scan' not in also_allow:
    also_allow.append('openclaw_security_scan')

config.setdefault('acp', {})
config['acp']['enabled'] = True
config['acp'].setdefault('dispatch', {})
config['acp']['dispatch']['enabled'] = True
config['acp'].setdefault('maxConcurrentSessions', 10)

config.setdefault('skills', {})
config['skills'].setdefault('install', {})
config['skills']['install'].setdefault('nodeManager', 'pnpm')

config.setdefault('gateway', {})
config['gateway'].setdefault('port', 18789)
config['gateway'].setdefault('mode', 'local')
config['gateway'].setdefault('bind', 'loopback')
config['gateway'].setdefault('auth', {})
config['gateway']['auth']['mode'] = 'token'
config['gateway']['auth']['token'] = gw_token

with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)
    f.write('\n')
PYEOF
        else
            cat > "$CONFIG_FILE" <<EOF
{
  "plugins": {
    "allow": ["openclaw-guardrail"],
    "entries": {}
  },
  "tools": {
    "profile": "coding",
    "alsoAllow": ["openclaw_security_scan"]
  },
  "hooks": {
    "internal": {
      "enabled": true,
      "entries": {
        "boot-md": { "enabled": true },
        "bootstrap-extra-files": { "enabled": true },
        "command-logger": { "enabled": true },
        "session-memory": { "enabled": true }
      }
    }
  },
  "acp": {
    "enabled": true,
    "dispatch": { "enabled": true },
    "maxConcurrentSessions": 10
  },
  "skills": {
    "install": { "nodeManager": "pnpm" }
  },
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "loopback",
    "auth": {
      "mode": "token",
      "token": "${gw_token}"
    }
  }
}
EOF
        fi
    else
        cat > "$CONFIG_FILE" <<EOF
{
  "plugins": {
    "allow": ["openclaw-guardrail"],
    "entries": {}
  },
  "tools": {
    "profile": "coding",
    "alsoAllow": ["openclaw_security_scan"]
  },
  "hooks": {
    "internal": {
      "enabled": true,
      "entries": {
        "boot-md": { "enabled": true },
        "bootstrap-extra-files": { "enabled": true },
        "command-logger": { "enabled": true },
        "session-memory": { "enabled": true }
      }
    }
  },
  "acp": {
    "enabled": true,
    "dispatch": { "enabled": true },
    "maxConcurrentSessions": 10
  },
  "skills": {
    "install": { "nodeManager": "pnpm" }
  },
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "loopback",
    "auth": {
      "mode": "token",
      "token": "${gw_token}"
    }
  }
}
EOF
    fi

    # 导出 token 供后续使用（如飞书集成等）
    export OPENCLAW_GATEWAY_TOKEN="$gw_token"

    ui_success "内置 Hooks 已启用"
    ui_success "Gateway Token 已生成"
    ui_success "ACP 已启用"
}

# ── 步骤 2: 企业安全插件 ─────────────────────────────────────────────
run_enterprise_script() {
    ui_section "[3/8] 运行企业安全插件脚本"
    ui_debug "下载地址: ${ENTERPRISE_SCRIPT_URL}"

    local tmp_script
    tmp_script="$(mktemp /tmp/openclaw-enterprise-XXXXXX.sh)"

    if ! download_file "$ENTERPRISE_SCRIPT_URL" "$tmp_script"; then
        ui_warn "企业安全脚本不可用（地址无法访问）"
        ui_info "跳过企业安全配置 — 你可以稍后重新运行"
        rm -f "$tmp_script" 2>/dev/null || true
        return 0
    fi

    chmod +x "$tmp_script"
    ui_debug "正在执行企业安全脚本..."

    if ! /bin/bash "$tmp_script"; then
        ui_warn "企业安全脚本返回非零状态，继续执行..."
    fi

    rm -f "$tmp_script" 2>/dev/null || true
    ui_success "企业安全配置完成"
}

# ── 步骤 3: API Key 配置（交互式）──────────────────────────────────────
setup_api_key() {
    ui_section "[5/8] API Key 配置"
    echo ""
    echo -e "  使用 OpenClaw 企业版模型需要一个 ${BOLD}Lumos API Key${NC}。"
    echo ""
    echo -e "  ${BOLD}操作步骤:${NC}"
    echo -e "    1. 在浏览器中打开下方链接"
    echo -e "    2. 使用你的账号登录"
    echo -e "    3. 点击 ${BOLD}「创建 API Key」${NC}"
    echo -e "    4. 复制生成的 Key"
    echo -e "    5. 粘贴到这里"
    echo ""
    echo -e "  ${INFO}链接:${NC} ${BOLD}${LUMOS_LOGIN_URL}${NC}"
    echo ""

    # 尝试自动打开浏览器
    local browser_opened=false
    if [[ "${OS:-}" == "macos" ]]; then
        open "$LUMOS_LOGIN_URL" 2>/dev/null && browser_opened=true
    elif command -v xdg-open &>/dev/null; then
        xdg-open "$LUMOS_LOGIN_URL" 2>/dev/null && browser_opened=true
    elif command -v sensible-browser &>/dev/null; then
        sensible-browser "$LUMOS_LOGIN_URL" 2>/dev/null && browser_opened=true
    fi

    if [[ "$browser_opened" == "true" ]]; then
        ui_info "已自动打开浏览器"
    else
        ui_info "请手动在浏览器中打开上方链接"
    fi

    echo ""

    # 读取用户输入的 API Key
    local api_key=""
    while true; do
        echo -en "  ${ACCENT}❯${NC} 请粘贴你的 Lumos API Key: "

        if [[ -r /dev/tty ]]; then
            read -r api_key < /dev/tty
        else
            read -r api_key
        fi

        # 去除空白
        api_key="$(echo "$api_key" | xargs)"

        if [[ -z "$api_key" ]]; then
            ui_warn "API Key 不能为空，请重新输入。"
            continue
        fi

        # 基础校验: Lumos Key 以 "lumos-" 开头
        if [[ "$api_key" != lumos-* ]]; then
            echo ""
            ui_warn "Key 不是以 'lumos-' 开头，可能不是有效的 Lumos API Key。"
            echo -en "  ${MUTED}仍然继续？[y/N]:${NC} "
            local confirm=""
            if [[ -r /dev/tty ]]; then
                read -r confirm < /dev/tty
            else
                read -r confirm
            fi
            if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
                continue
            fi
        fi

        break
    done

    echo ""
    ui_success "API Key 已获取"

    # 导出供后续步骤使用
    LUMOS_API_KEY="$api_key"
}

is_root() {
    [[ "$(id -u)" -eq 0 ]]
}

require_sudo() {
    if is_root; then
        return 0
    fi
    if ! command -v sudo &>/dev/null; then
        ui_error "需要 sudo 权限但未找到 sudo（且当前非 root 用户）"
        return 1
    fi
    return 0
}

run_as_root() {
    if is_root; then
        "$@"
    else
        sudo "$@"
    fi
}


setup_feishu() {
    ui_section "[4/8] 飞书集成（可选）"
    echo ""
    echo -e "  OpenClaw 支持对接飞书（Lark），实现在飞书中直接与 AI 交互。"
    echo ""
    echo -e "  ${WARN}⚠ 安全提示:${NC}"
    echo -e "    • 飞书集成会让 AI 访问对话上下文，存在一定的${BOLD}数据泄露风险${NC}"
    echo -e "    • AI 可能将对话中的敏感信息用于模型推理"
    echo -e "    • 请确保已了解并接受相关风险后再启用"
    echo ""

    INSTALL_FEISHU=false

    echo -en "  ${ACCENT}❯${NC} 是否安装飞书集成？[y/${BOLD}N${NC}]: "
    local answer=""
    if [[ -r /dev/tty ]]; then
        read -r answer < /dev/tty
    else
        read -r answer
    fi
    answer="$(echo "$answer" | xargs)"

    if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
        ui_info "跳过飞书集成"
        return 0
    fi

    echo ""
    echo -e "  ${WARN}请确认你已了解飞书集成的数据安全风险。${NC}"
    echo -en "  ${ACCENT}❯${NC} 确认安装？输入 ${BOLD}YES${NC} 继续: "
    local confirm=""
    if [[ -r /dev/tty ]]; then
        read -r confirm < /dev/tty
    else
        read -r confirm
    fi

    if [[ "$confirm" != "YES" ]]; then
        ui_info "已取消飞书集成安装"
        return 0
    fi

    INSTALL_FEISHU=true
    ui_info "正在安装飞书工具..."
    if npx -y @larksuite/openclaw-lark-tools install 2>/dev/null; then
        ui_success "飞书集成安装完成"
    else
        ui_warn "飞书集成安装失败，你可以稍后手动运行:"
        ui_info "npx -y @larksuite/openclaw-lark-tools install"
    fi
}


# ── 步骤 5: 自动配置模型 ─────────────────────────────────────────────
configure_openclaw() {
    ui_section "[6/8] 配置 OpenClaw 模型 (${AI_MODEL})"

    mkdir -p "$OPENCLAW_CONFIG_DIR"
    ui_debug "配置文件: ${CONFIG_FILE}"

    local provider_name="lumos-enterprise"

    if [[ -f "$CONFIG_FILE" ]]; then
        ui_debug "检测到已有 openclaw.json，正在合并配置..."

        if command -v node &>/dev/null; then
            # 使用环境变量传参，避免 Node.js v22 argv 变化导致的兼容性问题
            OC_CONFIG_PATH="$CONFIG_FILE" \
            OC_API_KEY="$LUMOS_API_KEY" \
            OC_BASE_URL="$AI_BASE_URL" \
            OC_MODEL="$AI_MODEL" \
            OC_PROVIDER="$provider_name" \
            node -e "
const fs = require('fs');
const configPath = process.env.OC_CONFIG_PATH;
const apiKey = process.env.OC_API_KEY;
const baseURL = process.env.OC_BASE_URL;
const model = process.env.OC_MODEL;
const provider = process.env.OC_PROVIDER;
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

if (!config.models) config.models = {};
if (!config.models.providers) config.models.providers = {};
config.models.mode = 'merge';

config.models.providers[provider] = {
  baseUrl: baseURL,
  apiKey: apiKey,
  api: 'openai-completions',
  headers: { 'x-lumos-source': 'openclaw' },
  models: [{ id: model, name: model }]
};

if (!config.agents) config.agents = {};
if (!config.agents.defaults) config.agents.defaults = {};
if (!config.agents.defaults.model) config.agents.defaults.model = {};
config.agents.defaults.model.primary = provider + '/' + model;

// 启用企业内置 hooks
if (!config.hooks) config.hooks = {};
if (!config.hooks.internal) config.hooks.internal = {};
config.hooks.internal.enabled = true;
if (!config.hooks.internal.entries) config.hooks.internal.entries = {};
['boot-md', 'bootstrap-extra-files', 'command-logger', 'session-memory'].forEach(h => {
  if (!config.hooks.internal.entries[h]) config.hooks.internal.entries[h] = {};
  config.hooks.internal.entries[h].enabled = true;
});

// 确保 plugins.allow 包含 openclaw-guardrail
if (!config.plugins) config.plugins = {};
if (!Array.isArray(config.plugins.allow)) config.plugins.allow = [];
if (!config.plugins.allow.includes('openclaw-guardrail')) config.plugins.allow.push('openclaw-guardrail');

// 确保 tools.alsoAllow 包含 openclaw_security_scan
if (!config.tools) config.tools = {};
if (!config.tools.profile) config.tools.profile = 'coding';
if (!Array.isArray(config.tools.alsoAllow)) config.tools.alsoAllow = [];
if (!config.tools.alsoAllow.includes('openclaw_security_scan')) {
  config.tools.alsoAllow.push('openclaw_security_scan');
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
"
        elif command -v python3 &>/dev/null; then
            OC_CONFIG_PATH="$CONFIG_FILE" \
            OC_API_KEY="$LUMOS_API_KEY" \
            OC_BASE_URL="$AI_BASE_URL" \
            OC_MODEL="$AI_MODEL" \
            OC_PROVIDER="$provider_name" \
            python3 <<'PYEOF'
import json, os
config_path = os.environ['OC_CONFIG_PATH']
api_key = os.environ['OC_API_KEY']
base_url = os.environ['OC_BASE_URL']
model = os.environ['OC_MODEL']
provider = os.environ['OC_PROVIDER']
with open(config_path, 'r') as f:
    config = json.load(f)

config.setdefault('models', {})
config['models']['mode'] = 'merge'
config['models'].setdefault('providers', {})
config['models']['providers'][provider] = {
    'baseUrl': base_url,
    'apiKey': api_key,
    'api': 'openai-completions',
    'headers': {'x-lumos-source': 'openclaw'},
    'models': [{'id': model, 'name': model}]
}

config.setdefault('agents', {})
config['agents'].setdefault('defaults', {})
config['agents']['defaults'].setdefault('model', {})
config['agents']['defaults']['model']['primary'] = f'{provider}/{model}'

# 启用企业内置 hooks
config.setdefault('hooks', {})
config['hooks'].setdefault('internal', {})
config['hooks']['internal']['enabled'] = True
config['hooks']['internal'].setdefault('entries', {})
for h in ['boot-md', 'bootstrap-extra-files', 'command-logger', 'session-memory']:
    config['hooks']['internal']['entries'].setdefault(h, {})
    config['hooks']['internal']['entries'][h]['enabled'] = True

# 确保 plugins.allow 包含 openclaw-guardrail
plugins = config.setdefault('plugins', {})
allow = plugins.setdefault('allow', [])
if isinstance(allow, list) and 'openclaw-guardrail' not in allow:
    allow.append('openclaw-guardrail')

# 确保 tools.alsoAllow 包含 openclaw_security_scan
tools = config.setdefault('tools', {})
tools.setdefault('profile', 'coding')
also_allow = tools.setdefault('alsoAllow', [])
if isinstance(also_allow, list) and 'openclaw_security_scan' not in also_allow:
    also_allow.append('openclaw_security_scan')

with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)
    f.write('\n')
PYEOF
        else
            ui_warn "未找到 node 或 python3，将写入全新配置"
            cat > "$CONFIG_FILE" <<EOF
{
  "models": {
    "mode": "merge",
    "providers": {
      "${provider_name}": {
        "baseUrl": "${AI_BASE_URL}",
        "apiKey": "${LUMOS_API_KEY}",
        "api": "openai-completions",
        "headers": {
          "x-lumos-source": "openclaw"
        },
        "models": [
          {
            "id": "${AI_MODEL}",
            "name": "${AI_MODEL}"
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "${provider_name}/${AI_MODEL}"
      }
    }
  },
  "plugins": {
    "allow": ["openclaw-guardrail"],
    "entries": {
      "openclaw-guardrail": { "enabled": true }
    }
  },
  "tools": {
    "profile": "coding",
    "alsoAllow": ["openclaw_security_scan"]
  },
  "hooks": {
    "internal": {
      "enabled": true,
      "entries": {
        "boot-md": { "enabled": true },
        "bootstrap-extra-files": { "enabled": true },
        "command-logger": { "enabled": true },
        "session-memory": { "enabled": true }
      }
    }
  }
}
EOF
        fi
    else
        cat > "$CONFIG_FILE" <<EOF
{
  "models": {
    "mode": "merge",
    "providers": {
      "${provider_name}": {
        "baseUrl": "${AI_BASE_URL}",
        "apiKey": "${LUMOS_API_KEY}",
        "api": "openai-completions",
        "headers": {
          "x-lumos-source": "openclaw"
        },
        "models": [
          {
            "id": "${AI_MODEL}",
            "name": "${AI_MODEL}"
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "${provider_name}/${AI_MODEL}"
      }
    }
  },
  "plugins": {
    "allow": ["openclaw-guardrail"],
    "entries": {
      "openclaw-guardrail": { "enabled": true }
    }
  },
  "tools": {
    "profile": "coding",
    "alsoAllow": ["openclaw_security_scan"]
  },
  "hooks": {
    "internal": {
      "enabled": true,
      "entries": {
        "boot-md": { "enabled": true },
        "bootstrap-extra-files": { "enabled": true },
        "command-logger": { "enabled": true },
        "session-memory": { "enabled": true }
      }
    }
  }
}
EOF
    fi

    ui_success "openclaw.json 已更新（默认模型: ${provider_name}/${AI_MODEL}）"
    ui_success "已启用企业内置 Hooks: boot-md, bootstrap-extra-files, command-logger, session-memory"
}

restart_openclaw() {
    ui_section "[7/8] 启动 OpenClaw"

    if ! command -v openclaw &>/dev/null; then
        ui_warn "未找到 openclaw 命令，请手动启动"
        return 1
    fi

    ui_info "运行 openclaw doctor --repair ..."
    if openclaw doctor --repair --non-interactive 2>&1 | while IFS= read -r line; do
        ui_debug "$line"
    done; then
        ui_success "doctor 检查完成"
    else
        ui_warn "doctor 返回非零状态，继续启动..."
    fi

    ui_info "正在安装 Gateway..."
    if openclaw gateway install 2>&1 | while IFS= read -r line; do
        ui_debug "$line"
    done; then
        ui_success "Gateway 安装完成"
    else
        ui_warn "Gateway 安装返回非零状态，继续启动..."
    fi

    ui_info "正在启动 Gateway..."
    nohup openclaw gateway start >/dev/null 2>&1 &

    local gw_port=18789
    if [[ -f "$CONFIG_FILE" ]]; then
        local cfg_port
        cfg_port=$(grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]*' "$CONFIG_FILE" 2>/dev/null | head -1 | grep -o '[0-9]*$' || true)
        [[ -n "$cfg_port" ]] && gw_port="$cfg_port"
    fi

    local max_wait=30
    local gw_ready=false
    local spinner_chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    local spin_idx=0

    for ((i=1; i<=max_wait; i++)); do
        if curl -sf -o /dev/null "http://127.0.0.1:${gw_port}/health" 2>/dev/null || \
           curl -sf -o /dev/null "http://127.0.0.1:${gw_port}/" 2>/dev/null; then
            gw_ready=true
            printf "\r%-60s\r" " "
            break
        fi
        local c="${spinner_chars:spin_idx:1}"
        spin_idx=$(( (spin_idx + 1) % ${#spinner_chars} ))
        printf "\r  %s 等待 Gateway 启动... (%d/%ds)" "$c" "$i" "$max_wait"
        sleep 1
    done

    if [[ "$gw_ready" == "true" ]]; then
        ui_success "Gateway 已启动 (端口 ${gw_port})"
    else
        ui_warn "Gateway 可能还在启动中"
        ui_info "请手动检查: openclaw gateway status"
    fi
}

post_install_health_check() {
    ui_section "[8/8] 安装后体检"

    local device_id=""
    local plugin_cfg="$HOME/.openclaw/plugin-configs/openclaw-guardrail.json"
    if [[ -f "$plugin_cfg" ]]; then
        device_id=$(grep -o '"device_id"[[:space:]]*:[[:space:]]*"[^"]*"' "$plugin_cfg" | head -1 | grep -o '"[^"]*"$' | tr -d '"')
    fi

    local gw_running="false"
    local gw_port=18789
    if [[ -f "$CONFIG_FILE" ]]; then
        local cfg_port
        cfg_port=$(grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]*' "$CONFIG_FILE" 2>/dev/null | head -1 | grep -o '[0-9]*$' || true)
        [[ -n "$cfg_port" ]] && gw_port="$cfg_port"
    fi
    if curl -sf -o /dev/null "http://127.0.0.1:${gw_port}/health" 2>/dev/null || \
       curl -sf -o /dev/null "http://127.0.0.1:${gw_port}/" 2>/dev/null; then
        gw_running="true"
    fi

    # 检查 hooks
    local hooks_ok="false"
    if [[ -f "$CONFIG_FILE" ]]; then
        if grep -q '"internal"' "$CONFIG_FILE" 2>/dev/null && grep -q '"enabled": true' "$CONFIG_FILE" 2>/dev/null; then
            hooks_ok="true"
        fi
    fi

    # 检查 ACP
    local acp_ok="false"
    if [[ -f "$CONFIG_FILE" ]] && grep -q '"acp"' "$CONFIG_FILE" 2>/dev/null; then
        acp_ok="true"
    fi

    # 检查插件
    local plugin_ok="false"
    for d in "$HOME/.openclaw/extensions/openclaw-guardrail"; do
        if [[ -f "$d/package.json" ]]; then
            plugin_ok="true"
            break
        fi
    done

    # 计算分数
    local score=0
    local total=4
    [[ "$gw_running" == "true" ]] && score=$((score + 1))
    [[ "$hooks_ok" == "true" ]] && score=$((score + 1))
    [[ "$acp_ok" == "true" ]] && score=$((score + 1))
    [[ "$plugin_ok" == "true" ]] && score=$((score + 1))

    local grade="D"
    [[ $score -ge 2 ]] && grade="C"
    [[ $score -ge 3 ]] && grade="B"
    [[ $score -ge 4 ]] && grade="A"

    echo ""
    echo -e "  ${BOLD}体检结果: ${score}/${total} (${grade})${NC}"
    [[ "$gw_running" == "true" ]] && echo -e "    ${SUCCESS}✓${NC} Gateway 运行中" || echo -e "    ${ERROR}✗${NC} Gateway 未运行"
    [[ "$hooks_ok" == "true" ]] && echo -e "    ${SUCCESS}✓${NC} 内置 Hooks 已启用" || echo -e "    ${ERROR}✗${NC} Hooks 未启用"
    [[ "$acp_ok" == "true" ]] && echo -e "    ${SUCCESS}✓${NC} ACP 已启用" || echo -e "    ${WARN}✗${NC} ACP 未启用"
    [[ "$plugin_ok" == "true" ]] && echo -e "    ${SUCCESS}✓${NC} 安全插件已安装" || echo -e "    ${ERROR}✗${NC} 安全插件未安装"

    # 上报到安全服务
    if [[ -n "$device_id" ]]; then
        local server_url=""
        if [[ -f "$plugin_cfg" ]]; then
            server_url=$(grep -o '"server_url"[[:space:]]*:[[:space:]]*"[^"]*"' "$plugin_cfg" | head -1 | grep -o '"[^"]*"$' | tr -d '"')
        fi
        if [[ -n "$server_url" ]]; then
            local health_json
            health_json=$(cat <<HEALTHEOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "device_id": "${device_id}",
  "source": "install",
  "openclaw_version": "$(openclaw --version 2>/dev/null || echo 'unknown')",
  "plugin_version": "",
  "os": "$(uname -s) $(uname -r)",
  "hostname": "$(hostname)",
  "username": "$(whoami)",
  "checks": {
    "gateway": { "running": ${gw_running}, "port": ${gw_port} },
    "hooks": { "enabled": ${hooks_ok} },
    "acp": { "enabled": ${acp_ok} },
    "plugin": { "enabled": ${plugin_ok} },
    "policy": { "version": "", "synced": false }
  }
}
HEALTHEOF
            )
            if curl -sf -X POST "${server_url}/api/v1/health-report" \
                -H "Content-Type: application/json" \
                -d "$health_json" >/dev/null 2>&1; then
                ui_debug "体检结果已上报"
            else
                ui_debug "体检上报失败（服务不可达）"
            fi
        fi
    fi
}

print_summary() {
    echo ""
    echo -e "${ACCENT}${BOLD}"
    echo "  ╔═══════════════════════════════════════════════════════╗"
    echo "  ║          🎉  安装完成！                                ║"
    echo "  ╚═══════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo -e "  ${BOLD}配置信息:${NC}"
    echo -e "    默认模型:    ${INFO}lumos-enterprise/${AI_MODEL}${NC}"
    echo -e "    内置 Hooks:  ${INFO}boot-md, command-logger, session-memory${NC}"
    echo -e "    飞书集成:    ${INFO}${INSTALL_FEISHU:-false}${NC}"
    echo ""
    if _is_debug; then
        echo -e "  ${BOLD}详细配置:${NC}"
        echo -e "    API 地址:    ${MUTED}${AI_BASE_URL}${NC}"
        echo -e "    配置文件:    ${MUTED}${CONFIG_FILE}${NC}"
        echo -e "    Gateway:     ${MUTED}token=${OPENCLAW_GATEWAY_TOKEN:-}${NC}"
        echo ""
    fi
}

show_help() {
    echo ""
    echo -e "${BOLD}用法:${NC} bash install.sh [命令]"
    echo ""
    echo -e "${BOLD}可用命令:${NC}"
    echo -e "  ${INFO}(无参数)${NC}              完整安装（所有步骤）"
    echo -e "  ${INFO}only_install_original${NC}  仅安装 OpenClaw 基础版（官方安装器）"
    echo -e "  ${INFO}enterprise${NC}            运行企业安全插件脚本"
    echo -e "  ${INFO}setup_api_key${NC}         配置 Lumos API Key"
    echo -e "  ${INFO}configure${NC}             写入模型配置到 openclaw.json"
    echo -e "  ${INFO}feishu${NC}                安装飞书集成"
    echo -e "  ${INFO}restart${NC}               重启 OpenClaw"
    echo -e "  ${INFO}help${NC}                  显示此帮助"
    echo ""
    echo -e "${BOLD}选项:${NC}"
    echo -e "  ${INFO}--debug${NC}               显示详细调试信息（URL、Token 等）"
    echo ""
    echo -e "${BOLD}环境变量:${NC}"
    echo -e "  ${INFO}AI_BASE_URL${NC}           API 端点 (默认: https://your-ai-provider.example.com/v1)"
    echo -e "  ${INFO}AI_MODEL${NC}              模型名称 (默认: kimi-k2.5)"
    echo -e "  ${INFO}DEBUG${NC}                 设为 TRUE 显示调试信息"
    echo ""
}

main() {
    LUMOS_API_KEY=""
    OS=""

    # 取第一个非 --debug 的参数作为命令
    local command=""
    for _a in "$@"; do
        [[ "$_a" == "--debug" ]] && continue
        command="$_a"
        break
    done

    case "$command" in
        help|--help|-h)
            ui_banner
            show_help
            ;;
        only_install_original)
            ui_banner
            check_platform
            check_dependencies
            run_official_installer
            ;;
        enterprise)
            ui_banner
            check_platform
            check_dependencies
            run_enterprise_script
            ;;
        setup_api_key)
            ui_banner
            check_platform
            setup_api_key
            ;;
        configure)
            ui_banner
            check_platform
            setup_api_key
            configure_openclaw
            restart_openclaw
            post_install_health_check
            print_summary
            ;;
        feishu)
            ui_banner
            check_platform
            setup_feishu
            ;;
        restart)
            check_platform
            restart_openclaw
            ;;
        "")
            ui_banner
            check_platform
            check_dependencies
            run_official_installer
            init_hooks_and_token
            run_enterprise_script
            setup_feishu
            setup_api_key
            configure_openclaw
            restart_openclaw
            post_install_health_check
            print_summary
            ;;
        *)
            ui_error "未知命令: ${command}"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
