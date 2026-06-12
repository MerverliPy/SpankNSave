import type { AssistantUsage, Finding, SpankNSaveConfig } from "../types.ts"
import { createFinding, makePatch } from "./helpers.ts"

export const detectRapidContextGrowth = (
  messages: AssistantUsage[],
  config: SpankNSaveConfig,
): Finding | null => {
  if (messages.length < 2) return null

  const latest = messages.at(-1)
  const previous = messages.at(-2)
  if (!latest || !previous) return null

  const growth = latest.input - previous.input
  if (growth <= config.maxContextGrowthTokensPerTurn) return null

  return createFinding({
    severity: "warning",
    code: "RAPID_CONTEXT_GROWTH",
    cause: "Input context expanded sharply between consecutive assistant turns.",
    confidence: "medium",
    evidence: {
      previousInputTokens: previous.input,
      latestInputTokens: latest.input,
      growthTokens: growth,
      budget: config.maxContextGrowthTokensPerTurn,
    },
    estimatedSavingsTokens: Math.max(0, growth - config.maxContextGrowthTokensPerTurn),
    recommendation:
      "Identify the newly introduced prompt, tool result, skill, or schema and replace it with a bounded summary or narrower query.",
    proposedPatch: makePatch(
      "workflow",
      "prompt and tool-result pipeline",
      "Bound one-turn context growth",
      `Keep incremental context growth below approximately ${config.maxContextGrowthTokensPerTurn} tokens unless the task explicitly requires bulk ingestion.`,
      "medium",
    ),
  })
}
