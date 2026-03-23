import { spawnSync, execSync } from "child_process";
import * as os from "os";
import { getApiUrl, PLUGIN_VERSION } from "./policy";
import { generateDeviceId, generateMachineId, detectOpenClawVersion, buildSecHeaders } from "./utils";
import { commLog } from "./audit-log";

type JsonRecord = Record<string, unknown>;

function extractJsonFromOutput(output: string): string {
  let best = "";
  let i = 0;
  while (i < output.length) {
    if (output[i] === "{") {
      let depth = 0;
      let inStr = false;
      let esc = false;
      let j = i;
      for (; j < output.length; j++) {
        const c = output[j];
        if (esc) { esc = false; continue; }
        if (c === "\\") { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === "{" || c === "[") depth++;
        if (c === "}" || c === "]") {
          depth--;
          if (depth === 0) {
            const candidate = output.slice(i, j + 1);
            if (candidate.length > best.length) {
              try { JSON.parse(candidate); best = candidate; } catch {}
            }
            break;
          }
        }
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return best;
}

function parseCliJsonObject(output: string): JsonRecord | null {
  const normalized = output.trim();
  if (!normalized) return null;
  const extracted = extractJsonFromOutput(normalized);
  if (!extracted) return null;
  try {
    const parsed = JSON.parse(extracted) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JsonRecord;
    }
    return null;
  } catch {
    return null;
  }
}

function runOpenClawJsonCommand(args: string[]): JsonRecord | null {
  const result = spawnSync("openclaw", ["--log-level", "silent", ...args], {
    encoding: "utf-8",
    timeout: 30000,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.error || result.status !== 0) {
    commLog("req", { tool: "openclaw", args, error: result.error?.message || `exit ${result.status}`, stderr: (result.stderr || "").slice(0, 500) });
    return null;
  }
  const output = result.stdout || "";
  commLog("req", { tool: "openclaw", args, outputLength: output.length, outputTail: output.slice(-500) });
  return parseCliJsonObject(output);
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (!value || typeof value !== "object") return value;

  const hiddenKeys = new Set([
    "apiKey",
    "api_key",
    "headers",
    "header",
    "auth",
    "authorization",
    "token",
    "secret",
    "password",
    "passwd",
  ]);

  const result: JsonRecord = {};
  for (const [key, val] of Object.entries(value as JsonRecord)) {
    if (hiddenKeys.has(key)) continue;
    result[key] = sanitizeValue(val);
  }
  return result;
}

function getFirstExternalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const nets of Object.values(interfaces)) {
    if (!nets) continue;
    for (const net of nets) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "";
}

function collectSkills(): unknown[] {
  const parsed = runOpenClawJsonCommand(["skills", "list", "--json"]);
  if (!parsed) return [];
  for (const key of ["skills", "items", "data", "results"]) {
    if (Array.isArray(parsed[key])) return parsed[key] as unknown[];
  }
  return [];
}

function collectPlugins(): unknown[] {
  const parsed = runOpenClawJsonCommand(["plugins", "list", "--json"]);
  if (!parsed) return [];
  for (const key of ["plugins", "items", "data", "results"]) {
    if (Array.isArray(parsed[key])) return parsed[key] as unknown[];
  }
  return [];
}

function collectProviders(config: Record<string, unknown>): unknown[] {
  const models = config.models;
  if (!models || typeof models !== "object") return [];
  const providersRaw = (models as JsonRecord).providers;
  if (!providersRaw || typeof providersRaw !== "object") return [];

  const providers: unknown[] = [];
  for (const [id, provider] of Object.entries(providersRaw as JsonRecord)) {
    if (!provider || typeof provider !== "object") continue;
    const safe = sanitizeValue(provider) as JsonRecord;
    providers.push({ id, ...safe });
  }
  return providers;
}

function collectGateway(config: Record<string, unknown>): unknown {
  const gateway = config.gateway;
  if (!gateway || typeof gateway !== "object") return {};
  const g = gateway as JsonRecord;
  return {
    port: g.port,
    mode: g.mode,
    bind: g.bind,
  };
}

function detectOpenClawVersionWithFallback(): string {
  const detected = detectOpenClawVersion();
  if (detected) return detected;
  try {
    return execSync("openclaw --version 2>/dev/null", { encoding: "utf-8", timeout: 3000 })
      .trim()
      .replace(/^[vV]/, "");
  } catch {
    return "unknown";
  }
}

export function createAssetReportService(api: { config: Record<string, unknown> }, logger: { info: (...args: unknown[]) => void; debug?: (...args: unknown[]) => void }): {
  id: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
} {
  let timer: NodeJS.Timeout | null = null;
  let initialTimer: NodeJS.Timeout | null = null;
  const INTERVAL_MS = 10 * 60 * 1000;

  async function collectAndReport(): Promise<void> {
    try {
      const payload = {
        device_id: generateDeviceId(),
        machine_id: generateMachineId(),
        plugin_version: PLUGIN_VERSION,
        openclaw_version: detectOpenClawVersionWithFallback(),
        system: {
          platform: os.platform(),
          arch: os.arch(),
          os_version: os.release(),
          hostname: os.hostname(),
          ip: getFirstExternalIp(),
        },
        skills: collectSkills(),
        plugins: collectPlugins(),
        providers: collectProviders(api.config || {}),
        gateway: collectGateway(api.config || {}),
      };

      const url = getApiUrl("/api/v1/asset-report");
      const bodyStr = JSON.stringify(payload);
      commLog("req", { url, bodyLength: bodyStr.length, skills: (payload.skills as unknown[]).length, plugins: (payload.plugins as unknown[]).length });
      const resp = await fetch(url, {
        method: "POST",
        headers: buildSecHeaders(),
        body: bodyStr,
        signal: AbortSignal.timeout(30000),
      });
      commLog("resp", { url, status: resp.status });
      (logger.debug || logger.info)("[openclaw-guardrail] 资产信息已上报");
    } catch (e) {
      (logger.debug || logger.info)(`[openclaw-guardrail] 资产上报失败: ${e}`);
    }
  }

  return {
    id: "openclaw-guardrail-asset-report",
    async start() {
      initialTimer = setTimeout(() => {
        collectAndReport().catch(() => { });
      }, 30000);
      timer = setInterval(() => {
        collectAndReport().catch(() => { });
      }, INTERVAL_MS);
      (logger.debug || logger.info)("[openclaw-guardrail] 资产上报服务已启动");
    },
    async stop() {
      if (initialTimer) {
        clearTimeout(initialTimer);
        initialTimer = null;
      }
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
