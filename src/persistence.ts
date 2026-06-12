import { analyzeSession } from "./analysis.ts"
import { pruneReports, writeReport } from "./reporting.ts"
import { SPANK_N_SAVE_VERSION } from "./version.ts"
import type { SessionState, SpankNSaveConfig } from "./types.ts"
import type { OrderedMap } from "./ordered-map.ts"

export const persistReport = async (
  states: OrderedMap<string, SessionState>,
  sessionID: string,
  config: SpankNSaveConfig,
  reportDirectory: string,
  toolSchemaEstimates: Map<string, number>,
  log: (level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) => Promise<void>,
  showToast: (body: { title?: string; message: string; variant: "info" | "success" | "warning" | "error"; duration?: number }) => Promise<unknown>,
): Promise<void> => {
  const state = states.get(sessionID)
  if (!state) return

  const sessionToolIDs = new Set(state.tools.map((entry) => entry.tool))
  const schemaTokens = [...sessionToolIDs].reduce(
    (sum, toolID) => sum + (toolSchemaEstimates.get(toolID) ?? 0),
    0,
  )
  const report = analyzeSession(
    sessionID,
    state,
    config,
    schemaTokens,
    SPANK_N_SAVE_VERSION,
    new Date().toISOString(),
  )

  try {
    const reportPath = await writeReport(reportDirectory, report)
    await pruneReports(reportDirectory, config.maxReports)
    await log("debug", "Session report written.", {
      sessionID,
      reportPath,
      findings: report.findings.length,
    })
  } catch (error) {
    await log("error", "Failed to write a SpankNSave report.", {
      sessionID,
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }

  if (!config.notify || config.mode === "observe" || report.findings.length === 0) return

  const now = Date.now()
  if (now - state.lastToastAt < config.toastCooldownMs) return
  state.lastToastAt = now

  const top = report.findings[0]
  if (!top) return

  try {
    await showToast({
      title: "SpankNSave",
      message: `${top.code}: ${top.recommendation}`,
      variant:
        top.severity === "critical"
          ? "error"
          : top.severity === "warning"
            ? "warning"
            : "info",
      duration: 8_000,
    })
  } catch (error) {
    await log("debug", "TUI notification was unavailable.", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
