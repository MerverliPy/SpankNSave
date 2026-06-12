import type { Plugin } from "@opencode-ai/plugin"
import { mkdir } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { DEFAULT_CONFIG, loadConfig, shouldEnforceTool } from "./config.ts"
import { estimateTokens, stableHash, truncateMiddle } from "./estimation.ts"
import { pruneReports } from "./reporting.ts"
import type { SessionState } from "./types.ts"
import { SPANK_N_SAVE_VERSION } from "./version.ts"
import { OrderedMap } from "./ordered-map.ts"
import { getState, MAX_TRACKED_SESSIONS } from "./state.ts"
import { persistReport } from "./persistence.ts"
import { createHooks } from "./hooks.ts"

export const SpankNSave: Plugin = async ({ client, directory }) => {
  let config = DEFAULT_CONFIG
  let reportDirectory = ""
  const initWarnings: string[] = []

  const log = async (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    extra?: Record<string, unknown>,
  ): Promise<void> => {
    try {
      await client.app.log({
        body: {
          service: "spank-n-save",
          level,
          message,
          extra,
        },
      })
    } catch {
      console.warn("[spank-n-save] log failed")
      // Logging must never interrupt an OpenCode session.
    }
  }

  // Phase 1: Load configuration with full safety boundary.
  try {
    const loaded = await loadConfig(directory)
    config = loaded.config

    if (loaded.migratedFrom) {
      initWarnings.push(
        `Loaded legacy configuration from ${loaded.migratedFrom}. Migrate to ${loaded.path}.`,
      )
    }
  } catch (error) {
    config = { ...DEFAULT_CONFIG, mode: "observe" }
    initWarnings.push(
      `Failed to load configuration: ${error instanceof Error ? error.message : String(error)}. Using safe defaults in observe mode.`,
    )
  }

  // Phase 2: Resolve and validate report directory path.
  reportDirectory = isAbsolute(config.reportDirectory)
    ? config.reportDirectory
    : join(directory, config.reportDirectory)

  // Phase 3: Log initialization events regardless of enabled state.
  if (!config.enabled) {
    await log("info", "SpankNSave is disabled by configuration.")
    for (const warning of initWarnings) await log("warn", warning)
    return {}
  }

  // Phase 4: Create report directory and prune (non-fatal).
  try {
    await mkdir(reportDirectory, { recursive: true })
  } catch (error) {
    initWarnings.push(
      `Unable to create report directory at ${reportDirectory}: ${error instanceof Error ? error.message : String(error)}. Reports will not be saved.`,
    )
  }

  try {
    await pruneReports(reportDirectory, config.maxReports)
  } catch (error) {
    initWarnings.push(
      `Report pruning failed: ${error instanceof Error ? error.message : String(error)}.`,
    )
  }

  // Phase 5: Report initialization outcome.
  for (const warning of initWarnings) await log("warn", warning)

  await log("info", "SpankNSave initialized.", {
    version: SPANK_N_SAVE_VERSION,
    mode: config.mode,
    reportDirectory,
  })

  const states = new OrderedMap<string, SessionState>()
  const toolSchemaEstimates = new Map<string, number>()

  const showToast = async (body: { title?: string; message: string; variant: "info" | "success" | "warning" | "error"; duration?: number }) => {
    await client.tui.showToast({ body })
  }

  const persist = (sessionID: string) =>
    persistReport(states, sessionID, config, reportDirectory, toolSchemaEstimates, log, showToast)

  const evictLRU = async (): Promise<void> => {
    if (states.size <= MAX_TRACKED_SESSIONS) return
    const oldestKey = states.oldestKey()
    if (oldestKey !== undefined) {
      await persist(oldestKey)
      states.delete(oldestKey)
    }
  }

  return createHooks({
    states,
    config,
    toolSchemaEstimates,
    getState,
    persistReport: persist,
    evictLRU,
    estimateTokens,
    stableHash,
    truncateMiddle,
    shouldEnforceTool,
  })
}
