import type {
  AnalysisReport,
  AssistantUsage,
  SessionState,
  SpankNSaveConfig,
} from "./types.ts"
import { detectContextPressure } from "./detectors/context-pressure.ts"
import { detectDuplicateToolCalls } from "./detectors/duplicate-tool-calls.ts"
import { detectExcessiveAssistantOutput } from "./detectors/excessive-assistant-output.ts"
import { detectHighReasoningShare } from "./detectors/high-reasoning-share.ts"
import { detectOversizedSystemContext } from "./detectors/oversized-system-context.ts"
import { detectOversizedToolOutput } from "./detectors/oversized-tool-output.ts"
import { detectOversizedUserPrompt } from "./detectors/oversized-user-prompt.ts"
import { detectRapidContextGrowth } from "./detectors/rapid-context-growth.ts"
import { detectRetryWaste } from "./detectors/retry-waste.ts"
import { detectToolSchemaBloat } from "./detectors/tool-schema-bloat.ts"

const totalTokens = (message: AssistantUsage): number =>
  message.input + message.output + message.reasoning + message.cacheRead + message.cacheWrite

/**
 * Produces an AnalysisReport from session state by running all detection rules.
 * @param sessionID - Unique session identifier.
 * @param state - Current session state including messages, tools, and metrics.
 * @param config - Resolved plugin configuration.
 * @param toolSchemaTokensEstimate - Estimated tokens consumed by tool definitions for this session.
 * @param version - Plugin version string.
 * @param generatedAt - ISO-8601 timestamp (defaults to now if omitted).
 * @returns A complete analysis report with findings, summary, and measurement policy.
 */
export const analyzeSession = (
  sessionID: string,
  state: SessionState,
  config: SpankNSaveConfig,
  toolSchemaTokensEstimate: number,
  version: string,
  generatedAt?: string,
): AnalysisReport => {
  const messages = [...state.assistantMessages.values()].sort((a, b) => a.createdAt - b.createdAt)
  const latest = [...messages].reverse().find((message) => totalTokens(message) > 0)
  const findings = []

  findings.push(
    detectContextPressure(latest, state.contextLimit, config),
    detectRapidContextGrowth(messages, config),
    detectOversizedUserPrompt(state.userTextPromptTokensEstimate, config),
    detectOversizedSystemContext(state.systemTokensEstimate, config),
    detectToolSchemaBloat(toolSchemaTokensEstimate, config),
    ...detectOversizedToolOutput(state.tools, config, config.mode),
    detectDuplicateToolCalls(state.tools, config),
    detectHighReasoningShare(latest, config),
    detectExcessiveAssistantOutput(latest, config, config.mode),
    detectRetryWaste(state.retries),
  )

  const filtered = findings.filter((f): f is NonNullable<typeof f> => f !== null)

  const latestTotal = latest ? totalTokens(latest) : 0
  const contextRatio = state.contextLimit ? latestTotal / state.contextLimit : undefined

  const cumulative = messages.reduce(
    (sum, message) => ({
      input: sum.input + message.input,
      output: sum.output + message.output,
      reasoning: sum.reasoning + message.reasoning,
      cacheRead: sum.cacheRead + message.cacheRead,
      cacheWrite: sum.cacheWrite + message.cacheWrite,
      cost: sum.cost + message.cost,
    }),
    { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  )

  filtered.sort((left, right) => {
    if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore
    const savingsDiff = (right.estimatedSavingsTokens ?? 0) - (left.estimatedSavingsTokens ?? 0)
    if (savingsDiff !== 0) return savingsDiff
    return left.code.localeCompare(right.code)
  })

  return {
    schemaVersion: 1,
    generatedAt: generatedAt ?? new Date().toISOString(),
    plugin: { name: "SpankNSave", version, mode: config.mode },
    measurementPolicy: {
      authoritative: [
        "provider-reported input, output, reasoning, cache, and cost fields",
        "OpenCode model context limit",
      ],
      estimated: [
        "prompt component tokens (text-only estimate; non-text parts are not measured)",
        "system instruction tokens",
        "tool schema tokens (upper-bound from tools observed in this session; may include definitions loaded outside the session)",
        "tool output attribution",
        "potential token savings",
      ],
      rawContentPersisted: false,
      privacy: {
        perMessageIdentifiers: "never-persisted",
        toolArgHashes: "never-persisted",
        rawPrompts: "never-persisted",
      },
    },
    summary: {
      sessionID,
      contextLimit: state.contextLimit,
      latestContextTokens: latestTotal,
      contextPercent: contextRatio === undefined ? undefined : Math.round(contextRatio * 100),
      cumulative,
      estimated: {
        latestTextPromptTokens: state.userTextPromptTokensEstimate,
        systemTokens: state.systemTokensEstimate,
        enabledToolSchemaTokens: toolSchemaTokensEstimate,
      },
      toolCalls: state.tools.length,
      retries: state.retries,
      compactions: state.compactions,
      filesChanged: state.filesChangedCount,
    },
    findings: filtered,
  }
}
