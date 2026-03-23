// ─── 工具函数 ───────────────────────────────────────────

import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { execSync } from "child_process";

import type { PluginApi, Violation, Advisory } from "./types";
import { commLog } from "./audit-log";
import { policyState, getApiUrl, PLUGIN_VERSION } from "./policy";
import { DLP_PATTERNS, DLP_FALSE_POSITIVES } from "./dlp";

const MAX_FAILED_REPORTS = 100;
const failedReportQueue: Array<{ url: string; body: string; attempts: number }> = [];

/** 构造统一请求头：Content-Type + x-sec-device-id */
export function buildSecHeaders(extra?: Record<string, string>): Record<string, string> {
  const deviceId = generateDeviceId();
  return {
    "Content-Type": "application/json",
    ...(deviceId ? { "x-sec-device-id": deviceId } : {}),
    ...extra,
  };
}

async function trySendReport(url: string, body: string): Promise<boolean> {
  try {
    commLog("req", { url, bodyLength: body.length, body: body.slice(0, 5000) });
    const resp = await fetch(url, {
      method: "POST",
      headers: buildSecHeaders(),
      body,
      signal: AbortSignal.timeout(10000),
    });
    const respText = await resp.clone().text().catch(() => "");
    commLog("resp", { url, status: resp.status, body: respText.slice(0, 2000) });
    return resp.ok;
  } catch (e) {
    commLog("resp", { url, error: String(e) });
    return false;
  }
}

function enqueueFailedReport(url: string, body: string): void {
  if (failedReportQueue.length >= MAX_FAILED_REPORTS) {
    failedReportQueue.shift();
  }
  failedReportQueue.push({ url, body, attempts: 1 });
}

export async function flushFailedReports(): Promise<number> {
  if (failedReportQueue.length === 0) return 0;
  let flushed = 0;
  const remaining: typeof failedReportQueue = [];
  for (const item of failedReportQueue) {
    if (await trySendReport(item.url, item.body)) {
      flushed++;
    } else {
      item.attempts++;
      if (item.attempts <= 5) {
        remaining.push(item);
      }
    }
  }
  failedReportQueue.length = 0;
  failedReportQueue.push(...remaining);
  return flushed;
}

export function getFailedReportCount(): number {
  return failedReportQueue.length;
}

export function containsBlockedDomain(text: string): string | null {
  for (const p of policyState.domainPatterns) {
    p.lastIndex = 0;
    const m = p.exec(text);
    if (m) return m[0];
  }
  return null;
}

export function containsSensitiveKeyword(text: string): string | null {
  if (!policyState.keywordPattern) return null;
  policyState.keywordPattern.lastIndex = 0;
  const m = policyState.keywordPattern.exec(text);
  return m ? m[0] : null;
}

export function checkToolResultContent(text: string): { hit: boolean; reason: string } {
  const domainMatch = containsBlockedDomain(text);
  if (domainMatch) {
    return { hit: true, reason: `受保护域名: ${domainMatch}` };
  }

  const keywordMatch = containsSensitiveKeyword(text);
  if (keywordMatch) {
    return { hit: true, reason: `敏感关键字: ${keywordMatch}` };
  }

  const criticalDlpPatterns = DLP_PATTERNS.filter((p) =>
    p.severity === "critical" && p.category === "credential"
  );

  for (const p of criticalDlpPatterns) {
    p.pattern.lastIndex = 0;
    const match = p.pattern.exec(text);
    const matchedText = match?.[0] || "";
    const normalized = matchedText.toLowerCase().replace(/["']/g, "");
    if (match && !DLP_FALSE_POSITIVES.has(normalized)) {
      return { hit: true, reason: `敏感数据: ${p.description}` };
    }
  }

  return { hit: false, reason: "" };
}

function readRawMachineId(): string {
  if (process.platform === "darwin") {
    const output = execSync("/usr/sbin/ioreg -rd1 -c IOPlatformExpertDevice", {
      encoding: "utf-8",
      timeout: 5000,
    });
    const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    if (match?.[1]) return match[1].trim();
    throw new Error("Failed to parse IOPlatformUUID");
  }

  if (process.platform === "linux") {
    try {
      return fs.readFileSync("/etc/machine-id", "utf-8").trim();
    } catch {
      return fs.readFileSync("/var/lib/dbus/machine-id", "utf-8").trim();
    }
  }

  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const regPath = path.join(systemRoot, "System32", "reg.exe");
    const output = execSync(
      `"${regPath}" query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid`,
      { encoding: "utf-8", timeout: 5000 },
    );
    const match = output.match(/MachineGuid\s+REG_SZ\s+(.+)/);
    if (match?.[1]) return match[1].trim();
    throw new Error("Failed to read MachineGuid");
  }

  throw new Error(`Unsupported platform: ${process.platform}`);
}

export function generateMachineId(): string {
  try {
    const rawId = readRawMachineId();
    return crypto.createHash("sha256").update(rawId).digest("hex").slice(0, 32);
  } catch {
    return crypto
      .createHash("sha256")
      .update(`${os.hostname()}:${os.userInfo().username}`)
      .digest("hex")
      .slice(0, 32);
  }
}

export function generateDeviceId(): string {
  // 优先使用激活时服务端分配的 device_id
  if (policyState.activatedDeviceId) return policyState.activatedDeviceId;
  return generateMachineId().slice(0, 16);
}

/** 提取命中关键字前后 200 字的上下文片段 */
export function extractContext(text: string, keyword: string, radius: number = 200): string {
  if (!text || !keyword) return text.slice(0, radius * 2);
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + keyword.length + radius);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}

export function maskValue(val: string): string {
  return val.length < 12 ? val.slice(0, 2) + "****" : val.slice(0, 4) + "****" + val.slice(-4);
}

const recentViolations = new Map<string, number>();
const DEDUP_WINDOW_MS = 10_000;

export async function reportViolation(violation: Violation, logger: PluginApi["logger"]): Promise<void> {
  const dedupeKey = `${violation.matched_domain || ""}|${violation.matched_keyword || ""}|${violation.action || ""}`;
  const now = Date.now();
  const lastTime = recentViolations.get(dedupeKey);
  if (lastTime && now - lastTime < DEDUP_WINDOW_MS) {
    (logger.debug || logger.info)(`[openclaw-guardrail] 违规去重跳过: ${dedupeKey}`);
    return;
  }
  recentViolations.set(dedupeKey, now);
  if (recentViolations.size > 200) {
    const cutoff = now - DEDUP_WINDOW_MS;
    for (const [k, t] of recentViolations) {
      if (t < cutoff) recentViolations.delete(k);
    }
  }

  try {
    const url = getApiUrl("/api/v1/violations");
    const safeContext = (violation.context || "").trim() ||
      `tool=${violation.tool_name || "unknown"}; action=${violation.action || "detected"}; domain=${violation.matched_domain || ""}; keyword=${violation.matched_keyword || ""}`;
    const body = JSON.stringify({
      ...violation,
      context: safeContext,
      device_id: generateDeviceId(),
      os: `${os.platform()} ${os.release()}`,
      openclaw_version: detectOpenClawVersion() || "unknown",
      plugin_version: PLUGIN_VERSION,
      hostname: os.hostname(),
      username: os.userInfo().username,
    });
    const ok = await trySendReport(url, body);
    if (!ok) {
      enqueueFailedReport(url, body);
    }
  } catch (e) {
    (logger.debug || logger.info)(`[openclaw-guardrail] 违规事件上报异常: ${e}`);
  }
}

export async function reportScanResult(scanJson: Record<string, unknown>, reportMarkdown: string, logger: PluginApi["logger"]): Promise<void> {
  await flushFailedReports();
  const url = getApiUrl("/api/v1/openclaw-report");
  const body = JSON.stringify({
    version: "2.0",
    timestamp: new Date().toISOString(),
    device_id: generateDeviceId(),
    openclaw_version: detectOpenClawVersion() || "unknown",
    os: `${os.platform()} ${os.release()}`,
    scan_json: scanJson,
    report_markdown: reportMarkdown.slice(0, 50000),
  });
  const ok = await trySendReport(url, body);
  if (!ok) {
    enqueueFailedReport(url, body);
    (logger.debug || logger.info)(`[openclaw-guardrail] 扫描报告上报失败，已加入重试队列 (队列: ${failedReportQueue.length}/${MAX_FAILED_REPORTS})`);
  } else {
    (logger.debug || logger.info)("[openclaw-guardrail] 扫描报告已上报");
  }
}

// ─── OpenClaw 版本检测 ──────────────────────────────────

/** 缓存检测到的 OpenClaw 版本 */
let openclawVersion = "";

export function detectOpenClawVersion(): string {
  if (openclawVersion) return openclawVersion;
  // 方式1: 环境变量（openclaw 启动时可能设置）
  const envVer = process.env.OPENCLAW_VERSION;
  if (envVer) { openclawVersion = envVer; return openclawVersion; }
  // 方式2: 读 openclaw 的 package.json
  const candidates = [
    path.join(os.homedir(), ".openclaw", "package.json"),
    path.join(os.homedir(), ".local", "share", "openclaw", "package.json"),
  ];
  // 方式3: 全局 node_modules
  try {
    const globalPrefix = require("child_process").execSync("npm prefix -g", { encoding: "utf-8" }).trim();
    candidates.push(path.join(globalPrefix, "lib", "node_modules", "openclaw", "package.json"));
    candidates.push(path.join(globalPrefix, "lib", "node_modules", "@anthropic", "openclaw", "package.json"));
  } catch {}
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (pkg.version) { openclawVersion = pkg.version; return openclawVersion; }
    } catch {}
  }
  // 方式4: openclaw --version
  try {
    openclawVersion = require("child_process")
      .execSync("openclaw --version 2>/dev/null", { encoding: "utf-8", timeout: 3000 })
      .trim()
      .replace(/^[vV]/, "");
  } catch {}
  return openclawVersion;
}

/** 查询 OpenClaw 已知漏洞 */
export async function checkOpenClawAdvisories(logger: PluginApi["logger"]): Promise<Advisory[]> {
  const ver = detectOpenClawVersion();
  if (!ver) return [];
  try {
    const url = `${getApiUrl("/api/v1/advisories")}?name=OpenClaw&version=${encodeURIComponent(ver)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = (await resp.json()) as { advisories?: Advisory[] };
      const advisories = data.advisories || [];
      if (advisories.length > 0) {
        logger.warn(`[openclaw-guardrail] OpenClaw ${ver} 存在 ${advisories.length} 个已知漏洞！`);
        for (const a of advisories) {
          logger.warn(`  - [${a.severity || "unknown"}] ${a.title || a.id || "漏洞"}${a.fixed_in ? ` (已在 ${a.fixed_in} 修复)` : ""}`);
        }
      }
      return advisories;
    }
  } catch {}

  try {
    const matrixUrl = `https://matrix.tencent.com/clawscan/advisories?name=OpenClaw&version=${encodeURIComponent(ver)}`;
    const resp = await fetch(matrixUrl, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = (await resp.json()) as { advisories?: Advisory[] };
      return data.advisories || [];
    }
  } catch {}

  return [];
}
