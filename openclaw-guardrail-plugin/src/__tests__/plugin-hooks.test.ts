/**
 * Plugin hook registration & SDK compatibility self-check.
 *
 * Verifies:
 *   1. Exactly one before_prompt_build handler (merged from previous two)
 *   2. before_prompt_build returns appendSystemContext only (no event mutation)
 *   3. before_tool_call handles missing optional fields gracefully
 *   4. Hook counts match expectations
 *
 * Run:  npx tsx src/__tests__/plugin-hooks.test.ts
 */

import assert from "node:assert/strict";
import plugin from "../index";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✅ ${name}`);
    })
    .catch((err: unknown) => {
      failed++;
      console.error(`  ❌ ${name}`);
      console.error(`     ${err}`);
    });
}

async function run() {
  console.log("\n🧪 plugin-hooks tests\n");

  // Simulate a minimal plugin registration
  const hooks: Record<string, Function[]> = {};
  const services: any[] = [];
  const tools: any[] = [];

  const fakeApi: any = {
    id: "test",
    name: "test",
    source: "test",
    registrationMode: "test",
    config: {},
    pluginConfig: {},
    runtime: {},
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    registerTool: (t: any) => tools.push(t),
    registerHook: () => {},
    registerService: (s: any) => services.push(s),
    on: (name: string, handler: Function) => {
      if (!hooks[name]) hooks[name] = [];
      hooks[name].push(handler);
    },
    resolvePath: (p: string) => p,
  };

  plugin.register(fakeApi);

  // ── 1. Hook registration counts ───────────────────────

  await test("registers exactly 1 before_prompt_build handler (merged)", () => {
    const bpb = hooks["before_prompt_build"] || [];
    assert.strictEqual(bpb.length, 1, `Expected 1 handler, got ${bpb.length}`);
  });

  await test("registers 1 before_tool_call handler", () => {
    const btc = hooks["before_tool_call"] || [];
    assert.strictEqual(btc.length, 1);
  });

  await test("registers 1 after_tool_call handler", () => {
    const atc = hooks["after_tool_call"] || [];
    assert.strictEqual(atc.length, 1);
  });

  await test("registers 1 llm_input handler", () => {
    assert.strictEqual((hooks["llm_input"] || []).length, 1);
  });

  await test("registers 1 llm_output handler", () => {
    assert.strictEqual((hooks["llm_output"] || []).length, 1);
  });

  // ── 2. before_prompt_build returns appendSystemContext ─

  await test("before_prompt_build returns { appendSystemContext } without mutating event", () => {
    const handler = hooks["before_prompt_build"]![0];
    const event = { prompt: "test prompt", messages: [{ role: "user", content: "hi" }] };
    const eventCopy = JSON.parse(JSON.stringify(event));

    const result = handler(event);

    // Should return appendSystemContext
    assert.ok(result, "handler should return a result");
    assert.ok(typeof result.appendSystemContext === "string", "result should have appendSystemContext");
    assert.ok(
      result.appendSystemContext.includes("enterprise-security-policy"),
      "appendSystemContext should contain policy block"
    );

    // Should NOT mutate event
    assert.deepStrictEqual(event, eventCopy, "event should not be mutated");

    // Should NOT return systemPrompt (we only use appendSystemContext)
    assert.strictEqual(result.systemPrompt, undefined, "should not return systemPrompt");
  });

  await test("before_prompt_build policy block contains domain and skill sections", () => {
    const handler = hooks["before_prompt_build"]![0];
    const result = handler({ prompt: "", messages: [] });
    const ctx = result.appendSystemContext as string;

    assert.ok(ctx.includes("域名访问控制"), "should contain domain access control section");
    assert.ok(ctx.includes("Skill 安装"), "should contain skill install section");
    assert.ok(ctx.includes("禁止操作"), "should contain forbidden operations section");
    assert.ok(ctx.includes("安全扫描"), "should contain security scan section");
    assert.ok(ctx.includes("敏感关键字"), "should contain sensitive keywords section");
  });

  // ── 3. before_tool_call handles missing optional fields ─

  await test("before_tool_call handles event with only toolName and params (no optional fields)", () => {
    const handler = hooks["before_tool_call"]![0];
    // Minimal event per SDK spec — only toolName and params are required
    const result = handler({ toolName: "read", params: { file_path: "/tmp/test.txt" } });
    // Should not throw; non-command, non-file-tool read should return undefined or passthrough
    // (actually "read" IS in FILE_TOOLS, so it may check file paths)
    assert.ok(result === undefined || result === null || typeof result === "object", "should not throw");
  });

  await test("before_tool_call handles MCP tool with no toolDescription/description/mcpServer", () => {
    const handler = hooks["before_tool_call"]![0];
    // MCP tool detected by name prefix, but no toolDescription field
    const result = handler({ toolName: "mcp_some_tool", params: { input: "hello" } });
    // Should not crash even though toolDescription/description/mcpServer are missing
    assert.ok(result === undefined || result === null || typeof result === "object", "should not throw");
  });

  await test("before_tool_call handles completely empty event gracefully", () => {
    const handler = hooks["before_tool_call"]![0];
    // Edge case: totally empty event
    const result = handler({});
    assert.ok(result === undefined || result === null || typeof result === "object", "should not throw");
  });

  // ── 4. Tool and service registration ──────────────────

  await test("registers openclaw_security_scan tool", () => {
    assert.ok(tools.length >= 1, "should register at least one tool");
    const scanTool = tools.find((t: any) => t.name === "openclaw_security_scan");
    assert.ok(scanTool, "should register openclaw_security_scan");
    assert.ok(typeof scanTool.execute === "function", "tool should have execute function");
  });

  await test("registers background services", () => {
    assert.ok(services.length >= 1, "should register at least one service");
  });

  // ── Summary ────────────────────────────────────────────

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run();
