import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { analyzeSession } from "../src/analysis.ts"
import { DEFAULT_CONFIG, shouldEnforceTool } from "../src/config.ts"
import { estimateTokens, stableHash, truncateMiddle } from "../src/estimation.ts"
import { createHooks } from "../src/hooks.ts"
import { OrderedMap } from "../src/ordered-map.ts"
import { writeReport } from "../src/reporting.ts"
import { getState } from "../src/state.ts"
import type { AssistantUsage, SessionState, SpankNSaveConfig, ToolObservation } from "../src/types.ts"
import { fixed, median, quantile } from "./lib/stats.ts"

const elapsedMilliseconds = (start: bigint): number => Number(process.hrtime.bigint() - start) / 1_000_000

const message = (id: string, createdAt: number, input: number): AssistantUsage => ({
  id,
  sessionID: "benchmark-session",
  createdAt,
  providerID: "benchmark-provider",
  modelID: "benchmark-model",
  cost: 0.001,
  input,
  output: 1_000,
  reasoning: 500,
  cacheRead: 0,
  cacheWrite: 0,
})

const makeTools = (count: number): ToolObservation[] =>
  Array.from({ length: count }, (_, index) => ({
    callID: `call-${index}`,
    tool: index % 4 === 0 ? "bash" : index % 4 === 1 ? "read" : index % 4 === 2 ? "grep" : "glob",
    argsHash: `hash-${index}`,
    outputChars: 4_000,
    outputTokensEstimate: 1_000,
    truncated: false,
    observedAt: index,
  }))

const makeState = (toolCount: number): SessionState => ({
  contextLimit: 200_000,
  userTextPromptTokensEstimate: 1_000,
  systemTokensEstimate: 2_000,
  assistantMessages: new Map([
    ["m1", message("m1", 1, 20_000)],
    ["m2", message("m2", 2, 25_000)],
  ]),
  tools: makeTools(toolCount),
  retries: 0,
  compactions: 0,
  filesChangedCount: 3,
  lastToastAt: 0,
  lastActivityAt: 0,
})

const summarizeDurations = (durations: number[]) => ({
  iterations: durations.length,
  medianMs: median(durations),
  p95Ms: quantile(durations, 0.95),
  p99Ms: quantile(durations, 0.99),
  minMs: Math.min(...durations),
  maxMs: Math.max(...durations),
})

const measureAnalysis = (name: string, toolCount: number, iterations: number) => {
  const state = makeState(toolCount)
  for (let index = 0; index < Math.min(2_000, iterations); index += 1) {
    analyzeSession("warmup", state, DEFAULT_CONFIG, 1_000, "benchmark")
  }

  const durations: number[] = []
  for (let index = 0; index < iterations; index += 1) {
    const start = process.hrtime.bigint()
    analyzeSession(`session-${index}`, state, DEFAULT_CONFIG, 1_000, "benchmark")
    durations.push(elapsedMilliseconds(start))
  }
  return { name, toolCount, ...summarizeDurations(durations) }
}

const measureHook = async (mode: "observe" | "enforce", iterations: number) => {
  const config: SpankNSaveConfig = {
    ...DEFAULT_CONFIG,
    mode,
    notify: false,
    maxToolOutputTokens: 2_000,
    maxToolObservationsPerSession: iterations + 10,
  }
  const states = new OrderedMap<string, SessionState>()
  const hooks = createHooks({
    states,
    config,
    toolSchemaEstimates: new Map(),
    getState,
    persistReport: async () => undefined,
    evictLRU: async () => undefined,
    estimateTokens,
    stableHash,
    truncateMiddle,
    shouldEnforceTool,
  })
  const outputText = "x".repeat(32_000)
  const durations: number[] = []

  for (let index = 0; index < 1_000; index += 1) {
    const output = { title: "warmup", output: outputText, metadata: {} }
    await hooks["tool.execute.after"]?.(
      { sessionID: "warmup", callID: `warmup-${index}`, tool: "bash", args: { index } } as never,
      output as never,
    )
  }
  states.clear()

  for (let index = 0; index < iterations; index += 1) {
    const output = { title: "benchmark", output: outputText, metadata: {} }
    const start = process.hrtime.bigint()
    await hooks["tool.execute.after"]?.(
      { sessionID: "hook-session", callID: `call-${index}`, tool: "bash", args: { index } } as never,
      output as never,
    )
    durations.push(elapsedMilliseconds(start))
  }

  return { mode, outputChars: outputText.length, ...summarizeDurations(durations) }
}

const measureReportWrites = async (iterations: number) => {
  const directory = await mkdtemp(join(tmpdir(), "spanksave-benchmark-"))
  try {
    const state = makeState(100)
    const report = analyzeSession("report-session", state, DEFAULT_CONFIG, 1_000, "benchmark")
    const durations: number[] = []
    for (let index = 0; index < iterations; index += 1) {
      report.summary.sessionID = `report-session-${index}`
      const start = process.hrtime.bigint()
      await writeReport(directory, report)
      durations.push(elapsedMilliseconds(start))
    }
    return summarizeDurations(durations)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const measureRetainedStateMemory = () => {
  if (typeof global.gc === "function") global.gc()
  const before = process.memoryUsage()
  const retained = Array.from({ length: 50 }, () => makeState(1_000))
  if (typeof global.gc === "function") global.gc()
  const after = process.memoryUsage()
  const observationCount = retained.reduce((sum, state) => sum + state.tools.length, 0)
  return {
    sessions: retained.length,
    toolObservations: observationCount,
    rssDeltaBytes: after.rss - before.rss,
    heapUsedDeltaBytes: after.heapUsed - before.heapUsed,
    rssDeltaMiB: (after.rss - before.rss) / 1024 / 1024,
    heapUsedDeltaMiB: (after.heapUsed - before.heapUsed) / 1024 / 1024,
    note: "Retained-state measurement is process- and allocator-sensitive; compare only on the same pinned runner image.",
  }
}

const analysis = [
  measureAnalysis("small", 10, 20_000),
  measureAnalysis("normal", 100, 10_000),
  measureAnalysis("large", 1_000, 2_000),
]
const hooks = [await measureHook("observe", 10_000), await measureHook("enforce", 10_000)]
const reportWrites = await measureReportWrites(200)
const memory = measureRetainedStateMemory()

const result = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  analysis,
  hooks,
  reportWrites,
  memory,
}

const resultsDirectory = join(process.cwd(), "benchmark", "results")
await mkdir(resultsDirectory, { recursive: true })
await writeFile(join(resultsDirectory, "performance.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8")

const markdown = [
  "# Local performance benchmark",
  "",
  `Generated: ${result.generatedAt}`,
  `Runtime: ${process.version} on ${process.platform}/${process.arch}`,
  "",
  "## Analysis latency",
  "",
  "| Scenario | Tool observations | Iterations | Median | P95 | P99 |",
  "|---|---:|---:|---:|---:|---:|",
  ...analysis.map((row) => `| ${row.name} | ${row.toolCount} | ${row.iterations} | ${fixed(row.medianMs, 4)} ms | ${fixed(row.p95Ms, 4)} ms | ${fixed(row.p99Ms, 4)} ms |`),
  "",
  "## Tool hook latency",
  "",
  "| Mode | Output characters | Iterations | Median | P95 | P99 |",
  "|---|---:|---:|---:|---:|---:|",
  ...hooks.map((row) => `| ${row.mode} | ${row.outputChars} | ${row.iterations} | ${fixed(row.medianMs, 4)} ms | ${fixed(row.p95Ms, 4)} ms | ${fixed(row.p99Ms, 4)} ms |`),
  "",
  "## Atomic report-write latency",
  "",
  `Median ${fixed(reportWrites.medianMs, 4)} ms; P95 ${fixed(reportWrites.p95Ms, 4)} ms; P99 ${fixed(reportWrites.p99Ms, 4)} ms across ${reportWrites.iterations} writes.`,
  "",
  "## Retained-state memory",
  "",
  `${memory.sessions} sessions and ${memory.toolObservations} tool observations retained: RSS delta ${fixed(memory.rssDeltaMiB, 2)} MiB; heap-used delta ${fixed(memory.heapUsedDeltaMiB, 2)} MiB.`,
  "",
  `> ${memory.note}`,
  "",
].join("\n")

await writeFile(join(resultsDirectory, "performance.md"), markdown, "utf8")
console.log(markdown)
