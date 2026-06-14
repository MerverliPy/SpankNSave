import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { basename, join, relative } from "node:path"

const root = process.cwd()
const version = process.env.BENCHMARK_VERSION?.trim()
if (!version || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version)) {
  throw new Error("Set BENCHMARK_VERSION to a safe identifier such as v0.1.0-2026-06-13.")
}

const resultsDirectory = join(root, "benchmark", "results")
if (!existsSync(resultsDirectory)) throw new Error("benchmark/results does not exist. Run benchmarks first.")
const resultFiles = (await readdir(resultsDirectory))
  .filter((name) => !name.startsWith(".") && /\.(json|jsonl|md|txt)$/.test(name))
  .sort()
if (resultFiles.length === 0) throw new Error("No JSON, JSONL, Markdown, or text result files found.")

const destination = join(root, "benchmark", "published", version)
if (existsSync(destination)) throw new Error(`Published directory already exists: ${destination}`)
await mkdir(join(destination, "results"), { recursive: true })

for (const name of resultFiles) {
  await cp(join(resultsDirectory, name), join(destination, "results", name))
}

const optionalInputs = [
  "benchmark/paired/tasks.json",
  "benchmark/paired/tasks.example.json",
  "benchmark/fixtures/detectors/synthetic-conformance.jsonl",
  "benchmark/fixtures/calibration/corpus.jsonl",
]
for (const input of optionalInputs) {
  const source = join(root, input)
  if (!existsSync(source)) continue
  const target = join(destination, "inputs", input.replace(/^benchmark\//, ""))
  await mkdir(join(target, ".."), { recursive: true })
  await cp(source, target)
}

const run = (command: string, args: string[], cwd = root): string => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" })
  return result.status === 0 ? (result.stdout || result.stderr).trim() : "unavailable"
}

const metadata = {
  publishedAt: new Date().toISOString(),
  benchmarkVersion: version,
  repositoryCommit: run("git", ["rev-parse", "HEAD"]),
  repositoryDirty: run("git", ["status", "--porcelain"]) !== "",
  nodeVersion: process.version,
  npmVersion: run("npm", ["--version"]),
  opencodeVersion: run("opencode", ["--version"]),
  platform: process.platform,
  architecture: process.arch,
  resultFiles,
  note: "Review all files for secrets, proprietary paths, or sensitive metadata before committing or publishing.",
}
await writeFile(join(destination, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8")

const walk = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

const files = (await walk(destination)).sort()
const manifest: Record<string, { bytes: number; sha256: string }> = {}
for (const path of files) {
  if (basename(path) === "manifest.json") continue
  const bytes = await readFile(path)
  const information = await stat(path)
  manifest[relative(destination, path).replaceAll("\\", "/")] = {
    bytes: information.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
}
await writeFile(join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")

console.log(`Published benchmark snapshot: ${destination}`)
console.log(`Files: ${Object.keys(manifest).length}`)
console.log("Inspect the snapshot before committing it.")
