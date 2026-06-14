import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

type CorpusRow = {
  id: string
  category: string
  source: string
  text: string
  chars: number
}

type CountRow = Omit<CorpusRow, "text"> & {
  provider: "anthropic" | "gemini" | "openai"
  model: string
  actualTokens: number
  collectedAt: string
}

const provider = process.env.CALIBRATION_PROVIDER
if (provider !== "anthropic" && provider !== "gemini" && provider !== "openai") {
  throw new Error("Set CALIBRATION_PROVIDER to `anthropic`, `gemini`, or `openai`.")
}

const model = process.env.CALIBRATION_MODEL?.trim()
if (!model) throw new Error("Set CALIBRATION_MODEL to the exact provider model identifier.")

const corpusPath = join(process.cwd(), "benchmark", "fixtures", "calibration", "corpus.jsonl")
const corpus = (await readFile(corpusPath, "utf8"))
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as CorpusRow)

const safeModel = model.replace(/[^a-zA-Z0-9_.-]/g, "_")
const resultsDirectory = join(process.cwd(), "benchmark", "results")
await mkdir(resultsDirectory, { recursive: true })
const outputPath = join(resultsDirectory, `token-counts-${provider}-${safeModel}.jsonl`)

let existing: CountRow[] = []
try {
  existing = (await readFile(outputPath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CountRow)
} catch {
  existing = []
}
const completed = new Set(existing.map((row) => row.id))

const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds))

const requestWithRetry = async (row: CorpusRow): Promise<number> => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    let response: Response
    if (provider === "anthropic") {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required for CALIBRATION_PROVIDER=anthropic")
      response = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: row.text }],
        }),
      })
    } else if (provider === "gemini") {
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey) throw new Error("GEMINI_API_KEY is required for CALIBRATION_PROVIDER=gemini")
      const modelName = model.replace(/^models\//, "")
      const encodedModel = encodeURIComponent(modelName)
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}:countTokens?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: row.text }] }] }),
        },
      )
    } else {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) throw new Error("OPENAI_API_KEY is required for CALIBRATION_PROVIDER=openai")
      response = await fetch("https://api.openai.com/v1/responses/input_tokens", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: row.text }),
      })
    }

    if (response.ok) {
      const body = await response.json() as Record<string, unknown>
      const value = provider === "gemini" ? body.totalTokens : body.input_tokens
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new Error(`Provider returned an invalid token count for ${row.id}: ${JSON.stringify(body)}`)
      }
      return value
    }

    const body = await response.text()
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      await sleep(500 * 2 ** attempt)
      continue
    }
    throw new Error(`${provider} token count failed for ${row.id}: HTTP ${response.status}: ${body.slice(0, 500)}`)
  }
  throw new Error(`Token count retry limit reached for ${row.id}`)
}

const rows = [...existing]
for (const [index, row] of corpus.entries()) {
  if (completed.has(row.id)) continue
  const actualTokens = await requestWithRetry(row)
  rows.push({
    id: row.id,
    category: row.category,
    source: row.source,
    chars: row.chars,
    provider,
    model,
    actualTokens,
    collectedAt: new Date().toISOString(),
  })
  await writeFile(outputPath, `${rows.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8")
  console.log(`[${index + 1}/${corpus.length}] ${row.id}: ${actualTokens} tokens`)
  await sleep(Number.parseInt(process.env.CALIBRATION_DELAY_MS ?? "100", 10))
}

console.log(`Wrote ${rows.length} token counts to ${outputPath}`)
