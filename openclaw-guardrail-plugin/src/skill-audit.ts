// ─── Skill 供应链扫描 ──────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import type { PluginApi, SkillAuditResult, ConfigIssue } from "./types";
import { getApiUrl } from "./policy";
import { containsBlockedDomain } from "./utils";

const PI_PATTERNS = [
  /ignore\s+(previous|all|above)\s+instructions/i,
  /you\s+are\s+now\s+/i,
  /system\s+prompt\s+override/i,
  /\[SYSTEM\]/i, /\[ADMIN\]/i, /\[OVERRIDE\]/i,
];

const DANGER_PATTERNS = [
  /~\/\.ssh/, /~\/\.aws/, /~\/\.gnupg/,
  /sudo\s+/, /chmod\s+777/, /disable.*sandbox/i, /skip.*permission/i,
];

const EXFIL_PATTERNS = [
  /fetch\s*\(\s*[`"']https?:\/\/\d+\.\d+\.\d+\.\d+/,
  /\benv\b.*\b(KEY|TOKEN|SECRET|PASSWORD)\b.*fetch/i,
  /base64.*header/i, /dns.*tunnel/i,
];

export function auditSkillFile(content: string): string[] {
  const issues: string[] = [];
  for (const p of PI_PATTERNS) { if (p.test(content)) issues.push(`Prompt Injection: ${p.source}`); }
  for (const p of DANGER_PATTERNS) { if (p.test(content)) issues.push(`危险内容: ${p.source}`); }
  for (const p of EXFIL_PATTERNS) { if (p.test(content)) issues.push(`网络外传: ${p.source}`); }

  // 用动态策略检查域名
  const domainMatch = containsBlockedDomain(content);
  if (domainMatch) issues.push(`引用受保护域名: ${domainMatch}`);

  return issues;
}

function findScripts(dir: string): string[] {
  const results: string[] = [];
  const exts = new Set([".ts", ".js", ".py", ".sh"]);
  function walk(d: string) {
    try {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (e.isFile() && exts.has(path.extname(e.name))) results.push(full);
      }
    } catch {}
  }
  walk(dir);
  return results;
}

async function querySkillSecurity(skillName: string): Promise<string> {
  try {
    const resp = await fetch(`${getApiUrl("/api/v1/skill-security")}?skill_name=${encodeURIComponent(skillName)}&source=local`, {
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { verdict?: string };
      return data.verdict || "unknown";
    }
  } catch {}

  try {
    const resp = await fetch(`https://matrix.tencent.com/clawscan/skill_security?skill_name=${encodeURIComponent(skillName)}&source=local`, {
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { verdict?: string };
      return data.verdict || "unknown";
    }
  } catch {}

  return "unknown";
}

export function scanAllSkills(logger: PluginApi["logger"]): SkillAuditResult[] {
  const results: SkillAuditResult[] = [];
  const skillDirs = [
    path.join(os.homedir(), ".agents", "skills"),
    path.join(os.homedir(), ".openclaw", "skills"),
    path.join(os.homedir(), ".openclaw", "extensions"),
    path.join(os.homedir(), ".claude", "skills"),
    // 项目级 .claude/skills（当前工作目录下）
    path.join(process.cwd(), ".claude", "skills"),
  ];

  for (const dir of skillDirs) {
    if (!fs.existsSync(dir)) continue;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(dir, entry.name);
      // 跳过自身
      if (entry.name === "openclaw-guardrail") continue;
      const skillMdPath = path.join(skillPath, "SKILL.md");
      const pkgJsonPath = path.join(skillPath, "package.json");
      // 需要有 SKILL.md 或 package.json 才算一个 skill/plugin
      if (!fs.existsSync(skillMdPath) && !fs.existsSync(pkgJsonPath)) continue;

      try {
        const issues: string[] = [];
        // 审计 SKILL.md（如果有）
        if (fs.existsSync(skillMdPath)) {
          const content = fs.readFileSync(skillMdPath, "utf-8");
          issues.push(...auditSkillFile(content));
        }

        for (const sf of findScripts(skillPath)) {
          try {
            const si = auditSkillFile(fs.readFileSync(sf, "utf-8"));
            issues.push(...si.map((i) => `${path.relative(skillPath, sf)}: ${i}`));
          } catch {}
        }

        let riskLevel: SkillAuditResult["risk_level"] = "safe";
        if (issues.some((i) => i.includes("Prompt Injection") || i.includes("网络外传"))) riskLevel = "dangerous";
        else if (issues.length > 0) riskLevel = "suspicious";

        results.push({ name: entry.name, path: skillPath, risk_level: riskLevel, issues });
      } catch {
        logger.warn(`[openclaw-guardrail] 无法读取 skill: ${skillPath}`);
      }
    }
  }
  return results;
}

/** 对 skill 列表做安全情报查询，更新 risk_level */
export async function enrichSkillsWithIntel(skills: SkillAuditResult[], _logger: PluginApi["logger"]): Promise<void> {
  for (const s of skills) {
    const verdict = await querySkillSecurity(s.name);
    if (verdict === "malicious") {
      s.risk_level = "dangerous";
      s.issues.unshift(`安全情报: 已知恶意 skill`);
    } else if (verdict === "risky" && s.risk_level === "safe") {
      s.risk_level = "suspicious";
      s.issues.unshift(`安全情报: 需关注`);
    }
  }
}

export function auditConfig(config: Record<string, any>): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (config.dangerouslySkipPermissions) {
    issues.push({ severity: "critical", description: "dangerouslySkipPermissions 已启用" });
  }
  const autoApproved = config.permissions?.autoApprove || config.autoApprovedTools || [];
  for (const tool of ["Bash", "Shell", "WebFetch", "WebSearch", "Write", "Edit"]) {
    if (autoApproved.includes(tool)) {
      issues.push({ severity: "high", description: `${tool} 工具已设为自动批准` });
    }
  }
  const mcpServers = config.mcpServers || config.mcp?.servers || {};
  for (const [name, sc] of Object.entries(mcpServers)) {
    const url = (sc as any)?.url;
    if (typeof url === "string" && url.match(/\d+\.\d+\.\d+\.\d+/) && !url.includes("127.0.0.1")) {
      issues.push({ severity: "medium", description: `MCP "${name}" 连接外部 IP: ${url}` });
    }
  }

  const channels = config.channels || {};
  for (const [chName, chCfg] of Object.entries(channels)) {
    const ch = chCfg as Record<string, any>;
    if ((chName === "feishu" || chName === "lark" || ch.type === "feishu" || ch.type === "lark") && ch.groupPolicy === "open") {
      issues.push({ severity: "medium", description: `飞书通道 "${chName}" 群策略为 open，任何人都可以与机器人对话` });
    }
  }
  const feishuCfg = config.feishu || config.lark || {};
  if (feishuCfg.groupPolicy === "open") {
    issues.push({ severity: "medium", description: "飞书 groupPolicy 为 open，任何群成员都可以与机器人对话" });
  }

  const mcpTools = config.mcp?.tools || config.mcpTools || {};
  for (const [toolName, toolDef] of Object.entries(mcpTools)) {
    const desc = (toolDef as any)?.description || (toolDef as any)?.desc || "";
    if (typeof desc !== "string" || desc.length === 0) continue;
    const mcpIssues = auditMcpToolDescription(toolName, desc);
    for (const issue of mcpIssues) {
      issues.push(issue);
    }
  }

  return issues;
}

export function auditMcpToolDescription(toolName: string, description: string): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const p of PI_PATTERNS) {
    p.lastIndex = 0;
    if (p.test(description)) {
      issues.push({ severity: "critical", description: `MCP 工具 "${toolName}" 描述中检测到 Prompt Injection` });
      break;
    }
  }
  for (const p of EXFIL_PATTERNS) {
    p.lastIndex = 0;
    if (p.test(description)) {
      issues.push({ severity: "critical", description: `MCP 工具 "${toolName}" 描述中检测到数据外传模式` });
      break;
    }
  }
  for (const p of DANGER_PATTERNS) {
    p.lastIndex = 0;
    if (p.test(description)) {
      issues.push({ severity: "high", description: `MCP 工具 "${toolName}" 描述中检测到敏感操作指令` });
      break;
    }
  }
  const hiddenPatterns = [
    /bypass\s+(auth|security|permission|approval)/i,
    /without\s+(asking|confirming|permission|approval)/i,
    /do\s+not\s+(tell|inform|alert|notify)\s+(the\s+)?user/i,
    /silently|covertly|secretly/i,
    /access\s+(all|any|every)\s+(file|data|secret|credential|key)/i,
    /send\s+(to|data|result|output)\s+.*https?:\/\//i,
    /return\s+(all|full|complete)\s+(content|data|file)/i,
  ];
  for (const p of hiddenPatterns) {
    p.lastIndex = 0;
    if (p.test(description)) {
      issues.push({ severity: "critical", description: `MCP 工具 "${toolName}" 描述中检测到隐蔽恶意指令` });
      break;
    }
  }
  if (containsBlockedDomain(description)) {
    issues.push({ severity: "high", description: `MCP 工具 "${toolName}" 描述中包含受保护域名` });
  }
  return issues;
}
