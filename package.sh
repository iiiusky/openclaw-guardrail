#!/usr/bin/env bash
# 打包插件为 .tgz，并生成 version.json + install_plugin.sh
#
# 用法:
#   ./package.sh --server URL --enterprise COS_BASE_URL [--preview] [--no-upload] [输出目录]
#
# 示例:
#   正式版: ./package.sh --server http://your-server --enterprise https://your-bucket.cos.ap-beijing.myqcloud.com --no-upload
#   预览版: ./package.sh --server http://your-server --enterprise https://your-bucket.cos.ap-beijing.myqcloud.com --preview --no-upload
#
# 选项:
#   --server      安全服务地址（默认 http://127.0.0.1:9720）
#   --enterprise  COS 基础 URL（如 https://your-bucket.cos.ap-beijing.myqcloud.com）
#   --preview     预览版，COS 路径变为 openclaw-guardrail-preview/
#   --no-upload   只打包不上传，打印上传命令
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 解析参数
SERVER_URL=""
ENTERPRISE_BASE=""
PREVIEW=false
OUT_DIR=""
NO_UPLOAD=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server)       SERVER_URL="$2"; shift 2 ;;
    --enterprise)   ENTERPRISE_BASE="$2"; shift 2 ;;
    --preview)      PREVIEW=true; shift ;;
    --no-upload)    NO_UPLOAD=true; shift ;;
    *)              OUT_DIR="$1"; shift ;;
  esac
done

OUT_DIR="${OUT_DIR:-$SCRIPT_DIR/dist}"
SERVER_URL="${SERVER_URL:-http://127.0.0.1:9720}"
ENTERPRISE_BASE="${ENTERPRISE_BASE:-}"

if [[ "$PREVIEW" == "true" ]]; then
  COS_PREFIX="openclaw-guardrail-preview"
else
  COS_PREFIX="openclaw-guardrail"
fi

# 从 enterprise base URL 推导 COS bucket（用于 coscli 上传）
COS_BUCKET=""
if [[ "$ENTERPRISE_BASE" =~ ^https?://([^.]+)\.cos\.([^.]+)\.myqcloud\.com ]]; then
  COS_BUCKET="${BASH_REMATCH[1]}"
fi

ENTERPRISE_INSTALL_URL=""
if [ -n "$ENTERPRISE_BASE" ]; then
  ENTERPRISE_BASE="${ENTERPRISE_BASE%/}"
  ENTERPRISE_INSTALL_URL="${ENTERPRISE_BASE}/${COS_PREFIX}/install.sh"
fi

mkdir -p "$OUT_DIR"

# 每次打包前清空输出目录，避免旧文件残留
if [ -d "$OUT_DIR" ]; then
  find "$OUT_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
fi

echo "═══ OpenClaw 安全围栏插件打包 ═══"
echo ""
echo "  服务地址: $SERVER_URL"
echo "  发布类型: $( [[ "$PREVIEW" == "true" ]] && echo "预览版" || echo "正式版" )"
echo "  COS 路径: $COS_PREFIX/"
if [ -n "$ENTERPRISE_INSTALL_URL" ]; then
  echo "  安装地址: $ENTERPRISE_INSTALL_URL"
fi

# 读取版本号
VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$SCRIPT_DIR/openclaw-guardrail-plugin/package.json" | head -1 | grep -o '"[^"]*"$' | tr -d '"')
echo "  插件版本: $VERSION"

# ── 同步版本号 + 写入默认配置 ──
echo ""
echo "── 同步版本号 + 写入默认配置 ──"

# 更新 openclaw.plugin.json（版本号 + server_url）
PLUGIN_JSON="$SCRIPT_DIR/openclaw-guardrail-plugin/openclaw.plugin.json"
node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('$PLUGIN_JSON', 'utf-8'));
cfg.version = '$VERSION';
cfg.configSchema = cfg.configSchema || { type: 'object', properties: {} };
cfg.configSchema.properties = cfg.configSchema.properties || {};
cfg.configSchema.properties.server_url = {
  type: 'string',
  description: '安全服务地址',
  default: '$SERVER_URL'
};
fs.writeFileSync('$PLUGIN_JSON', JSON.stringify(cfg, null, 2) + '\n');
"
echo "  ✓ openclaw.plugin.json (version=$VERSION, server_url=$SERVER_URL)"

# 同步更新 index.ts 中的 DEFAULT_SERVER_URL
sed -i.bak "s|const DEFAULT_SERVER_URL = \".*\"|const DEFAULT_SERVER_URL = \"$SERVER_URL\"|" \
  "$SCRIPT_DIR/openclaw-guardrail-plugin/src/index.ts"
rm -f "$SCRIPT_DIR/openclaw-guardrail-plugin/src/index.ts.bak"
echo "  ✓ index.ts DEFAULT_SERVER_URL → $SERVER_URL"

# ── 复制 skill 到插件目录（打包时一起带上）──
echo ""
echo "── 准备 Skill 文件 ──"
SKILL_BUNDLE_DIR="$SCRIPT_DIR/openclaw-guardrail-plugin/openclaw-guardrail"
rm -rf "$SKILL_BUNDLE_DIR" 2>/dev/null
if [ -d "$SCRIPT_DIR/openclaw-guardrail" ]; then
  cp -r "$SCRIPT_DIR/openclaw-guardrail" "$SKILL_BUNDLE_DIR"
elif [ -d "$HOME/.agents/skills/openclaw-guardrail" ]; then
  cp -r "$HOME/.agents/skills/openclaw-guardrail" "$SKILL_BUNDLE_DIR"
else
  echo "  ⚠️  未找到 openclaw-guardrail skill，跳过"
fi
if [ -d "$SKILL_BUNDLE_DIR" ]; then
  rm -f "$SKILL_BUNDLE_DIR/schema.json" 2>/dev/null
  echo "  ✓ openclaw-guardrail skill 已复制到插件目录"
fi

echo ""
echo "── 打包插件 ──"
TGZ_NAME="openclaw-guardrail-plugin-v${VERSION}.tgz"
tar -czf "$OUT_DIR/$TGZ_NAME" \
  -C "$SCRIPT_DIR/openclaw-guardrail-plugin" \
  --exclude='node_modules' \
  --exclude='.DS_Store' \
  --exclude='package-lock.json' \
  .
# 同时生成无版本号的文件名（install_plugin.sh）
cp "$OUT_DIR/$TGZ_NAME" "$OUT_DIR/openclaw-guardrail-plugin.tgz"
echo "  ✓ $OUT_DIR/$TGZ_NAME ($(du -h "$OUT_DIR/$TGZ_NAME" | cut -f1))"
echo "  ✓ $OUT_DIR/openclaw-guardrail-plugin.tgz (兼容旧地址)"

# ── 计算 sha256 校验值 ──
if command -v shasum &>/dev/null; then
  TGZ_SHA256=$(shasum -a 256 "$OUT_DIR/$TGZ_NAME" | awk '{print $1}')
elif command -v sha256sum &>/dev/null; then
  TGZ_SHA256=$(sha256sum "$OUT_DIR/$TGZ_NAME" | awk '{print $1}')
else
  echo "  ⚠ 未找到 shasum/sha256sum，跳过校验值生成"
  TGZ_SHA256=""
fi
if [ -n "$TGZ_SHA256" ]; then
  echo "$TGZ_SHA256  $TGZ_NAME" > "$OUT_DIR/$TGZ_NAME.sha256"
  echo "  ✓ sha256: $TGZ_SHA256"
fi

# ── 生成 version.json ──
cat > "$OUT_DIR/version.json" <<EOF
{
  "version": "$VERSION",
  "plugin": "$TGZ_NAME",
  "plugin_latest": "openclaw-guardrail-plugin.tgz",
  "sha256": "${TGZ_SHA256}",
  "server_url": "$SERVER_URL",
  "cos_prefix": "$COS_PREFIX",
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
echo ""
echo "  ✓ $OUT_DIR/version.json"

# ── 生成 install_plugin.sh（把服务地址烧进去）──
sed "s|__DEFAULT_SERVER__|$SERVER_URL|g" "$SCRIPT_DIR/install_plugin.sh" > "$OUT_DIR/install.sh"
chmod +x "$OUT_DIR/install.sh"
echo "  ✓ $OUT_DIR/install.sh (SERVER → $SERVER_URL)"

# ── 复制 uninstall.sh ──
cp "$SCRIPT_DIR/uninstall.sh" "$OUT_DIR/uninstall.sh"
chmod +x "$OUT_DIR/uninstall.sh"
echo "  ✓ $OUT_DIR/uninstall.sh"

# ── 生成 openclaw-install/install.sh（把企业安全插件地址烧进去）──
mkdir -p "$OUT_DIR/openclaw-install"
if [ -n "$ENTERPRISE_INSTALL_URL" ]; then
  sed "s|__ENTERPRISE_SCRIPT_URL__|$ENTERPRISE_INSTALL_URL|g" "$SCRIPT_DIR/openclaw-install/install.sh" > "$OUT_DIR/openclaw-install/install.sh"
  echo "  ✓ $OUT_DIR/openclaw-install/install.sh (→ $ENTERPRISE_INSTALL_URL)"
else
  cp "$SCRIPT_DIR/openclaw-install/install.sh" "$OUT_DIR/openclaw-install/install.sh"
  echo "  ✓ $OUT_DIR/openclaw-install/install.sh (未指定 --enterprise，使用默认)"
fi
chmod +x "$OUT_DIR/openclaw-install/install.sh"

echo ""
echo "═══ 打包完成 ═══"

rm -rf "$SKILL_BUNDLE_DIR" 2>/dev/null

UPLOADS=(
  "$OUT_DIR/$TGZ_NAME|cos://$COS_BUCKET/$COS_PREFIX/$TGZ_NAME"
  "$OUT_DIR/openclaw-guardrail-plugin.tgz|cos://$COS_BUCKET/$COS_PREFIX/openclaw-guardrail-plugin.tgz"
  "$OUT_DIR/version.json|cos://$COS_BUCKET/$COS_PREFIX/version.json"
  "$OUT_DIR/install.sh|cos://$COS_BUCKET/$COS_PREFIX/install.sh"
  "$OUT_DIR/uninstall.sh|cos://$COS_BUCKET/$COS_PREFIX/uninstall.sh"
  "$OUT_DIR/openclaw-install/install.sh|cos://$COS_BUCKET/openclaw-install/install.sh"
)

if [ "$NO_UPLOAD" = "true" ]; then
  echo ""
  echo "── 上传命令（--no-upload 模式，仅打印）──"
  for item in "${UPLOADS[@]}"; do
    src="${item%%|*}"
    dst="${item##*|}"
    echo "  coscli cp $src $dst"
  done
else
  echo ""
  echo "── 上传到 COS ──"
  for item in "${UPLOADS[@]}"; do
    src="${item%%|*}"
    dst="${item##*|}"
    echo "  上传: $src → $dst"
    coscli cp "$src" "$dst" 2>&1 | sed 's/^/    /'
  done
fi

echo ""
echo "═══ 完成 ═══"
