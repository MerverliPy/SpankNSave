import { mkdir, readFile, writeFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { fixed, percentage, wilson95 } from "./lib/stats.ts"

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

type Label = {
  id: string
  reportPath: string
  expectedCodes: string[]
  reviewerCount: number
  adjudicated?: boolean
}

type Report = { findings?: Array<{ code?: unknown }> }

const root = process.cwd()
const sourceInput = process.env.HUMAN_LABELS_FILE ?? "benchmark/private/human-labels.jsonl"
const sourcePath = isAbsolute(sourceInput) ? sourceInput : join(root, sourceInput)
const labels = (await readFile(sourcePath, "utf8"))
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0)
  .map((line, index) => {
    try {
      return JSON.parse(line) as Label
    } catch (error) {
      throw new Error(`${sourcePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
if (labels.length === 0) throw new Error("The human-label file is empty.")

const duplicateIDs = labels.filter((label, index) => labels.findIndex((candidate) => candidate.id === label.id) !== index)
if (duplicateIDs.length > 0) throw new Error(`Duplicate label IDs: ${[...new Set(duplicateIDs.map((entry) => entry.id))].join(", ")}`)
for (const label of labels) {
  if (!label.id || !label.reportPath) throw new Error("Every label requires id and reportPath.")
  if (!Number.isInteger(label.reviewerCount) || label.reviewerCount < 2) {
    throw new Error(`${label.id}: reviewerCount must be at least 2.`)
  }
  for (const code of label.expectedCodes) {
    if (!DETECTOR_CODES.includes(code as typeof DETECTOR_CODES[number])) {
      throw new Error(`${label.id}: unknown detector code ${code}`)
    }
  }
}

const evaluations = []
for (const label of labels) {
  const reportPath = isAbsolute(label.reportPath) ? label.reportPath : join(root, label.reportPath)
  const report = JSON.parse(await readFile(reportPath, "utf8")) as Report
  const predictedCodes = [...new Set((report.findings ?? []).map((finding) => String(finding.code)))].sort()
  evaluations.push({
    id: label.id,
    expectedCodes: [...new Set(label.expectedCodes)].sort(),
    predictedCodes,
    reviewerCount: label.reviewerCount,
    adjudicated: Boolean(label.adjudicated),
  })
}

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
    precision95: wilson95(truePositive, truePositive + falsePositive),
    recall95: wilson95(truePositive, truePositive + falseNegative),
    falsePositiveRate95: wilson95(falsePositive, falsePositive + trueNegative),
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
const cleanSessionFalsePositiveRate = clean.length === 0 ? Number.NaN : cleanFalsePositives.length / clean.length
const cleanSessionFalsePositiveRate95 = wilson95(cleanFalsePositives.length, clean.length)
const mismatches = evaluations.filter(
  (evaluation) => JSON.stringify(evaluation.expectedCodes) !== JSON.stringify(evaluation.predictedCodes),
)

const result = {
  generatedAt: new Date().toISOString(),
  benchmarkType: "human-labeled-detector-evaluation",
  sourcePath,
  sessions: evaluations.length,
  cleanSessions: clean.length,
  minimumReviewerCount: Math.min(...evaluations.map((entry) => entry.reviewerCount)),
  adjudicatedSessions: evaluations.filter((entry) => entry.adjudicated).length,
  rows,
  macro,
  cleanSessionFalsePositiveRate,
  cleanSessionFalsePositiveRate95,
  mismatchCount: mismatches.length,
  mismatches,
  warning: "Validity depends on representative sampling, blinded labeling, a written rubric, independent reviewers, and documented adjudication.",
}

const resultsDirectory = join(root, "benchmark", "results")
await mkdir(resultsDirectory, { recursive: true })
await writeFile(join(resultsDirectory, "detector-human-accuracy.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8")

const markdown = [
  "# Human-labeled detector evaluation",
  "",
  `Generated: ${result.generatedAt}`,
  "",
  `> ${result.warning}`,
  "",
  `Sessions: **${result.sessions}**; clean sessions: **${result.cleanSessions}**; minimum reviewers: **${result.minimumReviewerCount}**.`,
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
  `Sessions with any mismatch: **${mismatches.length}**`,
  "",
].join("\n")
await writeFile(join(resultsDirectory, "detector-human-accuracy.md"), markdown, "utf8")
console.log(markdown)
