import type { Finding, SpankNSaveConfig } from "../types.ts"
import { createFinding, makePatch } from "./helpers.ts"

export const detectOversizedSystemContext = (
  systemTokensEstimate: number,
  config: SpankNSaveConfig,
): Finding | null => {
  if (systemTokensEstimate <= config.maxSystemTokens) return null

  const savings = systemTokensEstimate - config.maxSystemTokens

  return createFinding({
    severity: "warning",
    code: "OVERSIZED_SYSTEM_CONTEXT",
    cause: "System instructions and persistent project rules exceed the configured budget.",
    confidence: "medium",
    evidence: {
      systemTokensEstimate,
      budget: config.maxSystemTokens,
    },
    estimatedSavingsTokens: savings,
    recommendation:
      "Deduplicate rules, remove redundant examples, and move specialized procedures into on-demand skills.",
    proposedPatch: makePatch(
      "prompt",
      "AGENTS.md and .opencode/skills/",
      "Split persistent and on-demand instructions",
      "Keep only project-wide invariants in AGENTS.md. Move task-specific workflows into focused SKILL.md files.",
      "medium",
    ),
  })
}
