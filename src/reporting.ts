import { chmod, lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { safeFilename } from "./estimation.ts"
import type { AnalysisReport } from "./types.ts"

const REPORT_PREFIX = "spanknsave-"

export const writeReport = async (directory: string, report: AnalysisReport): Promise<string> => {
  await mkdir(directory, { recursive: true })
  const target = join(directory, `${REPORT_PREFIX}${safeFilename(report.summary.sessionID)}.json`)
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

const isOwnedReport = (entryName: string): boolean =>
  entryName.startsWith(REPORT_PREFIX) && entryName.endsWith(".json") && entryName.length > REPORT_PREFIX.length + 5

export const pruneReports = async (directory: string, maximumReports: number): Promise<void> => {
  await mkdir(directory, { recursive: true })
  const entries = await readdir(directory, { withFileTypes: true })

  const ownedWithAge: { name: string; mtimeMs: number }[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !isOwnedReport(entry.name)) continue
    try {
      const stat = await lstat(join(directory, entry.name))
      if (!stat.isFile()) continue
      ownedWithAge.push({ name: entry.name, mtimeMs: stat.mtimeMs })
    } catch {
      // Skip entries that cannot be stat'd (e.g. permission errors, broken symlinks).
    }
  }

  ownedWithAge.sort((a, b) => a.mtimeMs - b.mtimeMs)
  const excess = ownedWithAge.length - maximumReports
  if (excess <= 0) return

  const toRemove = ownedWithAge.slice(0, excess)
  await Promise.all(
    toRemove.map((entry) =>
      rm(join(directory, entry.name), { force: true }).catch(() => {
        // A single removal failure should not block pruning of other reports.
      }),
    ),
  )
}
