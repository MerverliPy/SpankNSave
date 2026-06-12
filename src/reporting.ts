import { chmod, lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { safeFilename } from "./estimation.ts"
import type { AnalysisReport } from "./types.ts"

const REPORT_PREFIX = "spanknsave-"

/**
 * Writes an analysis report atomically via temp file + rename.
 * Reports are written as spanknsave-{sanitizedSessionID}.json with 0600 permissions.
 * @param directory - Target report directory.
 * @param report - Complete analysis report to write.
 * @returns Absolute path to the written report file.
 * @throws If the resolved report path escapes the target directory.
 */
export const writeReport = async (directory: string, report: AnalysisReport): Promise<string> => {
  await mkdir(directory, { recursive: true })
  const target = join(directory, `${REPORT_PREFIX}${safeFilename(report.summary.sessionID)}.json`)
  const rel = relative(directory, target)
  if (!rel || rel.startsWith("..") || rel.includes(".." + sep)) {
    throw new Error(`Report path escapes directory: ${target}`)
  }
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  try {
    await chmod(temporary, 0o600)
  } catch {
    console.warn("[spank-n-save] chmod failed")
    // Filesystem may not support POSIX modes.
  }
  await rename(temporary, target)
  return target
}

/**
 * Checks if a directory entry name matches the SpankNSave report naming convention.
 * @param entryName - File or directory entry name.
 * @returns true if the entry is a SpankNSave-owned report.
 */
const isOwnedReport = (entryName: string): boolean =>
  entryName.startsWith(REPORT_PREFIX) && entryName.endsWith(".json") && entryName.length > REPORT_PREFIX.length + 5

/**
 * Removes the oldest SpankNSave reports when count exceeds the configured maximum.
 * Only removes files matching the spanknsave-*.json naming pattern. Non-owned files are preserved.
 * @param directory - Report directory to prune.
 * @param maximumReports - Maximum number of reports to retain.
 */
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
      console.warn("[spank-n-save] lstat failed")
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
        console.warn("[spank-n-save] rm failed")
        // A single removal failure should not block pruning of other reports.
      }),
    ),
  )
}
