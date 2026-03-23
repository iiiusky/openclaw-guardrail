#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG="$SCRIPT_DIR/openclaw-guardrail-plugin/package.json"

CURRENT=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$PKG" | head -1 | grep -o '"[^"]*"$' | tr -d '"')
echo "当前版本: $CURRENT"

bump_type="${1:-patch}"
IFS='.' read -r major minor patch <<< "$CURRENT"

case "$bump_type" in
  patch)
    patch=$((patch + 1))
    if [ "$patch" -ge 10 ]; then
      patch=0
      minor=$((minor + 1))
    fi
    if [ "$minor" -ge 10 ]; then
      minor=0
      major=$((major + 1))
    fi
    NEW_VERSION="$major.$minor.$patch"
    ;;
  minor)
    minor=$((minor + 1))
    patch=0
    if [ "$minor" -ge 10 ]; then
      minor=0
      major=$((major + 1))
    fi
    NEW_VERSION="$major.$minor.$patch"
    ;;
  major)
    NEW_VERSION="$((major + 1)).0.0"
    ;;
  *)
    if [[ "$bump_type" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      NEW_VERSION="$bump_type"
    else
      echo "用法: $0 [patch|minor|major|x.y.z]"
      exit 1
    fi
    ;;
esac

echo "新版本:   $NEW_VERSION"
echo ""

OC_NEW_VER="$NEW_VERSION" node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('$PKG', 'utf-8'));
pkg.version = process.env.OC_NEW_VER;
fs.writeFileSync('$PKG', JSON.stringify(pkg, null, 2) + '\n');
"
echo "✓ openclaw-guardrail-plugin/package.json"

PLUGIN_JSON="$SCRIPT_DIR/openclaw-guardrail-plugin/openclaw.plugin.json"
if [ -f "$PLUGIN_JSON" ]; then
  OC_NEW_VER="$NEW_VERSION" node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('$PLUGIN_JSON', 'utf-8'));
cfg.version = process.env.OC_NEW_VER;
fs.writeFileSync('$PLUGIN_JSON', JSON.stringify(cfg, null, 2) + '\n');
"
  echo "✓ openclaw-guardrail-plugin/openclaw.plugin.json"
fi

LOCK="$SCRIPT_DIR/openclaw-guardrail-plugin/package-lock.json"
if [ -f "$LOCK" ]; then
  OC_NEW_VER="$NEW_VERSION" node -e "
const fs = require('fs');
const lock = JSON.parse(fs.readFileSync('$LOCK', 'utf-8'));
lock.version = process.env.OC_NEW_VER;
if (lock.packages && lock.packages['']) {
  lock.packages[''].version = process.env.OC_NEW_VER;
}
fs.writeFileSync('$LOCK', JSON.stringify(lock, null, 2) + '\n');
"
  echo "✓ openclaw-guardrail-plugin/package-lock.json"
fi

echo ""
echo "═══ 版本已更新: $CURRENT → $NEW_VERSION ═══"
echo ""
echo "下一步:"
echo "  git add -A && git commit -m \"chore: bump version to $NEW_VERSION\""
echo "  git tag v$NEW_VERSION"
echo "  git push && git push --tags"
