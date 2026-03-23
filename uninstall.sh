#!/bin/bash
set -eo pipefail

DEBUG="${DEBUG:-false}"
for arg in "$@"; do [[ "$arg" == "--debug" ]] && DEBUG=true; done
debug() { [[ "$DEBUG" == "true" || "$DEBUG" == "1" ]] && echo "  [debug] $*" || true; }

echo ""
echo "OpenClaw Guardrail 卸载"
echo ""

OPENCLAW_CONFIG="$HOME/.openclaw/openclaw.json"
OK=true

if [ -f "$OPENCLAW_CONFIG" ]; then
  if command -v node &>/dev/null; then
    OC_CFG_PATH="$OPENCLAW_CONFIG" node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(process.env.OC_CFG_PATH, 'utf-8'));
if (cfg.plugins) {
  if (cfg.plugins.entries) delete cfg.plugins.entries['openclaw-guardrail'];
  if (cfg.plugins.installs) delete cfg.plugins.installs['openclaw-guardrail'];
  if (Array.isArray(cfg.plugins.allow)) {
    cfg.plugins.allow = cfg.plugins.allow.filter(x => x !== 'openclaw-guardrail');
  }
}
if (cfg.tools && Array.isArray(cfg.tools.alsoAllow)) {
  cfg.tools.alsoAllow = cfg.tools.alsoAllow.filter(x => x !== 'openclaw_security_scan');
}
fs.writeFileSync(process.env.OC_CFG_PATH, JSON.stringify(cfg, null, 2) + '\n');
" 2>/dev/null
    debug "openclaw.json 已清理"
  elif command -v python3 &>/dev/null; then
    OC_CFG_PATH="$OPENCLAW_CONFIG" python3 -c "
import json, os
p = os.environ['OC_CFG_PATH']
with open(p) as f: c = json.load(f)
pl = c.get('plugins', {})
pl.get('entries',{}).pop('openclaw-guardrail', None)
pl.get('installs',{}).pop('openclaw-guardrail', None)
a = pl.get('allow', [])
if isinstance(a, list): pl['allow'] = [x for x in a if x != 'openclaw-guardrail']
t = c.get('tools',{}).get('alsoAllow',[])
if isinstance(t, list): c['tools']['alsoAllow'] = [x for x in t if x != 'openclaw_security_scan']
with open(p,'w') as f: json.dump(c, f, indent=2); f.write('\n')
" 2>/dev/null
    debug "openclaw.json 已清理"
  else
    echo "  ⚠️  无 node/python3，请手动编辑 $OPENCLAW_CONFIG"; OK=false
  fi
else
  debug "未找到 openclaw.json，跳过"
fi

for d in \
  "$HOME/.openclaw/extensions/openclaw-guardrail" \
  "$HOME/.openclaw/skills/openclaw-guardrail" \
  "$HOME/.agents/skills/openclaw-guardrail" \
  "$HOME/.claude/skills/openclaw-guardrail" \
  "$HOME/.openclaw/plugin-configs" \
  "$HOME/.openclaw/openclaw-guardrail"; do
  if [ -d "$d" ]; then
    rm -rf "$d"
    debug "已删除 $d"
  fi
done

MEMORY_FILE="$HOME/.agents/memory/openclaw-guardrail-policy.md"
[ -f "$MEMORY_FILE" ] && rm -f "$MEMORY_FILE" && debug "已删除记忆文件"

CLAUDE_MD="$HOME/.claude/CLAUDE.md"
if [ -f "$CLAUDE_MD" ] && grep -q "openclaw-guardrail-policy-start" "$CLAUDE_MD" 2>/dev/null; then
  node -e "
const fs = require('fs');
const f = process.env.CLAUDE_MD;
let c = fs.readFileSync(f, 'utf-8');
c = c.replace(/<!-- openclaw-guardrail-policy-start[\\s\\S]*?openclaw-guardrail-policy-end -->/g, '').trim();
fs.writeFileSync(f, c + '\\n');
" 2>/dev/null && debug "已从 CLAUDE.md 移除安全策略"
fi

command -v openclaw &>/dev/null && openclaw memory delete openclaw-guardrail-policy 2>/dev/null || true

if command -v openclaw &>/dev/null; then
  openclaw gateway restart 2>/dev/null && debug "Gateway 已重启" || debug "Gateway 重启失败"
fi

if [ "$OK" = true ]; then
  echo "✅ 卸载完成"
else
  echo "⚠️  卸载完成（部分步骤需手动处理）"
fi
echo ""
