import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { analyzeSession } from "../src/analysis.ts"
import { DEFAULT_CONFIG } from "../src/config.ts"
import type { AssistantUsage, SessionState, ToolObservation } from "../src/types.ts"
import { fixed, percentage, wilson95 } from "./lib/stats.ts"

type Fixture = {
  id: string
  provenance: string
  expectedCodes: string[]
  toolSchemaTokensEstimate: number
  state: {
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
}

const DETECTOR_CODES = [
  "CONTEXT_PRESSURE",
  "RAPID_CONTEXT_GROWTH",
  "OVERSIZED_USER_PROMPT",
  "OVERSIZED_SYSTEM_CONTEXT",
  "TOOL_SCHEMA_BLOAT",
  "OVERSIZED_TOOL_OUTPUT",
  "DUPLICATE_TOOL_CALLS",
  "HIGH_REASONING_SHARE",
  "EXCESSIVE_ASSISTANT_OUTPUT",
  "RETRY_WASTE",
] as const

const fixtureDirectory = join(process.cwd(), "benchmark", "fixtures", "detectors")
const fixtureFiles = (await readdir(fixtureDirectory))
  .filter((name) => name.endsWith(".jsonl"))
  .sort()

if (fixtureFiles.length === 0) {
  throw new Error("No detector fixtures found. Run `npm run benchmark:fixtures` first.")
}

const allFixtures: Fixture[] = []
for (const filename of fixtureFiles) {
  const contents = await readFile(join(fixtureDirectory, filename), "utf8")
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    try {
      allFixtures.push(JSON.parse(line) as Fixture)
    } catch (error) {
      throw new Error(`${filename}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

const provenanceFilter = process.env.BENCHMARK_PROVENANCE?.trim()
const fixtures = provenanceFilter
  ? allFixtures.filter((fixture) => fixture.provenance === provenanceFilter)
  : allFixtures
if (fixtures.length === 0) {
  throw new Error(`No detector fixtures matched BENCHMARK_PROVENANCE=${provenanceFilter ?? ""}`)
}
const resultSuffix = provenanceFilter
  ? `-${provenanceFilter.replace(/[^A-Za-z0-9._-]+/g, "-")}`
  : ""

const evaluations = fixtures.map((fixture) => {
  const state: SessionState = {
    ...fixture.state,
    assistantMessages: new Map(fixture.state.assistantMessages.map((entry) => [entry.id, entry])),
  }
  const predictedCodes = [
    ...new Set(
      analyzeSession(
        fixture.id,
        state,
        DEFAULT_CONFIG,
        fixture.toolSchemaTokensEstimate,
        "benchmark",
        "2026-01-01T00:00:00.000Z",
      ).findings.map((finding) => finding.code),
    ),
  ].sort()
  return {
    id: fixture.id,
    provenance: fixture.provenance,
    expectedCodes: [...fixture.expectedCodes].sort(),
    predictedCodes,
  }
})

const rows = DETECTOR_CODES.map((code) => {
  let truePositive = 0
  let falsePositive = 0
  let falseNegative = 0
  let trueNegative = 0

  for (const evaluation of evaluations) {
    const expected = evaluation.expectedCodes.includes(code)
    const predicted = evaluation.predictedCodes.includes(code)
    if (expected && predicted) truePositive += 1
    else if (!expected && predicted) falsePositive += 1
    else if (expected && !predicted) falseNegative += 1
    else trueNegative += 1
  }

  const precision = truePositive + falsePositive === 0 ? Number.NaN : truePositive / (truePositive + falsePositive)
  const recall = truePositive + falseNegative === 0 ? Number.NaN : truePositive / (truePositive + falseNegative)
  const f1Denominator = 2 * truePositive + falsePositive + falseNegative
  const f1 = f1Denominator === 0 ? Number.NaN : (2 * truePositive) / f1Denominator
  const falsePositiveRate = falsePositive + trueNegative === 0 ? 0 : falsePositive / (falsePositive + trueNegative)
  const precisionInterval = wilson95(truePositive, truePositive + falsePositive)
  const recallInterval = wilson95(truePositive, truePositive + falseNegative)
  const falsePositiveRateInterval = wilson95(falsePositive, falsePositive + trueNegative)

  return {
    code,
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    precision,
    recall,
    f1,
    falsePositiveRate,
    precision95: precisionInterval,
    recall95: recallInterval,
    falsePositiveRate95: falsePositiveRateInterval,
  }
})

const finiteMean = (values: number[]): number => {
  const finite = values.filter(Number.isFinite)
  return finite.length === 0 ? Number.NaN : finite.reduce((sum, value) => sum + value, 0) / finite.length
}
const macro = {
  precision: finiteMean(rows.map((row) => row.precision)),
  recall: finiteMean(rows.map((row) => row.recall)),
  f1: finiteMean(rows.map((row) => row.f1)),
  falsePositiveRate: finiteMean(rows.map((row) => row.falsePositiveRate)),
  evaluableF1Detectors: rows.filter((row) => Number.isFinite(row.f1)).length,
}

const clean = evaluations.filter((evaluation) => evaluation.expectedCodes.length === 0)
const cleanFalsePositives = clean.filter((evaluation) => evaluation.predictedCodes.length > 0)
const cleanSessionFalsePositiveRate = clean.length === 0 ? 0 : cleanFalsePositives.length / clean.length
const cleanSessionFalsePositiveRate95 = wilson95(cleanFalsePositives.length, clean.length)
const mismatches = evaluations.filter(
  (evaluation) => JSON.stringify(evaluation.expectedCodes) !== JSON.stringify(evaluation.predictedCodes),
)

const result = {
  generatedAt: new Date().toISOString(),
  benchmarkType: "detector-conformance",
  warning:
    "Synthetic fixtures validate deterministic rule conformance. Do not describe these results as real-world diagnostic accuracy until independently human-labeled sessions are added.",
  fixtureFiles,
  provenanceFilter: provenanceFilter ?? null,
  fixtureCount: fixtures.length,
  provenanceCounts: Object.fromEntries(
    [...new Set(fixtures.map((fixture) => fixture.provenance))].map((provenance) => [
      provenance,
      fixtures.filter((fixture) => fixture.provenance === provenance).length,
    ]),
  ),
  rows,
  macro,
  cleanSessionFalsePositiveRate,
  cleanSessionFalsePositiveRate95,
  mismatchCount: mismatches.length,
  mismatches,
}

const resultsDirectory = join(process.cwd(), "benchmark", "results")
await mkdir(resultsDirectory, { recursive: true })
await writeFile(join(resultsDirectory, `detector-accuracy${resultSuffix}.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8")

const markdown = [
  "# Detector conformance benchmark",
  "",
  `Generated: ${result.generatedAt}`,
  "",
  `> ${result.warning}`,
  "",
  `Fixtures: **${result.fixtureCount}**${provenanceFilter ? ` (provenance: \`${provenanceFilter}\`)` : ""}`,
  "",
  "| Detector | Precision | Recall | F1 | False-positive rate | TP | FP | FN | TN |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...rows.map((row) =>
    `| ${row.code} | ${percentage(row.precision)} | ${percentage(row.recall)} | ${fixed(row.f1)} | ${percentage(row.falsePositiveRate)} | ${row.truePositive} | ${row.falsePositive} | ${row.falseNegative} | ${row.trueNegative} |`,
  ),
  `| **Macro average** | **${percentage(macro.precision)}** | **${percentage(macro.recall)}** | **${fixed(macro.f1)}** | **${percentage(macro.falsePositiveRate)}** |  |  |  |  |`,
  "",
  `Macro-F1 includes **${macro.evaluableF1Detectors}/${rows.length}** detectors with at least one positive label or prediction.`,
  "",
  `Clean-session false-positive rate: **${percentage(cleanSessionFalsePositiveRate)}** (${cleanFalsePositives.length}/${clean.length}); 95% Wilson CI ${percentage(cleanSessionFalsePositiveRate95[0])}–${percentage(cleanSessionFalsePositiveRate95[1])}.`,
  "",
  `Exact fixture mismatches: **${mismatches.length}**`,
  "",
].join("\n")

await writeFile(join(resultsDirectory, `detector-accuracy${resultSuffix}.md`), markdown, "utf8")
console.log(markdown)
if (mismatches.length > 0) process.exitCode = 1
