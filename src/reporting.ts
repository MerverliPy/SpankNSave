import { chmod, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { safeFilename } from "./estimation.ts"
import type { AnalysisReport } from "./types.ts"

export const writeReport = async (directory: string, report: AnalysisReport): Promise<string> => {
  await mkdir(directory, { recursive: true })
  const target = join(directory, `${safeFilename(report.summary.sessionID)}.json`)
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  try {
    await chmod(temporary, 0o600)
  } catch {
    // Filesystem may not support POSIX modes.
  }
  await rename(temporary, target)
  return target
}

export const pruneReports = async (directory: string, maximumReports: number): Promise<void> => {
  await mkdir(directory, { recursive: true })
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort()
  const excess = entries.length - maximumReports
  if (excess <= 0) return
  await Promise.all(entries.slice(0, excess).map((name) => rm(join(directory, name), { force: true })))
}
