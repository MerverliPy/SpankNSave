import { readFile, writeFile } from "node:fs/promises"
const path = "src/estimation.ts"
const before = await readFile(path, "utf8")
const from = "return Math.ceil(text.length / divisor)"
const to = "return Math.floor(text.length / divisor)"
if (!before.includes(from)) throw new Error(`Seed target not found in ${path}`)
await writeFile(path, before.replace(from, to), "utf8")
