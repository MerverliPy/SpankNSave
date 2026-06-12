import type { Finding, SpankNSaveConfig } from "../types.ts"
import { createFinding, makePatch } from "./helpers.ts"

export const detectOversizedUserPrompt = (
  userTextPromptTokensEstimate: number,
  config: SpankNSaveConfig,
): Finding | null => {
  if (userTextPromptTokensEstimate <= config.maxPromptTokens) return null

  const savings = userTextPromptTokensEstimate - config.maxPromptTokens

  return createFinding({
    severity: "warning",
    code: "OVERSIZED_USER_PROMPT",
    cause: "The latest user prompt (text-only estimate) is larger than the configured prompt budget.",
    confidence: "medium",
    evidence: {
      promptTokensEstimate: userTextPromptTokensEstimate,
      budget: config.maxPromptTokens,
    },
    estimatedSavingsTokens: savings,
    recommendation:
      "Replace repeated background text with a concise task statement plus file references or an on-demand skill.",
    proposedPatch: makePatch(
      "prompt",
      ".opencode/skills/<domain>/SKILL.md",
      "Extract reusable prompt material",
      "Move stable procedures and examples into a narrowly described skill; keep live prompts task-specific.",
      "low",
    ),
  })
}
