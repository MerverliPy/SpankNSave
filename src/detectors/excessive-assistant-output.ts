import type { AssistantUsage, Finding, Mode, SpankNSaveConfig } from "../types.ts"
import { createFinding, makePatch } from "./helpers.ts"

export const detectExcessiveAssistantOutput = (
  latest: AssistantUsage | undefined,
  config: SpankNSaveConfig,
  mode: Mode,
): Finding | null => {
  if (!latest) return null
  if (latest.output <= config.maxAssistantOutputTokens) return null

  return createFinding({
    severity: "warning",
    code: "EXCESSIVE_ASSISTANT_OUTPUT",
    cause: "The latest assistant response exceeded the configured output budget.",
    confidence: "high",
    evidence: {
      outputTokens: latest.output,
      budget: config.maxAssistantOutputTokens,
    },
    estimatedSavingsTokens: latest.output - config.maxAssistantOutputTokens,
    recommendation:
      "Request concise progress updates and cap model output where long prose is not part of the deliverable.",
    proposedPatch: makePatch(
      "configuration",
      ".opencode/spank-n-save.json#maxOutputTokens",
      "Cap generated output in enforce mode",
      `Set "maxOutputTokens" to ${config.maxAssistantOutputTokens} after confirming that this does not truncate required deliverables.`,
      "medium",
      mode === "enforce" && config.maxOutputTokens !== undefined,
    ),
  })
}
