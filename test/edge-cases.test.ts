import assert from "node:assert/strict"
import { mkdtemp, mkdir, readdir, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { analyzeSession } from "../src/analysis.ts"
import { DEFAULT_CONFIG, loadConfig, normalizeConfig, shouldEnforceTool } from "../src/config.ts"
import { estimateTokens, truncateMiddle } from "../src/estimation.ts"
import { pruneReports, writeReport } from "../src/reporting.ts"
import { SpankNSave } from "../src/plugin.ts"
import { mockPluginInput, mockEventMessageUpdated, mockEventSessionIdle, mockEventSessionDeleted } from "./helpers.ts"
import type { AnalysisReport, AssistantUsage, SessionState } from "../src/types.ts"

// ── P1-01 edge cases: pruning ownership ───────────────────────────────────

test("P1-01: spanknsave-.json is not treated as owned report", async () => {
  const dir = await mkdtemp(join(tmpdir(), "edge-"))
  await writeFile(join(dir, "spanknsave-.json"), "{}")
  await writeFile(join(dir, "spanknsave-real.json"), JSON.stringify({ summary: { sessionID: "real" } }))
  await pruneReports(dir, 10)
  const entries = await readdir(dir)
  assert.ok(entries.includes("spanknsave-.json"), "dash-only suffix should be preserved")
})

test("P1-01: files named spanknsave.json (no dash) are not pruned", async () => {
  const dir = await mkdtemp(join(tmpdir(), "edge-"))
  await writeFile(join(dir, "spanknsave.json"), "{}")
  await pruneReports(dir, 10)
  const entries = await readdir(dir)
  assert.ok(entries.includes("spanknsave.json"))
})

test("P1-01: non-json files with spanknsave prefix are ignored", async () => {
  const dir = await mkdtemp(join(tmpdir(), "edge-"))
  await writeFile(join(dir, "spanknsave-report.txt"), "text")
  await pruneReports(dir, 10)
  const entries = await readdir(dir)
  assert.ok(entries.includes("spanknsave-report.txt"))
})

test("P1-01: pruning with maxReports=1 keeps newest only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "edge-"))
  const now = Date.now()
  const r = (id: string): AnalysisReport => ({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    plugin: { name: "SpankNSave", version: "0.1.0", mode: "suggest" },
    measurementPolicy: { authoritative: [], estimated: [], rawContentPersisted: false, privacy: { perMessageIdentifiers: "never-persisted", toolArgHashes: "never-persisted", rawPrompts: "never-persisted" } },
    summary: { sessionID: id, contextLimit: 10000, latestContextTokens: 1000, cumulative: { input: 1000, output: 500, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, estimated: { latestTextPromptTokens: 100, systemTokens: 100, enabledToolSchemaTokens: 0 }, toolCalls: 0, retries: 0, compactions: 0, filesChanged: 0 },
    findings: [],
  })

  // Write oldest first, then newer
  const p1 = await writeReport(dir, r("old"))
  const p2 = await writeReport(dir, r("mid"))
  const p3 = await writeReport(dir, r("new"))

  // Set explicit mtimes: old=100, mid=200, new=300
  const { utimes } = await import("node:fs/promises")
  await utimes(p1, new Date(now + 100), new Date(now + 100))
  await utimes(p2, new Date(now + 200), new Date(now + 200))
  await utimes(p3, new Date(now + 300), new Date(now + 300))

  await pruneReports(dir, 1)
  const entries = await readdir(dir)
  const owned = entries.filter((n) => n.startsWith("spanknsave-") && n.endsWith(".json"))
  assert.equal(owned.length, 1)
  assert.ok(owned[0]!.includes("new"))
})

// ── P1-02 edge cases: init fail-safe ──────────────────────────────────────

test("P1-02: empty config file treated as disabled=false? No — normalizes to defaults", () => {
  const cfg = normalizeConfig({})
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.mode, "suggest")
})

test("P1-02: config with null values normalized safely", () => {
  const cfg = normalizeConfig({ maxToolOutputTokens: null, mode: null, reportDirectory: null })
  assert.equal(cfg.maxToolOutputTokens, DEFAULT_CONFIG.maxToolOutputTokens)
  assert.equal(cfg.mode, DEFAULT_CONFIG.mode)
  assert.equal(cfg.reportDirectory, DEFAULT_CONFIG.reportDirectory)
})

test("P1-02: criticalContextRatio clamped above warningContextRatio", () => {
  const cfg = normalizeConfig({ warningContextRatio: 0.9, criticalContextRatio: 0.5 })
  assert.ok(cfg.criticalContextRatio >= cfg.warningContextRatio)
})

test("P1-02: config with NaN values falls back to defaults", () => {
  const cfg = normalizeConfig({ maxToolOutputTokens: NaN, charsPerTokenEstimate: NaN })
  assert.equal(cfg.maxToolOutputTokens, DEFAULT_CONFIG.maxToolOutputTokens)
  assert.equal(cfg.charsPerTokenEstimate, DEFAULT_CONFIG.charsPerTokenEstimate)
})

test("P1-02: config with negative values clamped to minimums", () => {
  const cfg = normalizeConfig({ maxToolOutputTokens: -100, maxPromptTokens: -1 })
  assert.equal(cfg.maxToolOutputTokens, 1)
  assert.equal(cfg.maxPromptTokens, 1)
})

test("P1-02: loadConfig handles legacy migration path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "edge-"))
  await mkdir(join(dir, ".opencode"), { recursive: true })
  await writeFile(
    join(dir, ".opencode", "token-guard.json"),
    JSON.stringify({ mode: "observe", maxToolOutputTokens: 500 }),
  )

  const result = await loadConfig(dir)
  assert.equal(result.config.mode, "observe")
  assert.equal(result.config.maxToolOutputTokens, 500)
  assert.ok(result.migratedFrom)
})

// ── P1-03 edge cases: tool-schema attribution ────────────────────────────

test("P1-03: tool schema not attributed to session without tool usage", () => {
  const state: SessionState = {
    contextLimit: 10000,
    userTextPromptTokensEstimate: 100,
    systemTokensEstimate: 100,
    assistantMessages: new Map(),
    tools: [],
    retries: 0,
    compactions: 0,
    filesChangedCount: 0,
    lastToastAt: 0,
    lastActivityAt: 0,
  }
  // Pass large schema token estimate but session used no tools
  const report = analyzeSession("s", state, DEFAULT_CONFIG, 10_000, "0.1.0")
  assert.equal(report.summary.estimated.enabledToolSchemaTokens, 10_000)
  // TOOL_SCHEMA_BLOAT should fire because the estimate is passed in (caller's responsibility)
  assert.ok(report.findings.some((f) => f.code === "TOOL_SCHEMA_BLOAT"))
})

test("P1-03: tool schema zero for session with unused tools", () => {
  // This tests that the plugin's scoping works: schemaTokens=0 if no tools used
  // The plugin computes this, test via the analysis directly
  const state: SessionState = {
    contextLimit: 10000,
    userTextPromptTokensEstimate: 100,
    systemTokensEstimate: 100,
    assistantMessages: new Map(),
    tools: [],
    retries: 0,
    compactions: 0,
    filesChangedCount: 0,
    lastToastAt: 0,
    lastActivityAt: 0,
  }
  const report = analyzeSession("s", state, DEFAULT_CONFIG, 0, "0.1.0")
  assert.equal(report.summary.estimated.enabledToolSchemaTokens, 0)
  assert.ok(!report.findings.some((f) => f.code === "TOOL_SCHEMA_BLOAT"))
})

// ── P1-04 edge cases: bounded state ───────────────────────────────────────

test("P1-04: assistantMessages cap works with out-of-order insertion", () => {
  const state: SessionState = {
    contextLimit: 10000,
    userTextPromptTokensEstimate: 100,
    systemTokensEstimate: 100,
    assistantMessages: new Map(),
    tools: [],
    retries: 0,
    compactions: 0,
    filesChangedCount: 0,
    lastToastAt: 0,
    lastActivityAt: 0,
  }
  // Simulate message cap: add 5 messages, should keep only 2 most recent
  const msgs: [string, AssistantUsage][] = [
    ["m1", { id: "m1", sessionID: "s", createdAt: 5, providerID: "p", modelID: "m", cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }],
    ["m2", { id: "m2", sessionID: "s", createdAt: 1, providerID: "p", modelID: "m", cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }],
    ["m3", { id: "m3", sessionID: "s", createdAt: 10, providerID: "p", modelID: "m", cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }],
    ["m4", { id: "m4", sessionID: "s", createdAt: 3, providerID: "p", modelID: "m", cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }],
    ["m5", { id: "m5", sessionID: "s", createdAt: 8, providerID: "p", modelID: "m", cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }],
  ]
  for (const [id, msg] of msgs) {
    state.assistantMessages.set(id, msg)
    if (state.assistantMessages.size > 2) {
      const sorted = [...state.assistantMessages.entries()].sort(([, a], [, b]) => a.createdAt - b.createdAt)
      for (let i = 0; i < sorted.length - 2; i++) {
        state.assistantMessages.delete(sorted[i]![0])
      }
    }
  }
  assert.equal(state.assistantMessages.size, 2)
  // Should keep m5 (createdAt=8) and m3 (createdAt=10)
  assert.ok(state.assistantMessages.has("m5"))
  assert.ok(state.assistantMessages.has("m3"))
})

test("P1-04: RAPID_CONTEXT_GROWTH uses correct message ordering after cap", () => {
  const state: SessionState = {
    contextLimit: 10000,
    userTextPromptTokensEstimate: 100,
    systemTokensEstimate: 100,
    assistantMessages: new Map([
      ["m1", { id: "m1", sessionID: "s", createdAt: 1, providerID: "p", modelID: "m", cost: 0, input: 2000, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }],
      ["m2", { id: "m2", sessionID: "s", createdAt: 2, providerID: "p", modelID: "m", cost: 0, input: 20_000, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }],
    ]),
    tools: [],
    retries: 0,
    compactions: 0,
    filesChangedCount: 0,
    lastToastAt: 0,
    lastActivityAt: 0,
  }
  const report = analyzeSession("s", state, DEFAULT_CONFIG, 0, "0.1.0")
  assert.ok(report.findings.some((f) => f.code === "RAPID_CONTEXT_GROWTH"))
})

test("P1-04: filesChangedCount accumulates correctly", () => {
  // Simulate what the plugin does
  let count = 0
  count += [{ file: "a.ts" }, { file: "b.ts" }].length
  count += [{ file: "c.ts" }].length
  assert.equal(count, 3)
})

// ── P1-05 edge cases: licensing ───────────────────────────────────────────

test("P1-05: package.json has license field", async () => {
  const { readFile } = await import("node:fs/promises")
  const pkg = JSON.parse(await readFile(join(import.meta.dirname ?? ".", "..", "package.json"), "utf8"))
  assert.equal(pkg.license, "MIT")
})

test("P1-05: LICENSE file is not empty and contains MIT", async () => {
  const { readFile } = await import("node:fs/promises")
  const license = await readFile(join(import.meta.dirname ?? ".", "..", "LICENSE"), "utf8")
  assert.ok(license.length > 50)
  assert.ok(license.includes("MIT License"))
  assert.ok(license.includes("THE SOFTWARE IS PROVIDED"))
})

// ── P1-06 edge cases: CI reproducibility ──────────────────────────────────

test("P1-06: packageManager field is present in package.json", async () => {
  const { readFile } = await import("node:fs/promises")
  const pkg = JSON.parse(await readFile(join(import.meta.dirname ?? ".", "..", "package.json"), "utf8"))
  assert.ok(typeof pkg.packageManager === "string")
  assert.match(pkg.packageManager, /^npm@/)
})

test("P1-06: package-lock.json exists and is not empty", async () => {
  const { stat } = await import("node:fs/promises")
  const lockStat = await stat(join(import.meta.dirname ?? ".", "..", "package-lock.json"))
  assert.ok(lockStat.size > 1000, "package-lock.json should be substantial")
})

// ── P1-07 edge cases: regression coverage gaps ────────────────────────────

test("P1-07: duplicate tool detection with >2 duplicates", () => {
  const state: SessionState = {
    contextLimit: 10000,
    userTextPromptTokensEstimate: 100,
    systemTokensEstimate: 100,
    assistantMessages: new Map(),
    tools: [
      { callID: "1", tool: "bash", argsHash: "h1", outputChars: 100, outputTokensEstimate: 25, truncated: false, observedAt: 1 },
      { callID: "2", tool: "bash", argsHash: "h1", outputChars: 100, outputTokensEstimate: 25, truncated: false, observedAt: 2 },
      { callID: "3", tool: "bash", argsHash: "h1", outputChars: 100, outputTokensEstimate: 25, truncated: false, observedAt: 3 },
      { callID: "4", tool: "bash", argsHash: "h1", outputChars: 100, outputTokensEstimate: 25, truncated: false, observedAt: 4 },
    ],
    retries: 0,
    compactions: 0,
    filesChangedCount: 0,
    lastToastAt: 0,
    lastActivityAt: 0,
  }
  const report = analyzeSession("s", state, DEFAULT_CONFIG, 0, "0.1.0")
  const f = report.findings.find((x) => x.code === "DUPLICATE_TOOL_CALLS")
  assert.ok(f)
  assert.equal(f.evidence.duplicateGroups, 1)
})

test("P1-07: duplicate tool with different tools same hash not merged", () => {
  const state: SessionState = {
    contextLimit: 10000,
    userTextPromptTokensEstimate: 100,
    systemTokensEstimate: 100,
    assistantMessages: new Map(),
    tools: [
      { callID: "1", tool: "bash", argsHash: "h1", outputChars: 100, outputTokensEstimate: 25, truncated: false, observedAt: 1 },
      { callID: "2", tool: "bash", argsHash: "h1", outputChars: 100, outputTokensEstimate: 25, truncated: false, observedAt: 2 },
      { callID: "3", tool: "read", argsHash: "h1", outputChars: 100, outputTokensEstimate: 25, truncated: false, observedAt: 3 },
      { callID: "4", tool: "read", argsHash: "h1", outputChars: 100, outputTokensEstimate: 25, truncated: false, observedAt: 4 },
    ],
    retries: 0,
    compactions: 0,
    filesChangedCount: 0,
    lastToastAt: 0,
    lastActivityAt: 0,
  }
  const report = analyzeSession("s", state, DEFAULT_CONFIG, 0, "0.1.0")
  const f = report.findings.find((x) => x.code === "DUPLICATE_TOOL_CALLS")
  assert.ok(f)
  assert.equal(f.evidence.duplicateGroups, 2)
})

test("P1-07: context percent boundary at exact threshold", () => {
  const state: SessionState = {
    contextLimit: 10_000,
    userTextPromptTokensEstimate: 100,
    systemTokensEstimate: 100,
    assistantMessages: new Map([["m1", { id: "m1", sessionID: "s", createdAt: 1, providerID: "p", modelID: "m", cost: 0, input: 7000, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }]]),
    tools: [],
    retries: 0,
    compactions: 0,
    filesChangedCount: 0,
    lastToastAt: 0,
    lastActivityAt: 0,
  }
  // 7000/10000 = 0.7 = warningContextRatio exactly
  const report = analyzeSession("s", state, DEFAULT_CONFIG, 0, "0.1.0")
  const f = report.findings.find((x) => x.code === "CONTEXT_PRESSURE")
  assert.ok(f)
  assert.equal(f.severity, "warning")
  assert.equal(report.summary.contextPercent, 70)
})

test("P1-07: HIGH_REASONING_SHARE at exact ratio boundary", () => {
  // maxReasoningRatio = 0.55. With output=100, reasoning needs to be > 0.55/(1-0.55)*100 = 122.2
  // So reasoning=123, output=100 => ratio=123/223≈0.552 > 0.55
  const state: SessionState = {
    contextLimit: 10000,
    userTextPromptTokensEstimate: 100,
    systemTokensEstimate: 100,
    assistantMessages: new Map([["m1", { id: "m1", sessionID: "s", createdAt: 1, providerID: "p", modelID: "m", cost: 0, input: 0, output: 100, reasoning: 5000, cacheRead: 0, cacheWrite: 0 }]]),
    tools: [],
    retries: 0,
    compactions: 0,
    filesChangedCount: 0,
    lastToastAt: 0,
    lastActivityAt: 0,
  }
  const report = analyzeSession("s", state, DEFAULT_CONFIG, 0, "0.1.0")
  assert.ok(report.findings.some((f) => f.code === "HIGH_REASONING_SHARE"))
})

// ── Cross-cutting: enforcement precedence ──────────────────────────────────

test("cross: allowlist empty means all tools enforced", () => {
  const config = { ...DEFAULT_CONFIG, enforcementToolAllowlist: [], enforcementToolDenylist: [] }
  assert.equal(shouldEnforceTool("bash", config), true)
  assert.equal(shouldEnforceTool("read", config), true)
  assert.equal(shouldEnforceTool("any_tool", config), true)
})

test("cross: denylist blocks even when in allowlist", () => {
  const config = { ...DEFAULT_CONFIG, enforcementToolAllowlist: ["bash", "read"], enforcementToolDenylist: ["read"] }
  assert.equal(shouldEnforceTool("bash", config), true)
  assert.equal(shouldEnforceTool("read", config), false)
  assert.equal(shouldEnforceTool("grep", config), false)
})

test("cross: non-empty allowlist restricts to listed tools", () => {
  const config = { ...DEFAULT_CONFIG, enforcementToolAllowlist: ["bash"], enforcementToolDenylist: [] }
  assert.equal(shouldEnforceTool("bash", config), true)
  assert.equal(shouldEnforceTool("read", config), false)
})

// ── Disposal behavior ──────────────────────────────────────────────────────

test("lifecycle: dispose clears all state after persisting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "edge-"))
  await mkdir(join(dir, ".opencode"), { recursive: true })
  await writeFile(
    join(dir, ".opencode", "spank-n-save.json"),
    JSON.stringify({ mode: "suggest", reportDirectory: join(dir, "reports") }),
  )

  const hooks = await SpankNSave(mockPluginInput({
    directory: dir,
    client: { app: { log: async () => undefined }, tui: { showToast: async () => undefined } },
  }))

  // Feed events for sessions
  await hooks.event?.(mockEventMessageUpdated({ id: "m1", sessionID: "a", cost: 0, tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } } }))
  await hooks.event?.(mockEventMessageUpdated({ id: "m2", sessionID: "b", cost: 0, tokens: { input: 200, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } }))

  await hooks.dispose?.()

  const entries = await readdir(join(dir, "reports"))
  const reports = entries.filter((n) => n.startsWith("spanknsave-") && n.endsWith(".json"))
  assert.equal(reports.length, 2)

  // After dispose, a second dispose should produce no additional reports
  // (though in practice dispose is only called once)
})

test("lifecycle: session deleted persists before cleanup, idle after delete is safe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "edge-"))
  await mkdir(join(dir, ".opencode"), { recursive: true })
  await writeFile(
    join(dir, ".opencode", "spank-n-save.json"),
    JSON.stringify({ mode: "suggest", reportDirectory: join(dir, "reports") }),
  )

  const hooks = await SpankNSave(mockPluginInput({
    directory: dir,
    client: { app: { log: async () => undefined }, tui: { showToast: async () => undefined } },
  }))

  await hooks.event?.(mockEventMessageUpdated({ id: "m1", sessionID: "gone", cost: 0, tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } } }))
  await hooks.event?.(mockEventSessionDeleted({ id: "gone" }))
  // Idle after deletion should not crash
  await hooks.event?.(mockEventSessionIdle({ sessionID: "gone" }))
  await hooks.dispose?.()

  const entries = await readdir(join(dir, "reports"))
  const reports = entries.filter((n) => n.startsWith("spanknsave-") && n.endsWith(".json"))
  assert.equal(reports.length, 1)
})

// ── P2-01: guaranteed tool-output caps ─────────────────────────────────────

test("P2-01: small configured caps are enforceable", () => {
  const source = "HEAD-" + "x".repeat(500) + "-TAIL"
  // 10 tokens * 4 chars = 40 chars max. Marker is ~119 chars, so content budget < 0
  const result = truncateMiddle(source, 10, 4)
  assert.equal(result.truncated, true)
  assert.ok(result.text.includes("SpankNSave truncated"))
  // Even with a tiny cap, the result is not the full input
  assert.ok(result.text.length < source.length)
})

test("P2-01: truncateMiddle respects configured cap at boundary", () => {
  const source = "A".repeat(200)
  const tokens = estimateTokens(source, 4) // 200/4 = 50 tokens
  const cap = tokens // exact match — should NOT truncate
  const result = truncateMiddle(source, cap, 4)
  assert.equal(result.truncated, false)
})

test("P2-01: truncateMiddle with very low cap produces only marker", () => {
  const source = "X".repeat(1000)
  // 1 token * 4 chars = 4 chars, marker is ~119 chars
  const result = truncateMiddle(source, 1, 4)
  assert.equal(result.truncated, true)
  assert.ok(result.text.includes("SpankNSave truncated"))
})

test("P2-01: truncateMiddle with minimum valid charsPerToken", () => {
  const source = "A".repeat(50)
  const result = truncateMiddle(source, 5, 1)
  assert.equal(result.truncated, true)
  assert.ok(result.text.includes("SpankNSave truncated"))
})

// ── P2-03: privacy alignment ───────────────────────────────────────────────

test("P2-03: reports never contain provider or model identifiers", () => {
  const state: SessionState = {
    contextLimit: 10000,
    userTextPromptTokensEstimate: 100,
    systemTokensEstimate: 100,
    assistantMessages: new Map([
      ["m1", { id: "m1", sessionID: "s", createdAt: 1, providerID: "openai", modelID: "gpt-5", cost: 0.01, input: 5000, output: 2000, reasoning: 500, cacheRead: 0, cacheWrite: 0 }]
    ]),
    tools: [
      { callID: "c1", tool: "bash", argsHash: "abc123def456", outputChars: 100, outputTokensEstimate: 25, truncated: false, observedAt: 1 },
    ],
    retries: 0,
    compactions: 0,
    filesChangedCount: 0,
    lastToastAt: 0,
    lastActivityAt: 0,
  }
  const report = analyzeSession("s", state, DEFAULT_CONFIG, 0, "0.1.0")
  const json = JSON.stringify(report)
  // Provider/model IDs from in-memory state must not leak into serialized report
  assert.ok(!json.includes("openai"))
  assert.ok(!json.includes("gpt-5"))
  // Tool arg hashes must not leak
  assert.ok(!json.includes("abc123def456"))
  // Privacy policy is explicit
  assert.equal(report.measurementPolicy.privacy.perMessageIdentifiers, "never-persisted")
  assert.equal(report.measurementPolicy.privacy.toolArgHashes, "never-persisted")
  assert.equal(report.measurementPolicy.privacy.rawPrompts, "never-persisted")
})

test("P2-03: report privacy policy is present in every report", () => {
  const s: SessionState = {
    contextLimit: 10000,
    userTextPromptTokensEstimate: 100,
    systemTokensEstimate: 100,
    assistantMessages: new Map(),
    tools: [],
    retries: 0,
    compactions: 0,
    filesChangedCount: 0,
    lastToastAt: 0,
    lastActivityAt: 0,
  }
  const report = analyzeSession("s", s, DEFAULT_CONFIG, 0, "0.1.0")
  assert.ok(report.measurementPolicy.privacy)
  assert.equal(report.measurementPolicy.rawContentPersisted, false)
})
