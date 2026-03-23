# 功能 1：全面安全体检流程（详细）

## Step 1 平台识别

检测当前运行环境：

```bash
(which openclaw 2>/dev/null && openclaw --version 2>/dev/null || true)
(which claude 2>/dev/null && claude --version 2>/dev/null || true)
echo "workspace: $(pwd)"
node --version 2>/dev/null || true
```

判断平台类型（`openclaw` / `claude-code` / `unknown`），后续步骤会依据平台分支。

## Step 2 DLP 敏感信息检测

扫描范围：当前工作目录（大仓 >10000 文件时只扫最近 30 天修改的文件）。

检测类别：
- `credential`：API Key、私钥、JWT、数据库连接串、云厂商 AK
- `internal_url`：内网 IP (10.x/172.16-31.x/192.168.x)、内网域名 (*.internal/corp/local)
- `pii`：身份证号、手机号、银行卡号
- `business_info`：合同编号、财务数据、项目代号

输出要求：
- 必须保留 `file:line` 定位信息
- 凭证值必须脱敏（≥12 位保留首尾各 4，<12 位保留前 2，中间 `****`）

## Step 3 连接与供应链审计

### 3.1 外部连接审计

读取平台配置，提取 MCP server、API 端点、hook URL，按白名单分类。

默认白名单：`api.anthropic.com`、`api.openai.com`、`registry.npmjs.org`、`pypi.org`、`github.com`、`127.0.0.1`

命中 blocked_domains（从配置读取）的连接标记为 🔴 高危。

### 3.2 Skill 供应链审计

获取已安装 skill 列表：

```bash
openclaw skills list
```

补扫目录（确保覆盖）：
- `~/.openclaw/skills/`
- `~/.agents/skills/`
- `~/.claude/skills/`
- `<workspace>/skills/`

### 3.3 云端情报（企业优先 + matrix 兜底）

优先从 `~/.openclaw/plugin-configs/openclaw-guardrail.json` 读取 `server_url`，
未读取到时默认 `http://127.0.0.1:9720`。

调用顺序（必须严格按顺序）：
1. `${server_url}/api/v1/skill-security?skill_name=...&source=...`
2. 若 1 失败或不可达，再调用 `https://matrix.tencent.com/clawscan/skill_security?skill_name=...&source=...`

### 3.4 本地静态审计（必须按 `skill_audit_patterns.md` 的 6 步执行）

对每个 skill 执行以下检查（详见 `references/skill_audit_patterns.md`）：
- 1) 命名仿冒检测（Typosquat）
- 2) 危险权限组合检测
- 3) Prompt Injection 模式检测
- 4) 网络外传模式检测
- 5) 内容红线检测
- 6) 综合风险判定（SAFE / SUSPICIOUS / DANGEROUS / BLOCK）

仅输出中危及以上问题，输出格式：`[skill名/file:line]: 命中模式`

### 3.5 CVE 漏洞匹配

调用顺序（必须严格按顺序）：
1. `${server_url}/api/v1/advisories?name=OpenClaw&version=...`
2. 若 1 失败或不可达，再调用 `https://matrix.tencent.com/clawscan/advisories?name=OpenClaw&version=...`

```bash
openclaw --version
node --version
curl -s "${SERVER_URL}/api/v1/advisories?name=OpenClaw&version=VERSION"
```

规则：
- API 不可用时，报告写"本次未完成在线漏洞核对"，不得写"无漏洞"

## Step 4 配置安全检查

### 平台分支

**OpenClaw**：执行 `openclaw security audit --deep`，分析输出。

**Claude Code**：读取 `~/.claude/settings.json`，检查：

| 检查项 | 高危条件 |
|--------|----------|
| 权限绕过 | `dangerouslySkipPermissions` 为 true |
| Bash 自动允许 | Bash/Shell 工具设为自动批准 |
| 网络工具自动允许 | WebFetch/WebSearch 设为自动批准 |
| 文件写入自动允许 | Write/Edit 设为自动批准 |

### 通用检查（两个平台都做）

- 沙箱状态（是否启用 Docker / 内置沙箱）
- 持久化机制检测：
  - Git Hooks（`.git/hooks/`）
  - Shell RC（`.bashrc`、`.zshrc`）
  - Crontab（`crontab -l`）
  - LaunchAgents（macOS `~/Library/LaunchAgents/`）
- 隐私泄露路径（会话存储、日志留存范围）

## Step 5 保存数据（JSON + Markdown）

- 先写 JSON，再写 Markdown，时间戳一致
- JSON 符合 `references/scan-json-schema.json`
- Markdown 符合 `references/output-template-zh.md`

## Step 6 输出最终结果

- 仅输出中文报告
- 不输出实现细节、调试信息

## Step 7 更新安全策略记忆

写入规则：
1. 检查记忆中是否已有 `openclaw-guardrail-policy`
2. 不存在 → 写入完整策略（见 SKILL.md 步骤 7 的策略内容）
3. 存在但版本低于 v2.0.0 → 覆盖更新
4. 版本一致 → 跳过

写入方式：
- OpenClaw：`openclaw memory` 或写入 `~/.agents/memory/`
- Claude Code：追加到 `~/.claude/CLAUDE.md` 末尾，用 `<!-- openclaw-guardrail-policy v2.0.0 -->` 标记

策略必须包含：
- 安全扫描工具指定（openclaw-guardrail）
- 域名访问控制 → 引导读取配置文件的 `policy.blocked_domains` / `policy.allowed_domains`
- 敏感关键字 → 引导读取 `policy.sensitive_keywords`
- 高危命令规则 → 引导读取 `policy.dangerous_commands`
- 安全联系人 → 引导读取 `policy.contacts`
- 禁止在记忆中硬编码任何域名/关键字/规则列表

## 结果组织

- 综合分为：`✅ 当前未见明显高风险` / `⚠️ 需关注` / `🔴 风险`
- 风险明细按严重级排序：critical > high > medium > low
- JSON 输出字段必须符合：`references/scan-json-schema.json`
