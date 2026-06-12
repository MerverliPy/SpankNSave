import type { AssistantUsage, Finding, SpankNSaveConfig } from "../types.ts"
import { createFinding, makePatch } from "./helpers.ts"

export const detectHighReasoningShare = (
  latest: AssistantUsage | undefined,
  config: SpankNSaveConfig,
): Finding | null => {
  if (!latest) return null

  const generated = latest.output + latest.reasoning
  const reasoningRatio = generated > 0 ? latest.reasoning / generated : 0

  if (latest.reasoning < config.minReasoningTokens || reasoningRatio <= config.maxReasoningRatio) {
    return null
  }

  return createFinding({
    severity: "info",
    code: "HIGH_REASONING_SHARE",
    cause: "The latest turn used a high share of generated tokens for reasoning.",
    confidence: "medium",
    evidence: {
      reasoningTokens: latest.reasoning,
      outputTokens: latest.output,
      reasoningPercent: Math.round(reasoningRatio * 100),
    },
    estimatedSavingsTokens: Math.round(
      Math.max(0, latest.reasoning - generated * config.maxReasoningRatio),
    ),
    recommendation:
      "Use a lower reasoning setting or smaller model for routine deterministic edits; retain deeper reasoning for ambiguous or high-risk work.",
    proposedPatch: makePatch(
      "configuration",
      "OpenCode agent/model configuration",
      "Route routine work to a lower-reasoning profile",
      "Create a focused routine-edit agent with a smaller model or lower reasoning level, while preserving the current profile for complex work.",
      "medium",
    ),
  })
}
