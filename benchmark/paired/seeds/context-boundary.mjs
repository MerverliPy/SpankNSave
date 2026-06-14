import { readFile, writeFile } from "node:fs/promises"
const path = "src/detectors/context-pressure.ts"
const before = await readFile(path, "utf8")
const from = "if (contextRatio < config.warningContextRatio) return null"
const to = "if (contextRatio <= config.warningContextRatio) return null"
if (!before.includes(from)) throw new Error(`Seed target not found in ${path}`)
await writeFile(path, before.replace(from, to), "utf8")
