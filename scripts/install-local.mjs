import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const targetRoot = resolve(process.argv[2] ?? process.cwd())
const sourcePlugin = join(repositoryRoot, "dist", "index.js")
const targetPlugin = join(targetRoot, ".opencode", "plugins", "spank-n-save.js")
const targetConfig = join(targetRoot, ".opencode", "spank-n-save.json")
const exampleConfig = join(repositoryRoot, "examples", "spank-n-save.json")

try {
  await access(sourcePlugin)
} catch {
  throw new Error("dist/index.js does not exist. Run `npm run build` before `npm run install:local`.")
}

await mkdir(dirname(targetPlugin), { recursive: true })
await copyFile(sourcePlugin, targetPlugin)

try {
  await access(targetConfig)
} catch {
  await writeFile(targetConfig, await readFile(exampleConfig, "utf8"), { encoding: "utf8", mode: 0o600 })
}

console.log(`Installed SpankNSave plugin: ${targetPlugin}`)
console.log(`Configuration: ${targetConfig}`)
