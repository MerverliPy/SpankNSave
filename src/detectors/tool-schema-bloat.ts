import type { Finding, SpankNSaveConfig } from "../types.ts"
import { createFinding, makePatch } from "./helpers.ts"

export const detectToolSchemaBloat = (
  toolSchemaTokensEstimate: number,
  config: SpankNSaveConfig,
): Finding | null => {
  if (toolSchemaTokensEstimate <= config.maxToolSchemaTokens) return null

  const savings = toolSchemaTokensEstimate - config.maxToolSchemaTokens

  return createFinding({
    severity: "warning",
    code: "TOOL_SCHEMA_BLOAT",
    cause: "Enabled tool definitions consume a large estimated portion of every model request.",
    confidence: "low",
    evidence: {
      toolSchemaTokensEstimate,
      budget: config.maxToolSchemaTokens,
    },
    estimatedSavingsTokens: savings,
    recommendation:
      "Disable unused MCP tool families globally and enable them only for agents that require them.",
    proposedPatch: makePatch(
      "configuration",
      "opencode.json",
      "Scope large tool families to specialized agents",
      '{\n  "tools": { "<large-prefix>_*": false },\n  "agent": { "<specialist>": { "tools": { "<large-prefix>_*": true } } }\n}',
      "low",
    ),
  })
}
