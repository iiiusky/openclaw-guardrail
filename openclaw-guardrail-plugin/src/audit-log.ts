import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const BASE_DIR = path.join(os.homedir(), ".openclaw", "openclaw-guardrail");
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

let auditEnabled = false;
let auditStream: fs.WriteStream | null = null;
let commEnabled = false;
let commStream: fs.WriteStream | null = null;

function openLogStream(filePath: string): fs.WriteStream | null {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    if (stat && stat.size > MAX_LOG_SIZE) {
      const rotated = filePath.replace(/\.jsonl$/, ".prev.jsonl");
      try { fs.unlinkSync(rotated); } catch {}
      fs.renameSync(filePath, rotated);
    }
    return fs.createWriteStream(filePath, { flags: "a" });
  } catch { return null; }
}

function writeLog(stream: fs.WriteStream | null, data: Record<string, unknown>): void {
  if (!stream) return;
  try { stream.write(JSON.stringify({ ts: new Date().toISOString(), ...data }) + "\n"); } catch {}
}

export function initAuditLog(forceEnabled?: boolean): void {
  auditEnabled = forceEnabled ||
    process.env.OPENCLAW_GUARDRAIL_AUDIT_LOG === "1" ||
    process.env.OPENCLAW_GUARDRAIL_AUDIT_LOG === "true";
  if (auditEnabled && !auditStream) {
    auditStream = openLogStream(path.join(BASE_DIR, "audit", "audit.jsonl"));
  }
}

export function initCommLog(forceEnabled?: boolean): void {
  commEnabled = forceEnabled ||
    process.env.OPENCLAW_GUARDRAIL_COMM_LOG === "1" ||
    process.env.OPENCLAW_GUARDRAIL_COMM_LOG === "true";
  if (commEnabled && !commStream) {
    commStream = openLogStream(path.join(BASE_DIR, "logs", "report_log.jsonl"));
  }
}

export function enableAuditFromPolicy(policyAuditLog?: boolean): void {
  if (policyAuditLog && !auditEnabled) {
    auditEnabled = true;
    if (!auditStream) auditStream = openLogStream(path.join(BASE_DIR, "audit", "audit.jsonl"));
  } else if (!policyAuditLog && auditEnabled && !process.env.OPENCLAW_GUARDRAIL_AUDIT_LOG) {
    auditEnabled = false;
    if (auditStream) { auditStream.end(); auditStream = null; }
  }
}

export function enableCommFromPolicy(policyCommLog?: boolean): void {
  if (policyCommLog && !commEnabled) {
    commEnabled = true;
    if (!commStream) commStream = openLogStream(path.join(BASE_DIR, "logs", "report_log.jsonl"));
  } else if (!policyCommLog && commEnabled && !process.env.OPENCLAW_GUARDRAIL_COMM_LOG) {
    commEnabled = false;
    if (commStream) { commStream.end(); commStream = null; }
  }
}

export function auditLog(hook: string, data: Record<string, unknown>): void {
  if (!auditEnabled) return;
  writeLog(auditStream, { type: "audit", hook, ...data });
}

export function commLog(direction: "req" | "resp", data: Record<string, unknown>): void {
  if (!commEnabled) return;
  writeLog(commStream, { type: "comm", direction, ...data });
}

export function closeAllLogs(): void {
  if (auditStream) { auditStream.end(); auditStream = null; }
  if (commStream) { commStream.end(); commStream = null; }
}

export function isAuditEnabled(): boolean { return auditEnabled; }
export function isCommEnabled(): boolean { return commEnabled; }
