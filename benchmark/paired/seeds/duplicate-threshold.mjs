import { readFile, writeFile } from "node:fs/promises"
const path = "src/detectors/duplicate-tool-calls.ts"
const before = await readFile(path, "utf8")
const from = "entry.count >= config.duplicateToolCallThreshold"
const to = "entry.count > config.duplicateToolCallThreshold"
if (!before.includes(from)) throw new Error(`Seed target not found in ${path}`)
await writeFile(path, before.replace(from, to), "utf8")
