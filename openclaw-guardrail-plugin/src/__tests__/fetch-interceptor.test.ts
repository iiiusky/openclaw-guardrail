/**
 * Minimal compatibility/regression test for the fetch interceptor path.
 *
 * Covers:
 *   1. collectProviderBaseUrls — provider URL discovery from config shapes
 *   2. createProviderUrlMatcher — matching/non-matching URL logic
 *   3. installFetchInterceptor — full interception flow (block on credential in request body)
 *
 * Run:  npx tsx src/__tests__/fetch-interceptor.test.ts
 *       (or: node --experimental-strip-types src/__tests__/fetch-interceptor.test.ts)
 */

import assert from "node:assert/strict";
import {
  collectProviderBaseUrls,
  createProviderUrlMatcher,
  installFetchInterceptor,
} from "../fetch-interceptor";
import type { PluginApi } from "../types";

// ── Helpers ──────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  const p = Promise.resolve().then(fn);
  return p.then(() => {
    passed++;
    console.log(`  ✅ ${name}`);
  }).catch((err: unknown) => {
    failed++;
    console.error(`  ❌ ${name}`);
    console.error(`     ${err}`);
  });
}

function makeFakeApi(overrides: Partial<PluginApi> = {}): PluginApi {
  return {
    id: "test",
    name: "test",
    source: "test",
    registrationMode: "test",
    config: {},
    runtime: {},
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    registerTool: () => {},
    registerHook: () => {},
    registerService: () => {},
    on: () => {},
    resolvePath: (p: string) => p,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────

async function run() {
  console.log("\n🧪 fetch-interceptor tests\n");

  // ── 1. collectProviderBaseUrls ─────────────────────────

  await test("collectProviderBaseUrls: returns empty for missing config", () => {
    assert.deepStrictEqual(collectProviderBaseUrls(undefined), []);
    assert.deepStrictEqual(collectProviderBaseUrls({}), []);
    assert.deepStrictEqual(collectProviderBaseUrls({ models: {} }), []);
    assert.deepStrictEqual(collectProviderBaseUrls({ models: { providers: null } }), []);
  });

  await test("collectProviderBaseUrls: extracts baseUrl from providers object", () => {
    const config = {
      models: {
        providers: {
          openai: { baseUrl: "https://api.openai.com/v1" },
          anthropic: { baseUrl: "https://api.anthropic.com" },
          empty: { baseUrl: "" },
          noUrl: { name: "local" },
        },
      },
    };
    const urls = collectProviderBaseUrls(config);
    assert.strictEqual(urls.length, 2);
    assert.ok(urls.includes("https://api.openai.com/v1"));
    assert.ok(urls.includes("https://api.anthropic.com"));
  });

  await test("collectProviderBaseUrls: trims whitespace from URLs", () => {
    const config = {
      models: {
        providers: {
          p1: { baseUrl: "  https://example.com  " },
        },
      },
    };
    const urls = collectProviderBaseUrls(config);
    assert.strictEqual(urls[0], "https://example.com");
  });

  // ── 2. createProviderUrlMatcher ────────────────────────

  await test("createProviderUrlMatcher: matches provider URLs", () => {
    const api = makeFakeApi({
      config: {
        models: {
          providers: {
            openai: { baseUrl: "https://api.openai.com/v1" },
          },
        },
      },
    });
    const matcher = createProviderUrlMatcher(api);
    assert.ok(matcher("https://api.openai.com/v1/chat/completions"));
    assert.ok(!matcher("https://other-api.com/v1/chat/completions"));
    assert.ok(!matcher("https://api.openai.com/v2/models")); // different prefix
  });

  await test("createProviderUrlMatcher: returns false for empty provider list", () => {
    const api = makeFakeApi({ config: {} });
    const matcher = createProviderUrlMatcher(api);
    assert.ok(!matcher("https://api.openai.com/v1/chat/completions"));
  });

  // ── 3. installFetchInterceptor — full flow ─────────────

  await test("installFetchInterceptor: wraps globalThis.fetch", () => {
    const originalFetch = globalThis.fetch;
    const api = makeFakeApi({
      config: {
        models: {
          providers: {
            p1: { baseUrl: "https://test-llm.example.com/v1" },
          },
        },
      },
    });
    installFetchInterceptor(api, api.logger);
    assert.notStrictEqual(globalThis.fetch, originalFetch, "fetch should be wrapped");
    // Restore
    globalThis.fetch = originalFetch;
  });

  await test("installFetchInterceptor: blocks request containing credential", async () => {
    const originalFetch = globalThis.fetch;
    // Install a mock original fetch — track calls by URL to distinguish
    // provider-bound requests from side-effect calls (e.g. reportViolation).
    const providerUrl = "https://test-llm.example.com/v1/chat/completions";
    let providerFetchCalled = false;
    (globalThis as any).fetch = async (input: any, _init?: any) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url === providerUrl) providerFetchCalled = true;
      return new Response("ok");
    };

    const warnings: string[] = [];
    const api = makeFakeApi({
      config: {
        models: {
          providers: {
            p1: { baseUrl: "https://test-llm.example.com/v1" },
          },
        },
      },
      logger: {
        info: () => {},
        warn: (...args: any[]) => warnings.push(String(args[0])),
        error: () => {},
        debug: () => {},
      },
    });
    installFetchInterceptor(api, api.logger);

    // Send a request to a provider URL with a credential in the body
    const resp = await globalThis.fetch(providerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stream: true,
        messages: [{ role: "user", content: "Here is my key: sk-ant-abcdefghijklmnopqrstuvwxyz1234567890" }],
      }),
    });

    // Should be blocked — the original fetch should NOT be called for the provider URL
    // (reportViolation may call fetch for non-provider URLs, that's expected)
    assert.ok(!providerFetchCalled, "original fetch should not be called for the blocked provider URL");
    assert.strictEqual(resp.status, 200, "blocked response returns 200 for LLM compatibility");
    const body = await resp.text();
    assert.ok(body.includes("安全策略已拦截"), "blocked response should contain security message");
    assert.ok(warnings.some(w => w.includes("fetch 拦截")), "should log a warning");

    // Restore
    globalThis.fetch = originalFetch;
  });

  await test("installFetchInterceptor: passes through non-provider URLs", async () => {
    const originalFetch = globalThis.fetch;
    let passedUrl = "";
    (globalThis as any).fetch = async (input: any) => {
      passedUrl = typeof input === "string" ? input : input.url;
      return new Response("passthrough");
    };

    const api = makeFakeApi({
      config: {
        models: {
          providers: {
            p1: { baseUrl: "https://test-llm.example.com/v1" },
          },
        },
      },
    });
    installFetchInterceptor(api, api.logger);

    const resp = await globalThis.fetch("https://unrelated-api.com/data", {
      method: "GET",
    });
    assert.strictEqual(passedUrl, "https://unrelated-api.com/data");
    const body = await resp.text();
    assert.strictEqual(body, "passthrough");

    // Restore
    globalThis.fetch = originalFetch;
  });

  await test("installFetchInterceptor: passes through clean provider requests", async () => {
    const originalFetch = globalThis.fetch;
    let passedThrough = false;
    (globalThis as any).fetch = async () => {
      passedThrough = true;
      return new Response(JSON.stringify({ choices: [{ message: { content: "Hello" } }] }), {
        headers: { "content-type": "application/json" },
      });
    };

    const api = makeFakeApi({
      config: {
        models: {
          providers: {
            p1: { baseUrl: "https://test-llm.example.com/v1" },
          },
        },
      },
    });
    installFetchInterceptor(api, api.logger);

    const resp = await globalThis.fetch("https://test-llm.example.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "What is 2+2?" }],
      }),
    });

    assert.ok(passedThrough, "clean request should pass through to original fetch");
    assert.strictEqual(resp.status, 200);

    // Restore
    globalThis.fetch = originalFetch;
  });

  // ── Summary ────────────────────────────────────────────

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run();
