import type { AssistantUsage, Finding, SpankNSaveConfig } from "../types.ts"
import { createFinding, makePatch } from "./helpers.ts"

const totalTokens = (message: AssistantUsage): number =>
  message.input + message.output + message.reasoning + message.cacheRead + message.cacheWrite

export const detectContextPressure = (
  latest: AssistantUsage | undefined,
  contextLimit: number | undefined,
  config: SpankNSaveConfig,
): Finding | null => {
  if (contextLimit === undefined) return null

  const latestTotal = latest ? totalTokens(latest) : 0
  if (latestTotal === 0) return null

  const contextRatio = latestTotal / contextLimit
  if (contextRatio < config.warningContextRatio) return null

  const critical = contextRatio >= config.criticalContextRatio
  const savings = Math.round(latestTotal * (critical ? 0.45 : 0.3))

  return createFinding({
    severity: critical ? "critical" : "warning",
    code: "CONTEXT_PRESSURE",
    cause: "The active request is consuming a high percentage of the model context window.",
    confidence: "high",
    evidence: {
      latestContextTokens: latestTotal,
      contextLimit,
      contextPercent: Math.round(contextRatio * 100),
    },
    estimatedSavingsTokens: savings,
    recommendation:
      "Compact completed work, preserve only active decisions and files, and move reusable procedures out of persistent context.",
    proposedPatch: makePatch(
      "compaction",
      "active OpenCode session",
      "Compact stale session context",
      "Run session compaction and retain the task, accepted decisions, active files, unresolved errors, and next actions only.",
      "medium",
    ),
  })
}
