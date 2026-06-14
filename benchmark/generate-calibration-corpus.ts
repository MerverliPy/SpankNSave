import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { extname, join, relative } from "node:path"
import { seededRandom } from "./lib/stats.ts"

type CorpusRow = {
  id: string
  category: string
  source: string
  text: string
  chars: number
}

const maximumSamples = Number.parseInt(process.env.CALIBRATION_MAX_SAMPLES ?? "300", 10)
if (!Number.isInteger(maximumSamples) || maximumSamples < 30 || maximumSamples > 5_000) {
  throw new Error("CALIBRATION_MAX_SAMPLES must be an integer from 30 through 5000")
}

const root = process.cwd()
const allowedExtensions = new Set([".ts", ".md", ".json", ".mjs", ".yml", ".yaml"])
const ignoredDirectories = new Set([".git", "node_modules", "dist", "benchmark/results"])
const files: string[] = []

const walk = async (directory: string): Promise<void> => {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(directory, entry.name)
    const rel = relative(root, path).replaceAll("\\", "/")
    if (entry.isDirectory()) {
      if ([...ignoredDirectories].some((ignored) => rel === ignored || rel.startsWith(`${ignored}/`))) continue
      await walk(path)
      continue
    }
    if (entry.isFile() && allowedExtensions.has(extname(entry.name))) files.push(path)
  }
}
await walk(root)
files.sort()

const random = seededRandom(0x0ca11b7a)
const rows: CorpusRow[] = []
const add = (category: string, source: string, text: string): void => {
  if (!text.trim()) return
  rows.push({ id: `sample-${String(rows.length + 1).padStart(4, "0")}`, category, source, text, chars: text.length })
}

const targetSizes = [64, 128, 256, 512, 1_024, 2_048, 4_096]
for (const path of files) {
  const content = await readFile(path, "utf8")
  if (content.length === 0) continue
  const extension = extname(path)
  const category = extension === ".md" ? "markdown" : extension === ".json" ? "json" : extension === ".ts" || extension === ".mjs" ? "source-code" : "configuration"
  for (const targetSize of targetSizes) {
    if (content.length < Math.min(32, targetSize)) continue
    const maximumStart = Math.max(0, content.length - targetSize)
    const start = maximumStart === 0 ? 0 : Math.floor(random() * (maximumStart + 1))
    add(category, relative(root, path), content.slice(start, start + targetSize))
  }
}

const multilingual = [
  "English: Measure token estimates accurately and report uncertainty.",
  "Español: Mide las estimaciones de tokens con precisión y comunica la incertidumbre.",
  "Français : Mesurez précisément les estimations de jetons et signalez l'incertitude.",
  "日本語: トークン推定を正確に測定し、不確実性を報告します。",
  "中文：准确衡量令牌估算并报告不确定性。",
  "العربية: قم بقياس تقديرات الرموز بدقة والإبلاغ عن عدم اليقين.",
  "हिन्दी: टोकन अनुमानों को सही ढंग से मापें और अनिश्चितता की रिपोर्ट करें।",
]
for (let repeat = 1; repeat <= 12; repeat += 1) {
  for (const value of multilingual) add("multilingual", `synthetic/multilingual-${repeat}`, `${value}\n`.repeat(repeat))
}

for (let repeat = 1; repeat <= 24; repeat += 1) {
  add(
    "logs",
    `synthetic/log-${repeat}`,
    Array.from({ length: repeat * 2 }, (_, index) =>
      `${new Date(1_700_000_000_000 + index * 1_000).toISOString()} ERROR request_id=${index.toString(16).padStart(16, "0")} path=/api/items/${index} status=500 message="unexpected state transition"`,
    ).join("\n"),
  )
  add(
    "minified-json",
    `synthetic/minified-${repeat}`,
    JSON.stringify({
      records: Array.from({ length: repeat }, (_, index) => ({
        id: `f0e1d2c3-b4a5-6789-${String(index).padStart(4, "0")}-abcdef123456`,
        enabled: index % 2 === 0,
        values: [index, index * 2, index * 3],
      })),
    }),
  )
}

const selected = rows.length <= maximumSamples
  ? rows
  : Array.from({ length: maximumSamples }, (_, index) => rows[Math.floor((index * rows.length) / maximumSamples)]!)

const outputDirectory = join(root, "benchmark", "fixtures", "calibration")
await mkdir(outputDirectory, { recursive: true })
const outputPath = join(outputDirectory, "corpus.jsonl")
await writeFile(outputPath, `${selected.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
console.log(`Wrote ${selected.length} calibration samples to ${outputPath}`)
console.log("Review the corpus before sending it to any provider token-count endpoint.")
