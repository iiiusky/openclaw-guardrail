// ─── AGENTS.md 安全策略注入 ──────────────────────────────

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import type { PluginApi } from "./types";

/** 需要替换的危险指令 */
const AGENTS_MD_SEARCH = "Don't ask permission. Just do it.";

/** 替换后的安全执行策略 */
const AGENTS_MD_SAFETY_POLICY = `## Agent Operational Policy

The agent must operate under a safety-first execution model.
Never assume permission for actions that may change system state,
files, processes, or external environments.

Default behavior:
When uncertain, ask for approval before proceeding.

## Approval Requirements

The agent MUST obtain explicit user approval before performing any of the following:

### 1. First Tool Usage in a Session

Ask for approval before:

- the first \`exec\` invocation in a session
- the first \`process\` operation in a session

After approval is granted, subsequent operations may proceed
within the approved scope unless the action is high-risk.

### 2. Filesystem Scope Approval

Approval is required when:

- accessing or operating on a folder for the first time in the session
- performing bulk directory reads outside an approved scope
- accessing system directories
- accessing hidden or configuration directories outside an approved scope

Examples:

- \`/\`
- \`/etc\`
- \`/usr\`
- \`.git\`
- \`.env\`
- \`.config\`

Once a directory is approved, the agent may perform read operations
and ordinary file operations within that directory unless the action
falls into a high-risk category.

### 3. File Operations

#### 3.1 Operations allowed within an approved folder scope

If the user has already approved a folder, the following operations
may proceed within that approved folder scope without additional approval:

- creating files
- modifying files
- renaming files
- moving files within the approved scope

These operations must stay inside the approved folder scope.

#### 3.2 Operations that always require approval

Always request approval before:

- deleting files or directories
- changing permissions
- changing ownership
- mass file operations
- moving files out of the approved scope
- moving files into a new unapproved scope

### 4. Shell / System Operations

Approval is required before executing commands that:

- install or remove packages
- start or stop services
- launch background jobs
- run long-running processes
- open network connections
- modify environment configuration
- change system settings

### 5. Process Control

Approval is required before:

- starting new processes
- attaching to existing processes
- sending signals to processes
- interacting with background sessions
- sending keystrokes to running processes

## High-Risk Operations

The following operations are always considered high-risk
and must request approval every time:

- \`rm\`
- \`rm -rf\`
- \`sudo\`
- \`chmod\`
- \`chown\`
- package installation commands
- deployment or publishing commands
- database migrations
- system configuration changes

## Approval Request Format

When requesting approval, the agent must clearly state:

1. The exact command or action
2. The target path, folder, or resource
3. Whether the operation is read-only or mutating
4. The reason the action is required

Example:

Action:
Run \`ls -la ./src\`

Target:
\`./src\`

Type:
Read-only

Reason:
Inspect project structure to locate source files.

## Allowed Without Additional Approval

Once a directory scope has been approved, the following operations
may proceed automatically within that approved scope:

### Read-only operations

- \`ls\`
- \`cat\`
- \`grep\`
- \`find\`
- \`git status\`
- \`git log\`

### Ordinary file operations

- create files
- edit files
- rename files
- move files within the approved scope

Provided they remain within the approved directory scope
and do not become high-risk actions.

## Safety Principle

Never assume permission outside the approved scope.

If an action would:

- access a new location
- delete data
- change permissions or ownership
- affect system behavior
- start processes
- modify dependencies

the agent must ask for approval first.`;

/** 标记文件：记录已注入过的 AGENTS.md 路径列表（JSON），避免重复注入 */
const INJECTION_MARKER_PATH = path.join(os.homedir(), ".openclaw", "security-reports", ".agents-md-injected");

/**
 * 查找所有可能的 AGENTS.md 文件（工作区、sandbox、项目级）
 * @param config OpenClaw 配置对象，可从中读取 agents.defaults.workspace
 */
function findAllAgentsMd(config?: Record<string, any>): string[] {
  const home = os.homedir();
  const candidates: string[] = [];

  // 1. 从 openclaw.json 配置中读取 workspace 路径（最可靠）
  const cfgWorkspace = config?.agents?.defaults?.workspace;
  if (typeof cfgWorkspace === "string" && cfgWorkspace) {
    const resolved = cfgWorkspace.replace(/^~/, home);
    candidates.push(path.join(resolved, "AGENTS.md"));
  }

  // 2. 环境变量指定的工作区
  if (process.env.OPENCLAW_WORKSPACE) {
    candidates.push(path.join(process.env.OPENCLAW_WORKSPACE, "AGENTS.md"));
  }

  // 3. 默认工作区路径
  candidates.push(
    path.join(home, ".openclaw", "workspace", "AGENTS.md"),
    path.join(home, ".openclaw", "AGENTS.md"),
  );

  // 4. sandbox 目录（~/.openclaw/sandboxes/ 下每个子目录）
  const sandboxesDir = path.join(home, ".openclaw", "sandboxes");
  try {
    if (fs.existsSync(sandboxesDir)) {
      for (const entry of fs.readdirSync(sandboxesDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          candidates.push(path.join(sandboxesDir, entry.name, "AGENTS.md"));
        }
      }
    }
  } catch {}

  // 5. 项目级目录（当前工作目录）
  const cwd = process.cwd();
  candidates.push(
    path.join(cwd, "AGENTS.md"),
    path.join(cwd, ".openclaw", "AGENTS.md"),
  );

  // 去重并只返回存在的文件
  const seen = new Set<string>();
  const results: string[] = [];
  for (const p of candidates) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    try {
      if (fs.existsSync(p)) results.push(p);
    } catch {}
  }
  return results;
}

/**
 * 读取已注入路径列表
 */
function getInjectedPaths(): Set<string> {
  try {
    if (fs.existsSync(INJECTION_MARKER_PATH)) {
      const data = fs.readFileSync(INJECTION_MARKER_PATH, "utf-8").trim();
      // 兼容旧格式（单路径字符串）和新格式（JSON 数组）
      if (data.startsWith("[")) {
        const arr = JSON.parse(data) as string[];
        return new Set(arr);
      }
      // 旧格式：单个路径
      return new Set([data]);
    }
  } catch {}
  return new Set();
}

/**
 * 保存已注入路径列表
 */
function saveInjectedPaths(paths: Set<string>): void {
  try {
    const reportDir = path.dirname(INJECTION_MARKER_PATH);
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(INJECTION_MARKER_PATH, JSON.stringify([...paths]), "utf-8");
  } catch {}
}

/**
 * 备份 AGENTS.md 并注入安全执行策略（处理所有找到的 AGENTS.md）
 * @param config OpenClaw 配置对象，用于读取 workspace 路径
 */
export function injectAgentsSafetyPolicy(logger: PluginApi["logger"], config?: Record<string, any>): void {
  const allPaths = findAllAgentsMd(config);
  if (allPaths.length === 0) {
    (logger.debug || logger.info)("[openclaw-guardrail] 未找到 AGENTS.md，跳过安全策略注入");
    return;
  }

  const injected = getInjectedPaths();
  let changed = false;

  for (const agentsMdPath of allPaths) {
    // 跳过已注入的
    if (injected.has(agentsMdPath)) {
      (logger.debug || logger.info)(`[openclaw-guardrail] AGENTS.md 已注入，跳过: ${agentsMdPath}`);
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(agentsMdPath, "utf-8");
    } catch (e) {
      logger.warn(`[openclaw-guardrail] 无法读取 AGENTS.md: ${agentsMdPath}`);
      continue;
    }

    if (!content.includes(AGENTS_MD_SEARCH)) {
      (logger.debug || logger.info)(`[openclaw-guardrail] AGENTS.md 中未找到目标文本，跳过替换: ${agentsMdPath}`);
      injected.add(agentsMdPath);
      changed = true;
      continue;
    }

    // 备份到报告目录
    const reportDir = path.join(os.homedir(), ".openclaw", "security-reports");
    try {
      if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const safeName = agentsMdPath.replace(/\//g, "_");
      const backupPath = path.join(reportDir, `AGENTS.md-${safeName}-${ts}`);
      fs.copyFileSync(agentsMdPath, backupPath);
      (logger.debug || logger.info)(`[openclaw-guardrail] AGENTS.md 已备份至: ${backupPath}`);
    } catch (e) {
      logger.warn(`[openclaw-guardrail] AGENTS.md 备份失败: ${e}`);
      continue; // 备份失败不做替换
    }

    // 替换
    const newContent = content.replace(AGENTS_MD_SEARCH, AGENTS_MD_SAFETY_POLICY);
    try {
      fs.writeFileSync(agentsMdPath, newContent, "utf-8");
      (logger.debug || logger.info)(`[openclaw-guardrail] AGENTS.md 已注入安全执行策略: ${agentsMdPath}`);
    } catch (e) {
      logger.warn(`[openclaw-guardrail] AGENTS.md 写入失败: ${e}`);
      continue;
    }

    injected.add(agentsMdPath);
    changed = true;
  }

  if (changed) {
    saveInjectedPaths(injected);
  }
}
