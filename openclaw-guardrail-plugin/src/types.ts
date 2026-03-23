// ─── 类型定义 ───────────────────────────────────────────

export interface PluginApi {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  rootDir?: string;
  registrationMode: string;
  config: Record<string, any>;
  pluginConfig?: Record<string, any>;
  runtime: any;
  logger: {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
    debug?: (...args: any[]) => void;
  };
  registerTool: (tool: any, opts?: { name?: string; names?: string[] }) => void;
  registerHook: (events: string | string[], handler: (...args: any[]) => any, opts?: { name?: string; description?: string }) => void;
  registerService: (service: { id: string; start: (ctx?: any) => void | Promise<void>; stop?: (ctx?: any) => void | Promise<void> }) => void;
  on: (hookName: string, handler: (...args: any[]) => any, opts?: { priority?: number }) => void;
  resolvePath: (input: string) => string;
}

export interface Violation {
  timestamp: string;
  session_id: string;
  hook_source: string;
  category: string;
  tool_name: string;
  matched_domain: string;
  matched_keyword: string;
  action: "blocked" | "detected";
  context: string;
}

export interface SkillAuditResult {
  name: string;
  path: string;
  risk_level: "safe" | "suspicious" | "dangerous";
  issues: string[];
}

export interface ConfigIssue {
  severity: "critical" | "high" | "medium";
  description: string;
}

// ─── API 策略结构 ────────────────────────────────────────

/** 服务端下发的高危命令规则 */
export interface DangerousCommandRule {
  pattern: string;
  category: string;
  severity: "block" | "warn";
  description: string;
}

export interface SecurityPolicy {
  version: string;
  blocked_domains: string[];
  sensitive_tools: string[];
  sensitive_keywords: string[];
  dangerous_commands: DangerousCommandRule[];
  protected_files: string[];
  contacts: string;
  scan_interval_hours: number;
}

/** 编译后的高危命令规则 */
export interface CompiledDangerousPattern {
  pattern: RegExp;
  category: string;
  severity: "block" | "warn";
  description: string;
}

export interface DLPFinding {
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  file: string;
  line: number;
  match: string;
}

export interface DLPPattern {
  pattern: RegExp;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  description: string;
}

export interface Advisory {
  id?: string;
  severity?: string;
  title?: string;
  description?: string;
  fixed_in?: string;
}

export type SecurityAction = "pass" | "block" | "hint";
