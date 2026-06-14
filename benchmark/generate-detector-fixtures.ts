import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { DEFAULT_CONFIG } from "../src/config.ts"
import type { AssistantUsage, ToolObservation } from "../src/types.ts"
import { seededRandom } from "./lib/stats.ts"

type SerializedState = {
  contextLimit?: number
  userTextPromptTokensEstimate: number
  systemTokensEstimate: number
  assistantMessages: AssistantUsage[]
  tools: ToolObservation[]
  retries: number
  compactions: number
  filesChangedCount: number
  lastToastAt: number
  lastActivityAt: number
}

type Fixture = {
  id: string
  provenance: "synthetic-conformance"
  expectedCodes: string[]
  toolSchemaTokensEstimate: number
  state: SerializedState
  note: string
}

const random = seededRandom(0x51a9cafe)
const jitter = (minimum: number, maximum: number): number =>
  Math.floor(minimum + random() * (maximum - minimum + 1))

const message = (overrides: Partial<AssistantUsage> = {}): AssistantUsage => ({
  id: overrides.id ?? "m1",
  sessionID: "benchmark-session",
  createdAt: overrides.createdAt ?? 1,
  providerID: "benchmark-provider",
  modelID: "benchmark-model",
  cost: overrides.cost ?? 0,
  input: overrides.input ?? 100,
  output: overrides.output ?? 100,
  reasoning: overrides.reasoning ?? 0,
  cacheRead: overrides.cacheRead ?? 0,
  cacheWrite: overrides.cacheWrite ?? 0,
})

const tool = (overrides: Partial<ToolObservation> = {}): ToolObservation => ({
  callID: overrides.callID ?? "call-1",
  tool: overrides.tool ?? "bash",
  argsHash: overrides.argsHash ?? "unique",
  outputChars: overrides.outputChars ?? 400,
  outputTokensEstimate: overrides.outputTokensEstimate ?? 100,
  truncated: overrides.truncated ?? false,
  observedAt: overrides.observedAt ?? 1,
})

const baseState = (overrides: Partial<SerializedState> = {}): SerializedState => ({
  contextLimit: overrides.contextLimit ?? 100_000,
  userTextPromptTokensEstimate: overrides.userTextPromptTokensEstimate ?? 100,
  systemTokensEstimate: overrides.systemTokensEstimate ?? 100,
  assistantMessages: overrides.assistantMessages ?? [],
  tools: overrides.tools ?? [],
  retries: overrides.retries ?? 0,
  compactions: overrides.compactions ?? 0,
  filesChangedCount: overrides.filesChangedCount ?? 0,
  lastToastAt: 0,
  lastActivityAt: 0,
})

const fixtures: Fixture[] = []
const add = (
  id: string,
  expectedCodes: string[],
  state: SerializedState,
  toolSchemaTokensEstimate = 0,
  note = "",
): void => {
  fixtures.push({
    id,
    provenance: "synthetic-conformance",
    expectedCodes,
    toolSchemaTokensEstimate,
    state,
    note,
  })
}

for (let index = 0; index < 30; index += 1) {
  add(
    `context-pressure-positive-${index + 1}`,
    ["CONTEXT_PRESSURE"],
    baseState({
      contextLimit: 10_000,
      assistantMessages: [message({ input: jitter(7_000, 9_500), output: 0 })],
    }),
    0,
    "Isolated context pressure above the warning threshold.",
  )

  const previousInput = jitter(500, 5_000)
  add(
    `rapid-growth-positive-${index + 1}`,
    ["RAPID_CONTEXT_GROWTH"],
    baseState({
      assistantMessages: [
        message({ id: "m1", createdAt: 1, input: previousInput, output: 100 }),
        message({ id: "m2", createdAt: 2, input: previousInput + jitter(12_001, 20_000), output: 100 }),
      ],
    }),
    0,
    "Consecutive input contexts grow beyond the configured turn budget.",
  )

  add(
    `oversized-prompt-positive-${index + 1}`,
    ["OVERSIZED_USER_PROMPT"],
    baseState({ userTextPromptTokensEstimate: jitter(4_001, 20_000) }),
  )

  add(
    `oversized-system-positive-${index + 1}`,
    ["OVERSIZED_SYSTEM_CONTEXT"],
    baseState({ systemTokensEstimate: jitter(8_001, 30_000) }),
  )

  add(
    `tool-schema-positive-${index + 1}`,
    ["TOOL_SCHEMA_BLOAT"],
    baseState(),
    jitter(5_001, 25_000),
  )

  const oversizedTokens = jitter(6_001, 30_000)
  add(
    `tool-output-positive-${index + 1}`,
    ["OVERSIZED_TOOL_OUTPUT"],
    baseState({
      tools: [tool({
        callID: `call-${index}`,
        argsHash: `hash-${index}`,
        outputTokensEstimate: oversizedTokens,
        outputChars: oversizedTokens * 4,
      })],
    }),
  )

  add(
    `duplicate-call-positive-${index + 1}`,
    ["DUPLICATE_TOOL_CALLS"],
    baseState({
      tools: [
        tool({ callID: `a-${index}`, argsHash: `same-${index}`, observedAt: 1 }),
        tool({ callID: `b-${index}`, argsHash: `same-${index}`, observedAt: 2 }),
      ],
    }),
  )

  const reasoning = jitter(4_001, 10_000)
  add(
    `reasoning-share-positive-${index + 1}`,
    ["HIGH_REASONING_SHARE"],
    baseState({ assistantMessages: [message({ reasoning, output: 100, input: 100 })] }),
  )

  add(
    `assistant-output-positive-${index + 1}`,
    ["EXCESSIVE_ASSISTANT_OUTPUT"],
    baseState({ assistantMessages: [message({ output: jitter(8_001, 20_000), input: 100 })] }),
  )

  add(
    `retry-positive-${index + 1}`,
    ["RETRY_WASTE"],
    baseState({ retries: jitter(2, 8) }),
  )
}

for (let index = 0; index < 10; index += 1) {
  add(`context-boundary-negative-${index + 1}`, [], baseState({
    contextLimit: 10_000,
    assistantMessages: [message({ input: 6_999, output: 0 })],
  }))
  add(`growth-boundary-negative-${index + 1}`, [], baseState({
    assistantMessages: [
      message({ id: "m1", createdAt: 1, input: 1_000 }),
      message({ id: "m2", createdAt: 2, input: 13_000 }),
    ],
  }))
  add(`prompt-boundary-negative-${index + 1}`, [], baseState({
    userTextPromptTokensEstimate: DEFAULT_CONFIG.maxPromptTokens,
  }))
  add(`system-boundary-negative-${index + 1}`, [], baseState({
    systemTokensEstimate: DEFAULT_CONFIG.maxSystemTokens,
  }))
  add(`schema-boundary-negative-${index + 1}`, [], baseState(), DEFAULT_CONFIG.maxToolSchemaTokens)
  add(`tool-output-boundary-negative-${index + 1}`, [], baseState({
    tools: [tool({ outputTokensEstimate: DEFAULT_CONFIG.maxToolOutputTokens, outputChars: DEFAULT_CONFIG.maxToolOutputTokens * 4 })],
  }))
  add(`duplicate-boundary-negative-${index + 1}`, [], baseState({
    tools: [
      tool({ callID: "one", argsHash: "one" }),
      tool({ callID: "two", argsHash: "two" }),
    ],
  }))
  add(`reasoning-boundary-negative-${index + 1}`, [], baseState({
    assistantMessages: [message({ reasoning: 4_000, output: 4_000 })],
  }))
  add(`assistant-output-boundary-negative-${index + 1}`, [], baseState({
    assistantMessages: [message({ output: DEFAULT_CONFIG.maxAssistantOutputTokens, input: 100 })],
  }))
  add(`retry-boundary-negative-${index + 1}`, [], baseState({ retries: 1 }))
}

for (let index = 0; index < 100; index += 1) {
  const previousInput = jitter(100, 15_000)
  const growth = jitter(-2_000, 12_000)
  const latestInput = Math.max(0, previousInput + growth)
  add(
    `clean-session-${index + 1}`,
    [],
    baseState({
      contextLimit: 100_000,
      userTextPromptTokensEstimate: jitter(0, 4_000),
      systemTokensEstimate: jitter(0, 8_000),
      assistantMessages: [
        message({ id: "m1", createdAt: 1, input: previousInput, output: jitter(0, 3_000), reasoning: jitter(0, 3_999) }),
        message({ id: "m2", createdAt: 2, input: latestInput, output: jitter(0, 3_000), reasoning: jitter(0, 3_999) }),
      ],
      tools: [tool({
        callID: `clean-${index}`,
        argsHash: `clean-${index}`,
        outputTokensEstimate: jitter(0, 6_000),
      })],
      retries: jitter(0, 1),
    }),
    jitter(0, 5_000),
    "Randomized below-threshold clean case.",
  )
}

const outputDirectory = join(process.cwd(), "benchmark", "fixtures", "detectors")
await mkdir(outputDirectory, { recursive: true })
const outputPath = join(outputDirectory, "synthetic-conformance.jsonl")
await writeFile(outputPath, `${fixtures.map((fixture) => JSON.stringify(fixture)).join("\n")}\n`, "utf8")
console.log(`Wrote ${fixtures.length} detector fixtures to ${outputPath}`)
