import assert from "node:assert/strict"
import { mkdir, mkdtemp, readdir, symlink, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { pruneReports, writeReport } from "../src/reporting.ts"
import type { AnalysisReport } from "../src/types.ts"

const report = (sessionID: string, ageMinutes = 0): AnalysisReport => ({
  schemaVersion: 1,
  generatedAt: new Date(Date.now() - ageMinutes * 60_000).toISOString(),
  plugin: { name: "SpankNSave", version: "0.1.0", mode: "suggest" },
  measurementPolicy: {
    authoritative: [],
    estimated: [],
    rawContentPersisted: false,
  },
  summary: {
    sessionID,
    contextLimit: 10_000,
    latestContextTokens: 1_000,
    cumulative: { input: 1_000, output: 500, reasoning: 100, cacheRead: 0, cacheWrite: 0, cost: 0.01 },
    estimated: {
      latestPromptTokens: 200,
      systemTokens: 100,
      enabledToolSchemaTokens: 0,
    },
    toolCalls: 0,
    retries: 0,
    compactions: 0,
    filesChanged: 0,
  },
  findings: [],
})

test("pruneReports preserves unrelated files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prune-test-"))
  const maxReports = 2

  await writeFile(join(directory, "unrelated.json"), "{}")
  await writeFile(join(directory, "notes.txt"), "hello")
  await writeFile(join(directory, "spanknsave-keep1.json"), JSON.stringify(report("keep1")))
  await writeFile(join(directory, "spanknsave-keep2.json"), JSON.stringify(report("keep2")))
  await writeFile(join(directory, "spanknsave-keep3.json"), JSON.stringify(report("keep3")))

  await pruneReports(directory, maxReports)

  const remaining = await readdir(directory)
  assert.ok(remaining.includes("unrelated.json"))
  assert.ok(remaining.includes("notes.txt"))
  assert.equal(remaining.filter((n) => n.startsWith("spanknsave-")).length, maxReports)
})

test("pruneReports removes oldest owned reports first", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prune-test-"))
  const maxReports = 2
  const now = Date.now()

  const old1Path = join(directory, "spanknsave-old1.json")
  const old2Path = join(directory, "spanknsave-old2.json")
  const recentPath = join(directory, "spanknsave-recent.json")
  const newestPath = join(directory, "spanknsave-newest.json")

  await writeFile(old1Path, JSON.stringify(report("old1")))
  await writeFile(old2Path, JSON.stringify(report("old2")))
  await writeFile(recentPath, JSON.stringify(report("recent")))
  await writeFile(newestPath, JSON.stringify(report("newest")))

  await utimes(old1Path, new Date(now - 60_000), new Date(now - 60_000))
  await utimes(old2Path, new Date(now - 50_000), new Date(now - 50_000))
  await utimes(recentPath, new Date(now - 1_000), new Date(now - 1_000))
  await utimes(newestPath, new Date(now), new Date(now))

  await pruneReports(directory, maxReports)

  const remaining = await readdir(directory)
  const owned = remaining.filter((n) => n.startsWith("spanknsave-"))
  assert.equal(owned.length, maxReports)
  assert.ok(owned.includes("spanknsave-newest.json"))
  assert.ok(owned.includes("spanknsave-recent.json"))
})

test("pruneReports ignores malformed entries and temp files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prune-test-"))

  await writeFile(join(directory, "spanknsave-broken.json"), "not-json-at-all")
  await writeFile(join(directory, "spanknsave-report.json.tmp"), JSON.stringify(report("tmp")))
  await writeFile(join(directory, "spanknsave-valid.json"), JSON.stringify(report("valid")))

  await pruneReports(directory, 10)

  const remaining = await readdir(directory)
  assert.ok(remaining.includes("spanknsave-broken.json"))
  assert.ok(remaining.includes("spanknsave-report.json.tmp"))
  assert.ok(remaining.includes("spanknsave-valid.json"))
})

test("pruneReports handles empty and nonexistent directories", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prune-test-"))

  await pruneReports(directory, 5)

  const remaining = await readdir(directory)
  assert.equal(remaining.length, 0)

  await pruneReports(join(directory, "nonexistent"), 5)
})

test("pruneReports does not remove when under the limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prune-test-"))

  await writeFile(join(directory, "spanknsave-one.json"), JSON.stringify(report("one")))
  await writeFile(join(directory, "spanknsave-two.json"), JSON.stringify(report("two")))

  await pruneReports(directory, 5)

  const remaining = await readdir(directory)
  const owned = remaining.filter((n) => n.startsWith("spanknsave-"))
  assert.equal(owned.length, 2)
})

test("pruneReports skips symlinks to non-owned files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prune-test-"))
  const targetFile = join(directory, "target.json")

  await writeFile(targetFile, JSON.stringify(report("sym")))
  await symlink(targetFile, join(directory, "spanknsave-link.json"))
  await writeFile(join(directory, "spanknsave-real.json"), JSON.stringify(report("real")))

  await pruneReports(directory, 1)

  const remaining = await readdir(directory)
  const owned = remaining.filter((n) => n.startsWith("spanknsave-"))
  assert.equal(owned.length, 2)
  assert.ok(owned.includes("spanknsave-link.json"))
  assert.ok(owned.includes("spanknsave-real.json"))
})
