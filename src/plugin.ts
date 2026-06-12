import type { Plugin } from "@opencode-ai/plugin"
import type { AssistantMessage, Part } from "@opencode-ai/sdk"
import { mkdir } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { analyzeSession } from "./analysis.ts"
import { DEFAULT_CONFIG, loadConfig, shouldEnforceTool } from "./config.ts"
import { estimateTokens, stableHash, truncateMiddle } from "./estimation.ts"
import { pruneReports, writeReport } from "./reporting.ts"
import type { AssistantUsage, SessionState } from "./types.ts"
import { SPANK_N_SAVE_VERSION } from "./version.ts"

const MAX_TRACKED_SESSIONS = 50
const MAX_ASSISTANT_MESSAGES = 2

const getState = (states: Map<string, SessionState>, sessionID: string): SessionState => {
  const existing = states.get(sessionID)
  if (existing) {
    existing.lastActivityAt = Date.now()
    return existing
  }

  const created: SessionState = {
    userPromptTokensEstimate: 0,
    systemTokensEstimate: 0,
    assistantMessages: new Map(),
    tools: [],
    retries: 0,
    compactions: 0,
    filesChangedCount: 0,
    lastToastAt: 0,
    lastActivityAt: Date.now(),
  }
  states.set(sessionID, created)
  return created
}

const textTokenEstimate = (parts: Part[], charsPerToken: number): number =>
  parts.reduce(
    (sum, part) =>
      sum +
      (part.type === "text" && "text" in part
        ? estimateTokens(part.text, charsPerToken)
        : 0),
    0,
  )

const normalizeAssistantMessage = (message: AssistantMessage): AssistantUsage => ({
  id: message.id,
  sessionID: message.sessionID,
  createdAt: message.time.created,
  providerID: message.providerID,
  modelID: message.modelID,
  cost: message.cost,
  input: message.tokens.input,
  output: message.tokens.output,
  reasoning: message.tokens.reasoning,
  cacheRead: message.tokens.cache.read,
  cacheWrite: message.tokens.cache.write,
})

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

  const states = new Map<string, SessionState>()
  const toolSchemaEstimates = new Map<string, number>()

  const persistReport = async (sessionID: string): Promise<void> => {
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
      await client.tui.showToast({
        body: {
          title: "SpankNSave",
          message: `${top.code}: ${top.recommendation}`,
          variant:
            top.severity === "critical"
              ? "error"
              : top.severity === "warning"
                ? "warning"
                : "info",
          duration: 8_000,
        },
      })
    } catch (error) {
      await log("debug", "TUI notification was unavailable.", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const evictLRU = async (): Promise<void> => {
    if (states.size <= MAX_TRACKED_SESSIONS) return
    let oldestID: string | undefined
    let oldestTime = Infinity
    for (const [id, s] of states) {
      if (s.lastActivityAt < oldestTime) {
        oldestTime = s.lastActivityAt
        oldestID = id
      }
    }
    if (oldestID) {
      await persistReport(oldestID)
      states.delete(oldestID)
    }
  }

  return {
    "chat.message": async (input, output) => {
      const state = getState(states, input.sessionID)
      state.userPromptTokensEstimate = textTokenEstimate(
        output.parts,
        config.charsPerTokenEstimate,
      )
    },

    "chat.params": async (input, output) => {
      const state = getState(states, input.sessionID)
      state.contextLimit = input.model.limit?.context

      if (config.mode === "enforce" && config.maxOutputTokens !== undefined) {
        output.maxOutputTokens = Math.min(
          output.maxOutputTokens ?? config.maxOutputTokens,
          config.maxOutputTokens,
        )
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) return
      const state = getState(states, input.sessionID)
      state.systemTokensEstimate = output.system.reduce(
        (sum, value) => sum + estimateTokens(value, config.charsPerTokenEstimate),
        0,
      )
    },

    "tool.definition": async (input, output) => {
      let parameters: string
      try {
        parameters = JSON.stringify(output.parameters)
      } catch {
        parameters = String(output.parameters)
      }
      toolSchemaEstimates.set(
        input.toolID,
        estimateTokens(`${output.description}\n${parameters}`, config.charsPerTokenEstimate),
      )
    },

    "tool.execute.after": async (input, output) => {
      const state = getState(states, input.sessionID)
      const originalOutput = output.output
      const originalTokensEstimate = estimateTokens(originalOutput, config.charsPerTokenEstimate)
      let truncated = false

      if (
        config.mode === "enforce" &&
        shouldEnforceTool(input.tool, config) &&
        originalTokensEstimate > config.maxToolOutputTokens
      ) {
        const result = truncateMiddle(
          originalOutput,
          config.maxToolOutputTokens,
          config.charsPerTokenEstimate,
          config.truncationHeadRatio,
        )
        output.output = result.text
        truncated = result.truncated
      }

      state.tools.push({
        callID: input.callID,
        tool: input.tool,
        argsHash: stableHash(input.args),
        outputChars: originalOutput.length,
        outputTokensEstimate: originalTokensEstimate,
        truncated,
        observedAt: Date.now(),
      })

      if (state.tools.length > config.maxToolObservationsPerSession) {
        state.tools.splice(0, state.tools.length - config.maxToolObservationsPerSession)
      }
    },

    event: async ({ event }) => {
      if (event.type === "message.updated") {
        const message = event.properties.info
        if (message.role === "assistant") {
          const state = getState(states, message.sessionID)
          state.assistantMessages.set(
            message.id,
            normalizeAssistantMessage(message),
          )
          // Cap retained messages: only keep the most recent entries.
          if (state.assistantMessages.size > MAX_ASSISTANT_MESSAGES) {
            const sorted = [...state.assistantMessages.entries()]
              .sort(([, a], [, b]) => a.createdAt - b.createdAt)
            for (let i = 0; i < sorted.length - MAX_ASSISTANT_MESSAGES; i++) {
              const [id] = sorted[i]!
              state.assistantMessages.delete(id)
            }
          }
        }
        return
      }

      if (event.type === "message.removed") {
        states.get(event.properties.sessionID)?.assistantMessages.delete(event.properties.messageID)
        return
      }

      if (event.type === "message.part.updated") {
        const part = event.properties.part
        if (part.type === "retry") getState(states, part.sessionID).retries += 1
        return
      }

      if (event.type === "session.diff") {
        const state = getState(states, event.properties.sessionID)
        state.filesChangedCount += event.properties.diff.length
        return
      }

      if (event.type === "session.compacted") {
        getState(states, event.properties.sessionID).compactions += 1
        return
      }

      if (event.type === "session.idle") {
        await persistReport(event.properties.sessionID)
        await evictLRU()
        return
      }

      if (event.type === "session.deleted") {
        states.delete(event.properties.info.id)
      }
    },

    dispose: async () => {
      for (const sessionID of states.keys()) await persistReport(sessionID)
      states.clear()
      toolSchemaEstimates.clear()
    },
  }
}
