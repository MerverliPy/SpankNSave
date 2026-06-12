import assert from "node:assert/strict"
import test from "node:test"
import { analyzeSession } from "../src/analysis.ts"
import { DEFAULT_CONFIG } from "../src/config.ts"
import type { SessionState } from "../src/types.ts"

const state = (): SessionState => ({
  contextLimit: 10000,
  userPromptTokensEstimate: 100,
  systemTokensEstimate: 100,
  assistantMessages: new Map([["one", { id: "one", sessionID: "s", createdAt: 1, providerID: "p", modelID: "m", cost: 0.1, input: 8500, output: 600, reasoning: 100, cacheRead: 0, cacheWrite: 0 }]]),
  tools: [], retries: 0, compactions: 0, filesChanged: new Set(), lastToastAt: 0,
})

test("detects context pressure", () => {
  const report = analyzeSession("s", state(), DEFAULT_CONFIG, 0, "0.1.0")
  assert.ok(report.findings.some((item) => item.code === "CONTEXT_PRESSURE"))
  assert.equal(report.measurementPolicy.rawContentPersisted, false)
})
