// ─── DLP 扫描模式 ───────────────────────────────────────

import * as fs from "fs";
import * as path from "path";

import type { DLPFinding, DLPPattern } from "./types";
import { maskValue } from "./utils";

export const DLP_EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "vendor", "dist", "build", ".next",
  "__pycache__", ".venv", "venv", ".tox", ".cache",
  ".gradle", "target", "bin", "obj",
  "openclaw-guardrail",
]);

export const DLP_EXCLUDE_EXTS = new Set([
  ".lock", ".min.js", ".min.css", ".map",
  ".woff", ".woff2", ".ttf", ".eot", ".ico",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
  ".pdf", ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".wasm", ".exe", ".dll", ".so", ".dylib",
]);

export const DLP_FALSE_POSITIVES = new Set([
  "your_api_key_here", "changeme", "xxx", "xxxxxx", "placeholder",
  "example", "test", "fake", "mock", "dummy", "sample", "todo",
  "replace_me", "insert_key_here", "your_token_here",
]);

export const DLP_PATTERNS: DLPPattern[] = [
  // 凭证泄露
  { pattern: /(api[_-]?key|apikey)\s*[:=]\s*["']?[A-Za-z0-9_\-]{20,}/gi, category: "credential", severity: "critical", description: "疑似硬编码 API Key" },
  { pattern: /AKIA[0-9A-Z]{16}/g, category: "credential", severity: "critical", description: "AWS Access Key ID" },
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, category: "credential", severity: "critical", description: "OpenAI API Key" },
  { pattern: /sk-ant-[a-zA-Z0-9\-]{20,}/g, category: "credential", severity: "critical", description: "Anthropic API Key" },
  { pattern: /gh[ps]_[A-Za-z0-9_]{36,}/g, category: "credential", severity: "critical", description: "GitHub PAT" },
  { pattern: /(secret|token|password|passwd|pwd)\s*[:=]\s*["'][^\s"']{8,}["']/gi, category: "credential", severity: "critical", description: "疑似硬编码密码/密钥" },
  { pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g, category: "credential", severity: "critical", description: "私钥文件内容" },
  { pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, category: "credential", severity: "critical", description: "JWT Token" },
  { pattern: /(mysql|postgres|postgresql|mongodb|redis):\/{2}[^\s"']{10,}/gi, category: "credential", severity: "critical", description: "数据库连接字符串" },
  { pattern: /AKID[A-Za-z0-9]{13,}/g, category: "credential", severity: "critical", description: "腾讯云 SecretId" },
  { pattern: /LTAI[A-Za-z0-9]{12,}/g, category: "credential", severity: "critical", description: "阿里云 AccessKey ID" },
  // 内网地址
  { pattern: /https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, category: "internal_url", severity: "high", description: "内网 IP (10.x)" },
  { pattern: /https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}/g, category: "internal_url", severity: "high", description: "内网 IP (172.16-31.x)" },
  { pattern: /https?:\/\/192\.168\.\d{1,3}\.\d{1,3}/g, category: "internal_url", severity: "high", description: "内网 IP (192.168.x)" },
  { pattern: /https?:\/\/[a-zA-Z0-9._-]+\.(internal|corp|local|intranet)\b/gi, category: "internal_url", severity: "high", description: "内网域名" },
  // PII
  { pattern: /[1-9]\d{5}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g, category: "pii", severity: "high", description: "身份证号" },
  { pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g, category: "pii", severity: "high", description: "手机号" },
];

export function collectWorkspaceFiles(dir: string, maxSizeKb: number = 1024): string[] {
  const results: string[] = [];
  function walk(d: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!DLP_EXCLUDE_DIRS.has(e.name)) walk(full); continue; }
      if (!e.isFile() || DLP_EXCLUDE_EXTS.has(path.extname(e.name).toLowerCase())) continue;
      try {
        const s = fs.statSync(full);
        if (s.size / 1024 > maxSizeKb) continue;
      } catch { continue; }
      results.push(full);
    }
  }
  walk(dir);
  return results;
}

export function dlpScanFile(filePath: string): DLPFinding[] {
  const findings: DLPFinding[] = [];
  let content: string;
  try { content = fs.readFileSync(filePath, "utf-8"); } catch { return findings; }
  const lines = content.split("\n");
  const isTest = /(__tests__|\/tests?\/|\.test\.|\.spec\.|readme|example|\.md)/i.test(filePath);
  for (let i = 0; i < lines.length; i++) {
    for (const p of DLP_PATTERNS) {
      p.pattern.lastIndex = 0;
      const m = p.pattern.exec(lines[i]);
      if (m && !DLP_FALSE_POSITIVES.has(m[0].toLowerCase().replace(/["']/g, ""))) {
        findings.push({
          category: p.category,
          severity: isTest && p.severity !== "low" ? "low" : p.severity,
          file: filePath,
          line: i + 1,
          match: `${p.description}（${maskValue(m[0])}）`,
        });
      }
    }
  }
  return findings;
}

export function dlpScanWorkspace(dir: string): DLPFinding[] {
  let files = collectWorkspaceFiles(dir);
  // 大仓库只扫最近 30 天
  if (files.length > 10000) {
    const cutoff = Date.now() - 30 * 86400000;
    files = files.filter((f) => {
      try { return fs.statSync(f).mtimeMs >= cutoff; } catch { return false; }
    });
  }
  const allFindings: DLPFinding[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    for (const fd of dlpScanFile(f)) {
      const key = `${fd.file}:${fd.line}:${fd.category}`;
      if (!seen.has(key)) { seen.add(key); allFindings.push(fd); }
    }
  }
  return allFindings;
}
