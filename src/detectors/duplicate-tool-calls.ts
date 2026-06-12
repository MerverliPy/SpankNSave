import type { Finding, SpankNSaveConfig, ToolObservation } from "../types.ts"
import { createFinding, makePatch } from "./helpers.ts"

export const detectDuplicateToolCalls = (
  tools: ToolObservation[],
  config: SpankNSaveConfig,
): Finding | null => {
  const duplicateCounts = new Map<string, { count: number; tool: string; outputTokens: number }>()
  for (const tool of tools) {
    const key = `${tool.tool}:${tool.argsHash}`
    const current = duplicateCounts.get(key) ?? { count: 0, tool: tool.tool, outputTokens: 0 }
    current.count += 1
    current.outputTokens += tool.outputTokensEstimate
    duplicateCounts.set(key, current)
  }

  const duplicates = [...duplicateCounts.values()].filter(
    (entry) => entry.count >= config.duplicateToolCallThreshold,
  )

  if (duplicates.length === 0) return null

  const duplicateWaste = duplicates.reduce(
    (sum, entry) => sum + Math.max(0, entry.outputTokens - entry.outputTokens / entry.count),
    0,
  )

  return createFinding({
    severity: "warning",
    code: "DUPLICATE_TOOL_CALLS",
    cause: "The session repeated one or more tools with identical normalized arguments.",
    confidence: "high",
    evidence: {
      duplicateGroups: duplicates.length,
      repeatedTools: [...new Set(duplicates.map((entry) => entry.tool))],
      threshold: config.duplicateToolCallThreshold,
    },
    estimatedSavingsTokens: Math.round(duplicateWaste),
    recommendation:
      "Reuse prior results until relevant files or external state change; refine the request before repeating a failed call.",
    proposedPatch: makePatch(
      "workflow",
      "agent tool-use policy",
      "Avoid unchanged duplicate calls",
      "Before repeating an identical tool call, verify that its inputs or relevant repository state changed. Otherwise reuse the prior result.",
      "medium",
    ),
  })
}
