import type { Finding, Mode, SpankNSaveConfig, ToolObservation } from "../types.ts"
import { createFinding, makePatch } from "./helpers.ts"

export const detectOversizedToolOutput = (
  tools: ToolObservation[],
  config: SpankNSaveConfig,
  mode: Mode,
): Finding[] => {
  const oversized = tools
    .filter((tool) => tool.outputTokensEstimate > config.maxToolOutputTokens)
    .sort((a, b) => b.outputTokensEstimate - a.outputTokensEstimate)

  return oversized.slice(0, 3).map((tool) =>
    createFinding({
      severity: "warning",
      code: "OVERSIZED_TOOL_OUTPUT",
      cause: `Tool '${tool.tool}' returned more content than the configured result budget.`,
      confidence: "high",
      evidence: {
        tool: tool.tool,
        outputTokensEstimate: tool.outputTokensEstimate,
        budget: config.maxToolOutputTokens,
        alreadyTruncated: tool.truncated,
      },
      estimatedSavingsTokens: Math.max(0, tool.outputTokensEstimate - config.maxToolOutputTokens),
      recommendation:
        "Narrow the query, request ranges or limits, or truncate the middle while preserving the beginning and diagnostic tail.",
      proposedPatch: makePatch(
        "tooling",
        `.opencode/spank-n-save.json#maxToolOutputTokens`,
        `Bound '${tool.tool}' output`,
        `Set an appropriate output budget for '${tool.tool}' and prefer pagination, line ranges, or filtered commands.`,
        "low",
        mode === "enforce",
      ),
    }),
  )
}
