import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import {
  bootstrapMedian95,
  exactTwoSidedBinomialPValue,
  fixed,
  mean,
  median,
  pearsonCorrelation,
  percentage,
  quantile,
  wilson95,
} from "../lib/stats.ts"

type Condition = "baseline" | "prediction" | "treatment"

type Run = {
  runID: string
  taskID: string
  repetition: number
  condition: Condition
  success: boolean
  wallTimeMs: number
  usage: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
    cost: number
    totalTokens: number
  }
  findingCodes: string[]
  expectedFindingCodes: string[]
  savingsFindingCodes?: string[]
  estimatedSavingsTokens: number
  estimatedSavingsTokensAll?: number
  infrastructureFailure?: boolean
}

type Pair = { baseline: Run; treatment: Run }
type Triplet = { baseline: Run; prediction: Run; treatment: Run }

const resultsDirectory = join(process.cwd(), "benchmark", "results")
let sourcePath: string
if (process.env.PAIRED_RESULTS_FILE) {
  sourcePath = isAbsolute(process.env.PAIRED_RESULTS_FILE)
    ? process.env.PAIRED_RESULTS_FILE
    : join(process.cwd(), process.env.PAIRED_RESULTS_FILE)
} else {
  const candidates = (await readdir(resultsDirectory))
    .filter((name) => name.startsWith("paired-runs-") && name.endsWith(".jsonl"))
    .sort()
  const latest = candidates.at(-1)
  if (!latest) throw new Error("No paired-runs-*.jsonl file found. Run the paired benchmark first.")
  sourcePath = join(resultsDirectory, latest)
}

const allRows = (await readFile(sourcePath, "utf8"))
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Run)
const infrastructureFailures = allRows.filter((row) => row.infrastructureFailure)
const rows = allRows.filter((row) => !row.infrastructureFailure && row.condition && row.usage)

const grouped = new Map<string, Partial<Record<Condition, Run>>>()
for (const row of rows) {
  const key = `${row.taskID}\u0000${row.repetition}`
  const entry = grouped.get(key) ?? {}
  entry[row.condition] = row
  grouped.set(key, entry)
}

const pairs: Pair[] = [...grouped.values()]
  .filter((entry): entry is { baseline: Run; treatment: Run; prediction?: Run } => Boolean(entry.baseline && entry.treatment))
  .map((entry) => ({ baseline: entry.baseline, treatment: entry.treatment }))
const triplets: Triplet[] = [...grouped.values()]
  .filter((entry): entry is Triplet => Boolean(entry.baseline && entry.prediction && entry.treatment))
if (pairs.length === 0) throw new Error("No complete baseline/treatment pairs were found.")

const baselineSuccesses = pairs.filter((pair) => pair.baseline.success).length
const treatmentSuccesses = pairs.filter((pair) => pair.treatment.success).length
const baselineSuccessRate = baselineSuccesses / pairs.length
const treatmentSuccessRate = treatmentSuccesses / pairs.length
const baselineSuccess95 = wilson95(baselineSuccesses, pairs.length)
const treatmentSuccess95 = wilson95(treatmentSuccesses, pairs.length)

const bothSuccess = pairs.filter((pair) => pair.baseline.success && pair.treatment.success)
const bothFailure = pairs.filter((pair) => !pair.baseline.success && !pair.treatment.success)
const treatmentOnlySuccess = pairs.filter((pair) => !pair.baseline.success && pair.treatment.success)
const baselineOnlySuccess = pairs.filter((pair) => pair.baseline.success && !pair.treatment.success)
const discordant = treatmentOnlySuccess.length + baselineOnlySuccess.length
const mcnemarExactP = exactTwoSidedBinomialPValue(treatmentOnlySuccess.length, discordant)

const comparisonMetric = <T>(
  subset: T[],
  left: (entry: T) => number,
  right: (entry: T) => number,
) => {
  const absoluteDifferences = subset.map((entry) => right(entry) - left(entry))
  const relativeReductions = subset
    .filter((entry) => left(entry) !== 0)
    .map((entry) => (left(entry) - right(entry)) / left(entry))
  return {
    pairCount: subset.length,
    baselineMedian: median(subset.map(left)),
    treatmentMedian: median(subset.map(right)),
    medianAbsoluteDifference: median(absoluteDifferences),
    medianRelativeReduction: median(relativeReductions),
    medianRelativeReduction95: bootstrapMedian95(relativeReductions),
    p95Baseline: quantile(subset.map(left), 0.95),
    p95Treatment: quantile(subset.map(right), 0.95),
  }
}

const pairedMetric = (select: (run: Run) => number, subset = pairs) =>
  comparisonMetric(subset, (pair) => select(pair.baseline), (pair) => select(pair.treatment))

const tokenMetrics = pairedMetric((run) => run.usage.totalTokens)
const tokenMetricsBothSuccessful = bothSuccess.length > 0
  ? pairedMetric((run) => run.usage.totalTokens, bothSuccess)
  : null
const costMetrics = pairedMetric((run) => run.usage.cost)
const wallTimeMetrics = pairedMetric((run) => run.wallTimeMs)

const predictionPairs = triplets.map((triplet) => ({ baseline: triplet.baseline, treatment: triplet.prediction }))
const predictionTokenDifference = predictionPairs.length > 0
  ? pairedMetric((run) => run.usage.totalTokens, predictionPairs)
  : null

const estimationPairs = triplets
  .filter((triplet) => triplet.prediction.success && triplet.treatment.success)
  .map((triplet) => ({
    estimated: triplet.prediction.estimatedSavingsTokens,
    actual: triplet.prediction.usage.totalTokens - triplet.treatment.usage.totalTokens,
    selectedCodes: triplet.prediction.savingsFindingCodes ?? [],
  }))
  .filter((entry) => entry.estimated > 0 && entry.selectedCodes.length > 0)
const estimation = estimationPairs.length === 0
  ? null
  : {
      samples: estimationPairs.length,
      medianEstimatedSavings: median(estimationPairs.map((entry) => entry.estimated)),
      medianActualSavings: median(estimationPairs.map((entry) => entry.actual)),
      medianAbsoluteError: median(estimationPairs.map((entry) => Math.abs(entry.estimated - entry.actual))),
      meanSignedError: mean(estimationPairs.map((entry) => entry.estimated - entry.actual)),
      correlation: pearsonCorrelation(
        estimationPairs.map((entry) => entry.estimated),
        estimationPairs.map((entry) => entry.actual),
      ),
      positiveActualSavingsRate:
        estimationPairs.filter((entry) => entry.actual > 0).length / estimationPairs.length,
    }

const expectedFindingRuns = triplets
  .map((triplet) => triplet.prediction)
  .filter((run) => run.expectedFindingCodes.length > 0)
const expectedFindingHits = expectedFindingRuns.reduce(
  (sum, run) => sum + run.expectedFindingCodes.filter((code) => run.findingCodes.includes(code)).length,
  0,
)
const expectedFindingTotal = expectedFindingRuns.reduce((sum, run) => sum + run.expectedFindingCodes.length, 0)

const result = {
  generatedAt: new Date().toISOString(),
  sourcePath,
  rawRows: allRows.length,
  infrastructureFailures: infrastructureFailures.length,
  completePairs: pairs.length,
  completeTriplets: triplets.length,
  success: {
    baselineSuccesses,
    treatmentSuccesses,
    baselineSuccessRate,
    treatmentSuccessRate,
    successRateDifferencePercentagePoints: (treatmentSuccessRate - baselineSuccessRate) * 100,
    baselineSuccess95,
    treatmentSuccess95,
    bothSuccess: bothSuccess.length,
    bothFailure: bothFailure.length,
    treatmentOnlySuccess: treatmentOnlySuccess.length,
    baselineOnlySuccess: baselineOnlySuccess.length,
    mcnemarExactP,
  },
  tokens: tokenMetrics,
  tokensBothSuccessful: tokenMetricsBothSuccessful,
  cost: costMetrics,
  wallTime: wallTimeMetrics,
  predictionVersusPureTokens: predictionTokenDifference,
  estimation,
  expectedFindingRecall: expectedFindingTotal === 0 ? null : expectedFindingHits / expectedFindingTotal,
  expectedFindingHits,
  expectedFindingTotal,
}

await mkdir(resultsDirectory, { recursive: true })
await writeFile(join(resultsDirectory, "paired-summary.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8")

const successDifference = result.success.successRateDifferencePercentagePoints
const markdown = [
  "# Paired OpenCode benchmark",
  "",
  `Generated: ${result.generatedAt}`,
  "",
  `Complete pure-baseline/treatment pairs: **${pairs.length}**; complete pure-baseline/prediction/treatment triplets: **${triplets.length}**; infrastructure failures excluded: **${infrastructureFailures.length}**.`,
  "",
  "## Correctness",
  "",
  "| Condition | Successful runs | Success rate | 95% Wilson CI |",
  "|---|---:|---:|---:|",
  `| Pure baseline | ${baselineSuccesses}/${pairs.length} | ${percentage(baselineSuccessRate)} | ${percentage(baselineSuccess95[0])}–${percentage(baselineSuccess95[1])} |`,
  `| Treatment | ${treatmentSuccesses}/${pairs.length} | ${percentage(treatmentSuccessRate)} | ${percentage(treatmentSuccess95[0])}–${percentage(treatmentSuccess95[1])} |`,
  "",
  `Success-rate difference: **${fixed(successDifference, 1)} percentage points**. Discordant pairs: treatment-only ${treatmentOnlySuccess.length}, baseline-only ${baselineOnlySuccess.length}; exact McNemar/binomial p=${fixed(mcnemarExactP, 4)}.`,
  "",
  "## Efficiency",
  "",
  "| Metric | Pure baseline median | Treatment median | Median reduction | 95% bootstrap CI | Pairs |",
  "|---|---:|---:|---:|---:|---:|",
  `| Total tokens | ${fixed(tokenMetrics.baselineMedian, 0)} | ${fixed(tokenMetrics.treatmentMedian, 0)} | ${percentage(tokenMetrics.medianRelativeReduction)} | ${percentage(tokenMetrics.medianRelativeReduction95[0])}–${percentage(tokenMetrics.medianRelativeReduction95[1])} | ${tokenMetrics.pairCount} |`,
  `| Provider cost | ${fixed(costMetrics.baselineMedian, 4)} | ${fixed(costMetrics.treatmentMedian, 4)} | ${percentage(costMetrics.medianRelativeReduction)} | ${percentage(costMetrics.medianRelativeReduction95[0])}–${percentage(costMetrics.medianRelativeReduction95[1])} | ${costMetrics.pairCount} |`,
  `| Wall time | ${fixed(wallTimeMetrics.baselineMedian / 1000, 2)} s | ${fixed(wallTimeMetrics.treatmentMedian / 1000, 2)} s | ${percentage(wallTimeMetrics.medianRelativeReduction)} | ${percentage(wallTimeMetrics.medianRelativeReduction95[0])}–${percentage(wallTimeMetrics.medianRelativeReduction95[1])} | ${wallTimeMetrics.pairCount} |`,
  "",
  ...(tokenMetricsBothSuccessful ? [
    `Among pairs where both pure baseline and treatment passed validation, median token reduction was **${percentage(tokenMetricsBothSuccessful.medianRelativeReduction)}** across ${tokenMetricsBothSuccessful.pairCount} pairs.`,
    "",
  ] : []),
  ...(predictionTokenDifference ? [
    `The observe-only prediction arm differed from the pure baseline by a median token reduction of **${percentage(predictionTokenDifference.medianRelativeReduction)}** across ${predictionTokenDifference.pairCount} triplets. Treat this as a stochastic diagnostic, not a standalone overhead measurement.`,
    "",
  ] : []),
  "## Savings-estimate calibration",
  "",
  ...(estimation ? [
    `Successful prediction/treatment samples with explicitly selected savings codes and nonzero estimates: **${estimation.samples}**`,
    "",
    `Median estimated savings: **${fixed(estimation.medianEstimatedSavings, 0)} tokens**; median actual prediction-to-treatment savings: **${fixed(estimation.medianActualSavings, 0)} tokens**; median absolute error: **${fixed(estimation.medianAbsoluteError, 0)} tokens**; Pearson r=${fixed(estimation.correlation, 3)}; positive actual savings rate ${percentage(estimation.positiveActualSavingsRate)}.`,
  ] : ["No valid prediction-arm savings estimates were available. Define `savingsFindingCodes` for interventions that the treatment actually applies."]),
  "",
  ...(expectedFindingTotal > 0 ? [
    `Prediction-arm expected-finding recall: **${percentage(expectedFindingHits / expectedFindingTotal)}** (${expectedFindingHits}/${expectedFindingTotal}).`,
    "",
  ] : []),
  "> Treat this as evidence only for the pinned tasks, commits, model, OpenCode version, variant, permissions, selected intervention codes, and runner environment recorded in the raw JSONL.",
  "",
].join("\n")

await writeFile(join(resultsDirectory, "paired-summary.md"), markdown, "utf8")
console.log(markdown)
