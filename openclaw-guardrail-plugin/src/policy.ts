// ─── 运行时策略状态（从 API 动态更新） ───────────────────

import type { PluginApi, SecurityPolicy, CompiledDangerousPattern } from "./types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { buildSecHeaders } from "./utils";
import { enableAuditFromPolicy, enableCommFromPolicy, commLog } from "./audit-log";

// 版本号从 package.json 读取，避免多处维护
export const PLUGIN_VERSION = (() => {
  try {
    const pkgPath = require("path").resolve(__dirname, "..", "package.json");
    return JSON.parse(require("fs").readFileSync(pkgPath, "utf-8")).version || "0.0.0";
  } catch { return "0.0.0"; }
})();
export const DEFAULT_SERVER_URL = "http://127.0.0.1:9720";
export const DEFAULT_COS_BASE = "https://your-cos-bucket.cos.ap-beijing.myqcloud.com/openclaw-guardrail";

const POLICY_CACHE_PATH = path.join(os.homedir(), ".openclaw", "plugin-configs", "openclaw-guardrail-policy.json");

function savePolicyToCache(policy: SecurityPolicy): void {
  try {
    const dir = path.dirname(POLICY_CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(POLICY_CACHE_PATH, JSON.stringify(policy, null, 2), "utf-8");
  } catch { }
}

export function loadPolicyFromCache(): SecurityPolicy | null {
  try {
    if (!fs.existsSync(POLICY_CACHE_PATH)) return null;
    const raw = fs.readFileSync(POLICY_CACHE_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object") return data as SecurityPolicy;
    return null;
  } catch { return null; }
}

/** 默认策略（API 不可达时的兜底） */
export const FALLBACK_POLICY: SecurityPolicy = {
  version: "fallback",
  blocked_domains: ["example.com", "*.example2.com"],
  sensitive_tools: ["WebFetch", "WebSearch", "Bash", "browser_navigate", "browser_click"],
  sensitive_keywords: [
    "密码", "password", "secret", "token", "api_key", "private_key",
    "身份证", "银行卡", "手机号", "薪资", "salary", "内网", "vpn",
  ],
  dangerous_commands: [
    { pattern: "\\brm\\s+(-[a-zA-Z]*rf|rf)\\b", category: "destructive", severity: "block", description: "递归强制删除 (rm -rf)" },
    { pattern: "\\brm\\s+-[a-zA-Z]*\\s+/(?!tmp)", category: "destructive", severity: "block", description: "删除根目录文件" },
    { pattern: "\\bchmod\\s+777\\b", category: "permission", severity: "block", description: "chmod 777 开放全部权限" },
    { pattern: "\\bchmod\\s+[-+]?[0-7]*s", category: "permission", severity: "block", description: "chmod 设置 SUID/SGID" },
    { pattern: "\\bchown\\s+(-R\\s+)?root", category: "permission", severity: "block", description: "chown 修改文件属主为 root" },
    { pattern: "\\bcurl\\b.*\\s+(-d\\s|--data\\b|-F\\s|--form\\b)", category: "exfiltration", severity: "block", description: "curl 外发数据" },
    { pattern: "\\bcurl\\b.*\\|\\s*bash", category: "exfiltration", severity: "block", description: "curl pipe to bash" },
    { pattern: "\\bwget\\b.*\\|\\s*bash", category: "exfiltration", severity: "block", description: "wget pipe to bash" },
    { pattern: "\\bbash\\s+-i\\s+>&?\\s*/dev/tcp/", category: "reverse_shell", severity: "block", description: "Bash 反弹 shell" },
    { pattern: "\\bnc\\b.*\\s+-e\\s+(/bin/(ba)?sh|cmd)", category: "reverse_shell", severity: "block", description: "nc 反弹 shell" },
    { pattern: "/dev/tcp/\\d+\\.\\d+\\.\\d+\\.\\d+/\\d+", category: "reverse_shell", severity: "block", description: "/dev/tcp 反弹连接" },
    { pattern: "\\bscp\\b.*\\s+\\S+@\\S+:", category: "exfiltration", severity: "block", description: "SCP 外发文件" },
    { pattern: "\\bcat\\b.*/etc/(shadow|passwd|sudoers)\\b", category: "credential_theft", severity: "block", description: "读取系统敏感文件" },
    { pattern: "\\bdd\\s+if=/dev/(sd|hd|vd|nvme)", category: "destructive", severity: "block", description: "dd 读取磁盘设备" },
    { pattern: "\\bmkfs\\b", category: "destructive", severity: "block", description: "格式化文件系统" },
    { pattern: "\\b:(){ :\\|:& };:", category: "destructive", severity: "block", description: "Fork bomb" },
    { pattern: "\\biptables\\s+(-F|--flush)", category: "network", severity: "block", description: "清空防火墙规则" },
    { pattern: "\\bsystemctl\\s+(stop|disable)\\s+(firewalld|iptables|ufw)", category: "network", severity: "block", description: "关闭防火墙" },
    { pattern: "\\bpasswd\\s+root", category: "credential_theft", severity: "block", description: "修改 root 密码" },
    { pattern: "\\buseradd\\b.*-o\\s+-u\\s+0", category: "credential_theft", severity: "block", description: "创建 UID=0 的用户" },
    { pattern: "\\becho\\b.*>\\s*/etc/(crontab|cron\\.d/)", category: "persistence", severity: "block", description: "写入定时任务" },
    { pattern: "\\bssh-keygen\\b.*&&.*\\bssh-copy-id\\b", category: "persistence", severity: "block", description: "自动部署 SSH 密钥" },
  ],
  protected_files: [
    "openclaw\\.json(\\.bak)?$",
    "openclaw\\.jsonc(\\.bak)?$",
    "\\.openclaw/config(\\.json)?(\\.bak)?$",
    "\\.openclaw/settings(\\.json)?(\\.bak)?$",
  ],
  contacts: "王五",
  scan_interval_hours: 4,
};

/**
 * Shared mutable state object.
 * Using a single object so that cross-module references in CommonJS
 * always see the latest values (object reference is stable, properties mutate).
 */
export const policyState = {
  /** 运行时服务端地址（register 时从插件配置初始化） */
  serverBaseUrl: DEFAULT_SERVER_URL,
  /** 运行时 COS 基础 URL */
  cosBaseUrl: DEFAULT_COS_BASE,
  /** 激活的设备 ID（install 时由服务端分配，存储在本地配置文件） */
  activatedDeviceId: "",
  /** 当前生效的策略（会被定时刷新） */
  currentPolicy: { ...FALLBACK_POLICY } as SecurityPolicy,
  /** 从策略生成的正则缓存 */
  domainPatterns: [] as RegExp[],
  toolPatterns: [] as RegExp[],
  keywordPattern: null as RegExp | null,
  dangerousCmdPatterns: [] as CompiledDangerousPattern[],
  protectedFilePatterns: [] as RegExp[],
};

export function getApiUrl(apiPath: string): string {
  return `${policyState.serverBaseUrl}${apiPath}`;
}

export function getVersionUrl(): string {
  return `${policyState.cosBaseUrl}/version.json`;
}

export function compilePolicy(policy: SecurityPolicy): void {
  policyState.currentPolicy = policy;

  policyState.domainPatterns = (policy.blocked_domains || []).map(
    (d) => new RegExp(d.replace(/\./g, "\\.").replace(/\*/g, "[\\w.-]*"), "i")
  );

  policyState.toolPatterns = (policy.sensitive_tools || []).map((t) => new RegExp(t, "i"));

  const keywords = policy.sensitive_keywords || [];
  if (keywords.length > 0) {
    const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    policyState.keywordPattern = new RegExp(`(${escaped.join("|")})`, "i");
  } else {
    policyState.keywordPattern = null;
  }

  policyState.dangerousCmdPatterns = [];
  for (const rule of policy.dangerous_commands || []) {
    try {
      policyState.dangerousCmdPatterns.push({
        pattern: new RegExp(rule.pattern, "i"),
        category: rule.category,
        severity: rule.severity === "block" ? "block" : "warn",
        description: rule.description,
      });
    } catch {
      // 忽略无效正则
    }
  }

  // 编译受保护文件模式
  policyState.protectedFilePatterns = [];
  for (const p of policy.protected_files || []) {
    try {
      policyState.protectedFilePatterns.push(new RegExp(p, "i"));
    } catch { }
  }
}

export async function fetchPolicy(logger: PluginApi["logger"]): Promise<boolean> {
  try {
    const url = getApiUrl("/api/v1/policy");
    commLog("req", { url, method: "GET" });
    const resp = await fetch(url, {
      headers: buildSecHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const policy = (await resp.json()) as SecurityPolicy;
      commLog("resp", { url, status: resp.status, version: policy.version });
      compilePolicy(policy);
      savePolicyToCache(policy);
      enableAuditFromPolicy((policy as unknown as Record<string, unknown>).audit_log === true);
      enableCommFromPolicy((policy as unknown as Record<string, unknown>).comm_log === true);
      (logger.debug || logger.info)(`[openclaw-guardrail] 策略已更新 (v${policy.version}，${(policy.blocked_domains || []).length} 个域名，${(policy.sensitive_keywords || []).length} 个关键字，${(policy.dangerous_commands || []).length} 条命令规则)`);
      return true;
    }
  } catch { }
  // API 不可达：尝试本地缓存，再退到硬编码兜底
  const cached = loadPolicyFromCache();
  if (cached) {
    compilePolicy(cached);
    logger.warn(`[openclaw-guardrail] 策略 API 不可达，使用本地缓存策略 (v${cached.version})`);
  } else {
    logger.warn("[openclaw-guardrail] 策略 API 不可达且无本地缓存，使用内置兜底策略");
  }
  return false;
}

/** 检查服务端是否有新版本，有则提示 */
let upgradeNotified = false;

export async function checkForUpdate(logger: PluginApi["logger"]): Promise<void> {
  if (upgradeNotified) return;
  try {
    const resp = await fetch(getVersionUrl(), { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = (await resp.json()) as { version?: string };
      const remote = data.version;
      if (remote && remote !== PLUGIN_VERSION) {
        logger.warn(`[openclaw-guardrail] 插件有新版本: ${PLUGIN_VERSION} → ${remote}，请执行升级: curl -sL ${policyState.serverBaseUrl}/install.sh | bash`);
        upgradeNotified = true;
      }
    }
  } catch { }
}
