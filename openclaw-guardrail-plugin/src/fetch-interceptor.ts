import type { PluginApi } from "./types";
import { reportViolation, extractContext } from "./utils";
import { DLP_PATTERNS, DLP_FALSE_POSITIVES } from "./dlp";
import {
  SecurityAction,
  guessRequestWantsSse,
  isSseResponse,
  createBlockResponse,
  createHintResponse,
} from "./response-builder";

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function headersInitToRecord(headersInit: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headersInit) return result;

  if (headersInit instanceof Headers) {
    headersInit.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  if (Array.isArray(headersInit)) {
    for (const [key, value] of headersInit) {
      result[String(key)] = String(value);
    }
    return result;
  }

  for (const [key, value] of Object.entries(headersInit)) {
    result[key] = String(value);
  }
  return result;
}

async function bodyInitToText(body: BodyInit): Promise<string> {
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData) {
    const entries: string[] = [];
    for (const [key, value] of body.entries()) {
      if (typeof value === "string") {
        entries.push(`${key}=${value}`);
      } else {
        entries.push(`${key}=[file:${value.name}]`);
      }
    }
    return entries.join("&");
  }
  if (body instanceof Blob) {
    return body.text();
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body).toString("utf-8");
  }
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("utf-8");
  }
  if (body instanceof ReadableStream) {
    return "";
  }
  return "";
}

export function installFetchInterceptor(api: PluginApi, logger: PluginApi["logger"]): void {
  const originalFetch = globalThis.fetch;
  if (!originalFetch) {
    logger.warn("[openclaw-guardrail] globalThis.fetch 不可用，跳过 fetch 拦截");
    return;
  }

  let providerUrls: string[] = [];
  let lastConfigTouch: unknown = undefined;

  function refreshProviderUrls(): void {
    const config = api.config || {};
    const touched = config.meta?.lastTouchedAt;
    if (touched === lastConfigTouch && providerUrls.length > 0) return;
    lastConfigTouch = touched;

    const providersRaw = config.models?.providers;
    if (!providersRaw || typeof providersRaw !== "object") {
      providerUrls = [];
      return;
    }

    const urls: string[] = [];
    for (const provider of Object.values(providersRaw as Record<string, unknown>)) {
      if (!provider || typeof provider !== "object") continue;
      const baseUrl = (provider as { baseUrl?: unknown }).baseUrl;
      if (typeof baseUrl === "string" && baseUrl.length > 0) {
        urls.push(baseUrl);
      }
    }
    providerUrls = urls;
  }

  function matchesProvider(url: string): boolean {
    refreshProviderUrls();
    return providerUrls.some((base) => url.startsWith(base));
  }

  function checkContent(text: string): { action: SecurityAction; reason: string } {
    const criticalDlp = DLP_PATTERNS.filter((p) => p.severity === "critical" && p.category === "credential");
    for (const p of criticalDlp) {
      p.pattern.lastIndex = 0;
      const m = p.pattern.exec(text);
      const normalized = (m?.[0] || "").toLowerCase().replace(/["']/g, "");
      if (m && !DLP_FALSE_POSITIVES.has(normalized)) {
        return { action: "block", reason: `敏感数据: ${p.description}` };
      }
    }

    return { action: "pass", reason: "" };
  }

  function getUrl(input: RequestInfo | URL): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    if (input instanceof Request) return input.url;
    return String(input);
  }

  async function getBodyText(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
    if (init?.body) {
      return bodyInitToText(init.body);
    }
    if (input instanceof Request) {
      try {
        return await input.clone().text();
      } catch {
        return "";
      }
    }
    return "";
  }

  function getHeaders(input: RequestInfo | URL, init?: RequestInit): Record<string, string> {
    const requestHeaders = input instanceof Request ? headersToRecord(input.headers) : {};
    const initHeaders = headersInitToRecord(init?.headers);
    return { ...requestHeaders, ...initHeaders };
  }

  const wrappedFetch: typeof globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = getUrl(input);
    if (!matchesProvider(url)) return originalFetch(input, init);

    const bodyText = await getBodyText(input, init);
    const headers = getHeaders(input, init);

    const reqCheck = checkContent(bodyText);
    if (reqCheck.action === "block") {
      const wantsSse = guessRequestWantsSse(url, headers, bodyText);
      logger.warn(`[openclaw-guardrail] LLM 请求被 fetch 拦截: ${reqCheck.reason}`);
      reportViolation({
        timestamp: new Date().toISOString(),
        session_id: "fetch-intercept",
        hook_source: "fetch_interceptor",
        category: "llm_intercept",
        tool_name: "",
        matched_domain: "",
        matched_keyword: reqCheck.reason,
        action: "blocked",
        context: extractContext(bodyText, reqCheck.reason.split(": ")[1] || ""),
      }, logger);
      return createBlockResponse(wantsSse, `🔒 安全策略已拦截此请求: ${reqCheck.reason}`);
    }

    const resp = await originalFetch(input, init);

    let respBody = "";
    try {
      respBody = await resp.clone().text();
    } catch {
      respBody = "";
    }

    const respCheck = checkContent(respBody);
    const sse = isSseResponse(resp);

    if (respCheck.action === "block") {
      logger.warn(`[openclaw-guardrail] LLM 响应被 fetch 拦截: ${respCheck.reason}`);
      reportViolation({
        timestamp: new Date().toISOString(),
        session_id: "fetch-intercept",
        hook_source: "fetch_interceptor",
        category: "llm_intercept",
        tool_name: "",
        matched_domain: "",
        matched_keyword: respCheck.reason,
        action: "blocked",
        context: extractContext(respBody, respCheck.reason.split(": ")[1] || ""),
      }, logger);
      return createBlockResponse(sse, `🔒 安全策略已拦截此响应: ${respCheck.reason}`);
    }

    if (respCheck.action === "hint") {
      (logger.debug || logger.info)(`[openclaw-guardrail] LLM 响应追加安全提示: ${respCheck.reason}`);
      const hinted = createHintResponse(resp, respBody, `\n\n⚠️ 安全提示: ${respCheck.reason}`, sse);
      if (hinted) return hinted;
    }

    return resp;
  };

  Object.assign(wrappedFetch, originalFetch);
  globalThis.fetch = wrappedFetch;
  (logger.debug || logger.info)("[openclaw-guardrail] fetch 拦截器已安装");
}
