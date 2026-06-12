import assert from "node:assert/strict"
import test from "node:test"
import { analyzeSession } from "../src/analysis.ts"
import { DEFAULT_CONFIG } from "../src/config.ts"
import type { AssistantUsage, SessionState } from "../src/types.ts"

const makeMessage = (overrides: Partial<AssistantUsage> = {}): [string, AssistantUsage] => {
  const msg: AssistantUsage = {
    id: overrides.id ?? "m",
    sessionID: "s",
    createdAt: overrides.createdAt ?? 1,
    providerID: "p",
    modelID: "m",
    cost: overrides.cost ?? 0,
    input: overrides.input ?? 100,
    output: overrides.output ?? 100,
    reasoning: overrides.reasoning ?? 0,
    cacheRead: overrides.cacheRead ?? 0,
    cacheWrite: overrides.cacheWrite ?? 0,
  }
  return [msg.id, msg]
}

const state = (overrides: Partial<SessionState> = {}): SessionState => ({
  contextLimit: overrides.contextLimit ?? 10_000,
  userPromptTokensEstimate: overrides.userPromptTokensEstimate ?? 100,
  systemTokensEstimate: overrides.systemTokensEstimate ?? 100,
  assistantMessages: overrides.assistantMessages ?? new Map(),
  tools: overrides.tools ?? [],
  retries: overrides.retries ?? 0,
  compactions: overrides.compactions ?? 0,
  filesChangedCount: overrides.filesChangedCount ?? 0,
  lastToastAt: overrides.lastToastAt ?? 0,
  lastActivityAt: overrides.lastActivityAt ?? 0,
})

const reportsFindings = (state: SessionState, toolSchema = 0, config = DEFAULT_CONFIG): string[] =>
  analyzeSession("s", state, config, toolSchema, "0.1.0").findings.map((f) => f.code)

// ── CONTEXT_PRESSURE ──────────────────────────────────────────────────────

test("CONTEXT_PRESSURE at warning threshold", () => {
  const s = state({
    assistantMessages: new Map([makeMessage({ input: 7000, output: 0 })])
  })
  assert.ok(reportsFindings(s).includes("CONTEXT_PRESSURE"))
})

test("CONTEXT_PRESSURE at critical threshold", () => {
  const s = state({
    assistantMessages: new Map([makeMessage({ input: 8500, output: 500 })])
  })
  const findings = analyzeSession("s", s, DEFAULT_CONFIG, 0, "0.1.0").findings
  const f = findings.find((x) => x.code === "CONTEXT_PRESSURE")!
  assert.equal(f.severity, "critical")
})

test("CONTEXT_PRESSURE below threshold", () => {
  const s = state({
    assistantMessages: new Map([makeMessage({ input: 1000, output: 100 })])
  })
  assert.ok(!reportsFindings(s).includes("CONTEXT_PRESSURE"))
})

test("CONTEXT_PRESSURE with zero context tokens (no total)", () => {
  const s = state({
    assistantMessages: new Map([makeMessage({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 })])
  })
  assert.ok(!reportsFindings(s).includes("CONTEXT_PRESSURE"))
})

test("CONTEXT_PRESSURE without context limit", () => {
  const s: SessionState = {
    contextLimit: undefined,
    userPromptTokensEstimate: 100,
    systemTokensEstimate: 100,
    assistantMessages: new Map([makeMessage({ input: 9500, output: 500 })]),
    tools: [],
    retries: 0,
    compactions: 0,
    filesChangedCount: 0,
    lastToastAt: 0,
    lastActivityAt: 0,
  }
  assert.ok(!reportsFindings(s).includes("CONTEXT_PRESSURE"))
})

// ── RAPID_CONTEXT_GROWTH ──────────────────────────────────────────────────

test("RAPID_CONTEXT_GROWTH positive case", () => {
  const s = state({
    assistantMessages: new Map([
      makeMessage({ id: "m1", createdAt: 1, input: 2000 }),
      makeMessage({ id: "m2", createdAt: 2, input: 15_000 }),
    ])
  })
  assert.ok(reportsFindings(s).includes("RAPID_CONTEXT_GROWTH"))
})

test("RAPID_CONTEXT_GROWTH within budget", () => {
  const s = state({
    assistantMessages: new Map([
      makeMessage({ id: "m1", createdAt: 1, input: 2000 }),
      makeMessage({ id: "m2", createdAt: 2, input: 5000 }),
    ])
  })
  assert.ok(!reportsFindings(s).includes("RAPID_CONTEXT_GROWTH"))
})

test("RAPID_CONTEXT_GROWTH single message (no previous)", () => {
  const s = state({
    assistantMessages: new Map([makeMessage({ id: "m1", input: 50_000 })])
  })
  assert.ok(!reportsFindings(s).includes("RAPID_CONTEXT_GROWTH"))
})

// ── OVERSIZED_USER_PROMPT ─────────────────────────────────────────────────

test("OVERSIZED_USER_PROMPT positive case", () => {
  const s = state({ userPromptTokensEstimate: 10_000 })
  assert.ok(reportsFindings(s).includes("OVERSIZED_USER_PROMPT"))
})

test("OVERSIZED_USER_PROMPT within budget", () => {
  const s = state({ userPromptTokensEstimate: 500 })
  assert.ok(!reportsFindings(s).includes("OVERSIZED_USER_PROMPT"))
})

test("OVERSIZED_USER_PROMPT at exact budget", () => {
  const s = state({ userPromptTokensEstimate: DEFAULT_CONFIG.maxPromptTokens })
  assert.ok(!reportsFindings(s).includes("OVERSIZED_USER_PROMPT"))
})

// ── OVERSIZED_SYSTEM_CONTEXT ──────────────────────────────────────────────

test("OVERSIZED_SYSTEM_CONTEXT positive case", () => {
  const s = state({ systemTokensEstimate: 12_000 })
  assert.ok(reportsFindings(s).includes("OVERSIZED_SYSTEM_CONTEXT"))
})

test("OVERSIZED_SYSTEM_CONTEXT within budget", () => {
  const s = state({ systemTokensEstimate: 500 })
  assert.ok(!reportsFindings(s).includes("OVERSIZED_SYSTEM_CONTEXT"))
})

test("OVERSIZED_SYSTEM_CONTEXT at budget boundary", () => {
  const s = state({ systemTokensEstimate: DEFAULT_CONFIG.maxSystemTokens })
  assert.ok(!reportsFindings(s).includes("OVERSIZED_SYSTEM_CONTEXT"))
})

// ── TOOL_SCHEMA_BLOAT ─────────────────────────────────────────────────────

test("TOOL_SCHEMA_BLOAT positive case", () => {
  const s = state()
  assert.ok(reportsFindings(s, 10_000).includes("TOOL_SCHEMA_BLOAT"))
})

test("TOOL_SCHEMA_BLOAT within budget", () => {
  const s = state()
  assert.ok(!reportsFindings(s, 1_000).includes("TOOL_SCHEMA_BLOAT"))
})

test("TOOL_SCHEMA_BLOAT at budget boundary", () => {
  const s = state()
  assert.ok(!reportsFindings(s, DEFAULT_CONFIG.maxToolSchemaTokens).includes("TOOL_SCHEMA_BLOAT"))
})

test("TOOL_SCHEMA_BLOAT confidence is low", () => {
  const s = state()
  const findings = analyzeSession("s", s, DEFAULT_CONFIG, 10_000, "0.1.0").findings
  const f = findings.find((x) => x.code === "TOOL_SCHEMA_BLOAT")!
  assert.equal(f.confidence, "low")
})

// ── OVERSIZED_TOOL_OUTPUT ─────────────────────────────────────────────────

test("OVERSIZED_TOOL_OUTPUT positive case", () => {
  const s = state({
    tools: [
      { callID: "1", tool: "bash", argsHash: "a", outputChars: 50_000, outputTokensEstimate: 10_000, truncated: false, observedAt: 1 },
    ]
  })
  assert.ok(reportsFindings(s).includes("OVERSIZED_TOOL_OUTPUT"))
})

test("OVERSIZED_TOOL_OUTPUT capped at 3 entries", () => {
  const s = state({
    tools: [
      { callID: "1", tool: "bash", argsHash: "a", outputChars: 50_000, outputTokensEstimate: 10_000, truncated: false, observedAt: 1 },
      { callID: "2", tool: "read", argsHash: "b", outputChars: 50_000, outputTokensEstimate: 10_000, truncated: false, observedAt: 2 },
      { callID: "3", tool: "grep", argsHash: "c", outputChars: 50_000, outputTokensEstimate: 10_000, truncated: false, observedAt: 3 },
      { callID: "4", tool: "glob", argsHash: "d", outputChars: 50_000, outputTokensEstimate: 10_000, truncated: false, observedAt: 4 },
    ]
  })
  const findings = analyzeSession("s", s, DEFAULT_CONFIG, 0, "0.1.0").findings
  const oversized = findings.filter((f) => f.code === "OVERSIZED_TOOL_OUTPUT")
  assert.equal(oversized.length, 3)
})

test("OVERSIZED_TOOL_OUTPUT within budget", () => {
  const s = state({
    tools: [
      { callID: "1", tool: "bash", argsHash: "a", outputChars: 50, outputTokensEstimate: 10, truncated: false, observedAt: 1 },
    ]
  })
  assert.ok(!reportsFindings(s).includes("OVERSIZED_TOOL_OUTPUT"))
})

test("OVERSIZED_TOOL_OUTPUT truncated tool marked", () => {
  const s = state({
    tools: [
      { callID: "1", tool: "bash", argsHash: "a", outputChars: 50_000, outputTokensEstimate: 10_000, truncated: true, observedAt: 1 },
    ]
  })
  const findings = analyzeSession("s", s, DEFAULT_CONFIG, 0, "0.1.0").findings
  const f = findings.find((x) => x.code === "OVERSIZED_TOOL_OUTPUT")!
  assert.equal(f.evidence.alreadyTruncated, true)
})

// ── DUPLICATE_TOOL_CALLS ──────────────────────────────────────────────────

test("DUPLICATE_TOOL_CALLS positive case", () => {
  const s = state({
    tools: [
      { callID: "1", tool: "bash", argsHash: "h1", outputChars: 100, outputTokensEstimate: 25, truncated: false, observedAt: 1 },
      { callID: "2", tool: "bash", argsHash: "h1", outputChars: 100, outputTokensEstimate: 25, truncated: false, observedAt: 2 },
    ]
  })
  assert.ok(reportsFindings(s).includes("DUPLICATE_TOOL_CALLS"))
})

test("DUPLICATE_TOOL_CALLS below threshold", () => {
  const s = state({
    tools: [
      { callID: "1", tool: "bash", argsHash: "h1", outputChars: 100, outputTokensEstimate: 25, truncated: false, observedAt: 1 },
    ]
  })
  assert.ok(!reportsFindings(s).includes("DUPLICATE_TOOL_CALLS"))
})

test("DUPLICATE_TOOL_CALLS different argsHash", () => {
  const s = state({
    tools: [
      { callID: "1", tool: "bash", argsHash: "h1", outputChars: 100, outputTokensEstimate: 25, truncated: false, observedAt: 1 },
      { callID: "2", tool: "bash", argsHash: "h2", outputChars: 100, outputTokensEstimate: 25, truncated: false, observedAt: 2 },
    ]
  })
  assert.ok(!reportsFindings(s).includes("DUPLICATE_TOOL_CALLS"))
})

test("DUPLICATE_TOOL_CALLS mixed unique and duplicate", () => {
  const s = state({
    tools: [
      { callID: "1", tool: "bash", argsHash: "h1", outputChars: 100, outputTokensEstimate: 25, truncated: false, observedAt: 1 },
      { callID: "2", tool: "bash", argsHash: "h2", outputChars: 100, outputTokensEstimate: 25, truncated: false, observedAt: 2 },
      { callID: "3", tool: "bash", argsHash: "h1", outputChars: 100, outputTokensEstimate: 25, truncated: false, observedAt: 3 },
    ]
  })
  assert.ok(reportsFindings(s).includes("DUPLICATE_TOOL_CALLS"))
})

// ── HIGH_REASONING_SHARE ──────────────────────────────────────────────────

test("HIGH_REASONING_SHARE positive case", () => {
  const s = state({
    assistantMessages: new Map([makeMessage({ output: 100, reasoning: 5000 })])
  })
  assert.ok(reportsFindings(s).includes("HIGH_REASONING_SHARE"))
})

test("HIGH_REASONING_SHARE below min reasoning", () => {
  const s = state({
    assistantMessages: new Map([makeMessage({ output: 100, reasoning: 1000 })])
  })
  assert.ok(!reportsFindings(s).includes("HIGH_REASONING_SHARE"))
})

test("HIGH_REASONING_SHARE reasonable ratio", () => {
  const s = state({
    assistantMessages: new Map([makeMessage({ output: 10000, reasoning: 1000 })])
  })
  assert.ok(!reportsFindings(s).includes("HIGH_REASONING_SHARE"))
})

test("HIGH_REASONING_SHARE severity is info", () => {
  const s = state({
    assistantMessages: new Map([makeMessage({ output: 100, reasoning: 5000 })])
  })
  const findings = analyzeSession("s", s, DEFAULT_CONFIG, 0, "0.1.0").findings
  const f = findings.find((x) => x.code === "HIGH_REASONING_SHARE")!
  assert.equal(f.severity, "info")
})

// ── EXCESSIVE_ASSISTANT_OUTPUT ────────────────────────────────────────────

test("EXCESSIVE_ASSISTANT_OUTPUT positive case", () => {
  const s = state({
    assistantMessages: new Map([makeMessage({ output: 10_000 })])
  })
  assert.ok(reportsFindings(s).includes("EXCESSIVE_ASSISTANT_OUTPUT"))
})

test("EXCESSIVE_ASSISTANT_OUTPUT within budget", () => {
  const s = state({
    assistantMessages: new Map([makeMessage({ output: 500 })])
  })
  assert.ok(!reportsFindings(s).includes("EXCESSIVE_ASSISTANT_OUTPUT"))
})

test("EXCESSIVE_ASSISTANT_OUTPUT at budget boundary", () => {
  const s = state({
    assistantMessages: new Map([makeMessage({ output: DEFAULT_CONFIG.maxAssistantOutputTokens })])
  })
  assert.ok(!reportsFindings(s).includes("EXCESSIVE_ASSISTANT_OUTPUT"))
})

// ── RETRY_WASTE ───────────────────────────────────────────────────────────

test("RETRY_WASTE positive case", () => {
  const s = state({ retries: 5 })
  assert.ok(reportsFindings(s).includes("RETRY_WASTE"))
})

test("RETRY_WASTE below threshold", () => {
  const s = state({ retries: 1 })
  assert.ok(!reportsFindings(s).includes("RETRY_WASTE"))
})

test("RETRY_WASTE at threshold", () => {
  const s = state({ retries: 2 })
  assert.ok(reportsFindings(s).includes("RETRY_WASTE"))
})

// ── Priority ordering ─────────────────────────────────────────────────────

test("findings sorted by priorityScore descending", () => {
  const s = state({
    contextLimit: 10_000,
    assistantMessages: new Map([makeMessage({ input: 7000, output: 500 })]),
    tools: [
      { callID: "1", tool: "bash", argsHash: "h1", outputChars: 10_000, outputTokensEstimate: 10_000, truncated: false, observedAt: 1 },
      { callID: "2", tool: "bash", argsHash: "h1", outputChars: 10_000, outputTokensEstimate: 10_000, truncated: false, observedAt: 2 },
    ],
    retries: 3,
    systemTokensEstimate: 10_000,
    userPromptTokensEstimate: 10_000,
  })
  const findings = analyzeSession("s", s, DEFAULT_CONFIG, 0, "0.1.0").findings
  for (let i = 1; i < findings.length; i++) {
    assert.ok(findings[i - 1]!.priorityScore >= findings[i]!.priorityScore)
  }
})

test("priorityScore in valid range", () => {
  const s = state({
    assistantMessages: new Map([makeMessage({ input: 9000, output: 1000 })]),
    retries: 5,
  })
  const findings = analyzeSession("s", s, DEFAULT_CONFIG, 0, "0.1.0").findings
  for (const f of findings) {
    assert.ok(f.priorityScore >= 0)
    assert.ok(f.priorityScore <= 100)
  }
})

// ── Zero/partial message updates ──────────────────────────────────────────

test("no findings for empty session", () => {
  const s = state()
  const findings = analyzeSession("s", s, DEFAULT_CONFIG, 0, "0.1.0").findings
  assert.equal(findings.length, 0)
})

test("message with zero total tokens produces no CONTEXT_PRESSURE", () => {
  const s = state({
    assistantMessages: new Map([makeMessage({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 })])
  })
  assert.ok(!reportsFindings(s).includes("CONTEXT_PRESSURE"))
})

test("finding codes are stable strings", () => {
  const s = state({
    contextLimit: 10_000,
    assistantMessages: new Map([makeMessage({ input: 9000, output: 10_000, reasoning: 15_000 })]),
    tools: [
      { callID: "1", tool: "bash", argsHash: "h1", outputChars: 100, outputTokensEstimate: 10_000, truncated: false, observedAt: 1 },
      { callID: "2", tool: "bash", argsHash: "h1", outputChars: 200, outputTokensEstimate: 10_000, truncated: false, observedAt: 2 },
    ],
    retries: 5,
    userPromptTokensEstimate: 10_000,
    systemTokensEstimate: 10_000,
  })
  const findings = analyzeSession("s", s, DEFAULT_CONFIG, 8_000, "0.1.0").findings
  const codes = new Set(findings.map((f) => f.code))
  const expected = new Set([
    "CONTEXT_PRESSURE",
    "OVERSIZED_USER_PROMPT",
    "OVERSIZED_SYSTEM_CONTEXT",
    "TOOL_SCHEMA_BLOAT",
    "OVERSIZED_TOOL_OUTPUT",
    "DUPLICATE_TOOL_CALLS",
    "HIGH_REASONING_SHARE",
    "EXCESSIVE_ASSISTANT_OUTPUT",
    "RETRY_WASTE",
  ])
  assert.deepEqual(codes, expected)
})

// ── Report structure ──────────────────────────────────────────────────────

test("report has required top-level fields", () => {
  const s = state({
    assistantMessages: new Map([makeMessage()])
  })
  const report = analyzeSession("my-session", s, DEFAULT_CONFIG, 0, "0.1.0")
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.summary.sessionID, "my-session")
  assert.equal(report.plugin.name, "SpankNSave")
  assert.equal(report.plugin.version, "0.1.0")
  assert.equal(report.measurementPolicy.rawContentPersisted, false)
})

test("report summary includes cumulative field", () => {
  const s = state({
    assistantMessages: new Map([
      makeMessage({ id: "m1", input: 100, output: 50, reasoning: 10, cacheRead: 5, cacheWrite: 2, cost: 0.01 }),
      makeMessage({ id: "m2", input: 200, output: 100, reasoning: 20, cacheRead: 10, cacheWrite: 4, cost: 0.02 }),
    ])
  })
  const report = analyzeSession("s", s, DEFAULT_CONFIG, 0, "0.1.0")
  assert.equal(report.summary.cumulative.input, 300)
  assert.equal(report.summary.cumulative.output, 150)
  assert.equal(report.summary.cumulative.reasoning, 30)
  assert.equal(report.summary.cumulative.cacheRead, 15)
  assert.equal(report.summary.cumulative.cacheWrite, 6)
})

test("report summary tracks session metadata correctly", () => {
  const s = state({
    contextLimit: 32_000,
    retries: 3,
    compactions: 2,
    filesChangedCount: 42,
    tools: [
      { callID: "1", tool: "bash", argsHash: "a", outputChars: 10, outputTokensEstimate: 3, truncated: false, observedAt: 1 },
      { callID: "2", tool: "read", argsHash: "b", outputChars: 20, outputTokensEstimate: 5, truncated: false, observedAt: 2 },
    ],
  })
  const report = analyzeSession("s", s, DEFAULT_CONFIG, 0, "0.1.0")
  assert.equal(report.summary.contextLimit, 32_000)
  assert.equal(report.summary.retries, 3)
  assert.equal(report.summary.compactions, 2)
  assert.equal(report.summary.filesChanged, 42)
  assert.equal(report.summary.toolCalls, 2)
})

test("enabledToolSchemaTokens appears in estimated summary", () => {
  const s = state()
  const report = analyzeSession("s", s, DEFAULT_CONFIG, 5_000, "0.1.0")
  assert.equal(report.summary.estimated.enabledToolSchemaTokens, 5_000)
})
