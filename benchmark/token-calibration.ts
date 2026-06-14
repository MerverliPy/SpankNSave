import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fixed, mean, median, percentage, quantile } from "./lib/stats.ts"

type CountRow = {
  id: string
  category: string
  source: string
  chars: number
  provider: string
  model: string
  actualTokens: number
  collectedAt: string
}

const resultsDirectory = join(process.cwd(), "benchmark", "results")
const files = (await readdir(resultsDirectory))
  .filter((name) => name.startsWith("token-counts-") && name.endsWith(".jsonl"))
  .sort()
if (files.length === 0) {
  throw new Error("No provider token-count files found. Run the corpus generator and provider collector first.")
}

const rows: CountRow[] = []
for (const file of files) {
  const content = await readFile(join(resultsDirectory, file), "utf8")
  rows.push(...content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as CountRow))
}

const summarize = (group: CountRow[], ratio: number) => {
  const records = group.map((row) => {
    const estimated = Math.ceil(row.chars / ratio)
    const absoluteError = Math.abs(estimated - row.actualTokens)
    const percentageError = absoluteError / row.actualTokens
    const signedPercentageError = (estimated - row.actualTokens) / row.actualTokens
    return { ...row, estimated, absoluteError, percentageError, signedPercentageError }
  })
  return {
    samples: records.length,
    ratio,
    medianAbsolutePercentageError: median(records.map((row) => row.percentageError)),
    p90AbsolutePercentageError: quantile(records.map((row) => row.percentageError), 0.9),
    p95AbsolutePercentageError: quantile(records.map((row) => row.percentageError), 0.95),
    meanSignedPercentageError: mean(records.map((row) => row.signedPercentageError)),
    underestimationRate: records.filter((row) => row.estimated < row.actualTokens).length / records.length,
    medianAbsoluteTokenError: median(records.map((row) => row.absoluteError)),
  }
}

const findBestRatio = (group: CountRow[]): number => {
  let bestRatio = 4
  let bestScore = Number.POSITIVE_INFINITY
  for (let hundredths = 100; hundredths <= 800; hundredths += 1) {
    const ratio = hundredths / 100
    const score = summarize(group, ratio).medianAbsolutePercentageError
    if (score < bestScore) {
      bestScore = score
      bestRatio = ratio
    }
  }
  return bestRatio
}

const modelKeys = [...new Set(rows.map((row) => `${row.provider}\u0000${row.model}`))].sort()
const models = modelKeys.map((key) => {
  const [provider, model] = key.split("\u0000")
  const group = rows.filter((row) => row.provider === provider && row.model === model)
  const bestRatio = findBestRatio(group)
  return {
    provider,
    model,
    defaultRatio: summarize(group, 4),
    calibratedRatio: summarize(group, bestRatio),
    categories: [...new Set(group.map((row) => row.category))].sort().map((category) => {
      const categoryRows = group.filter((row) => row.category === category)
      return {
        category,
        defaultRatio: summarize(categoryRows, 4),
        calibratedRatio: summarize(categoryRows, bestRatio),
      }
    }),
  }
})

const result = {
  generatedAt: new Date().toISOString(),
  sourceFiles: files,
  totalSamples: rows.length,
  models,
}
await writeFile(join(resultsDirectory, "token-calibration.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8")

const markdown = [
  "# Provider token-estimation calibration",
  "",
  `Generated: ${result.generatedAt}`,
  "",
  "| Provider | Model | Samples | Ratio | Median APE | P95 APE | Mean signed error | Underestimation rate |",
  "|---|---|---:|---:|---:|---:|---:|---:|",
  ...models.flatMap((entry) => [
    `| ${entry.provider} | ${entry.model} (default) | ${entry.defaultRatio.samples} | 4.00 | ${percentage(entry.defaultRatio.medianAbsolutePercentageError)} | ${percentage(entry.defaultRatio.p95AbsolutePercentageError)} | ${percentage(entry.defaultRatio.meanSignedPercentageError)} | ${percentage(entry.defaultRatio.underestimationRate)} |`,
    `| ${entry.provider} | ${entry.model} (calibrated) | ${entry.calibratedRatio.samples} | ${fixed(entry.calibratedRatio.ratio, 2)} | ${percentage(entry.calibratedRatio.medianAbsolutePercentageError)} | ${percentage(entry.calibratedRatio.p95AbsolutePercentageError)} | ${percentage(entry.calibratedRatio.meanSignedPercentageError)} | ${percentage(entry.calibratedRatio.underestimationRate)} |`,
  ]),
  "",
  "> Calibrate and publish each provider/model separately. Do not combine tokenizer families into one ratio.",
  "",
].join("\n")
await writeFile(join(resultsDirectory, "token-calibration.md"), markdown, "utf8")
console.log(markdown)
