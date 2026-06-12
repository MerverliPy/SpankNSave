# Detection Reference

SpankNSave analyzes each session against configurable token budgets and produces prioritized findings. Every detection includes a severity level, evidence with exact measurements, a confidence rating, estimated token savings, and a recommended patch. Provider-reported token fields and model limits are authoritative; prompt, system, schema, tool-output attribution, and savings values are estimates.

## Detectors

### CONTEXT_PRESSURE

| Field | Value |
| --- | --- |
| **Code** | `CONTEXT_PRESSURE` |
| **Description** | The active request is consuming a high percentage of the model context window. |
| **Severity** | `warning` when `contextRatio >= warningContextRatio` (default 0.70); `critical` when `contextRatio >= criticalContextRatio` (default 0.85) |
| **Threshold** | `config.warningContextRatio`, `config.criticalContextRatio` |
| **Evidence** | `latestContextTokens`, `contextLimit`, `contextPercent` |
| **User action** | Compact completed work, preserve only active decisions and files, and move reusable procedures out of persistent context. Review `contextPercent` to gauge urgency; values above the critical threshold risk model quality degradation. |

### RAPID_CONTEXT_GROWTH

| Field | Value |
| --- | --- |
| **Code** | `RAPID_CONTEXT_GROWTH` |
| **Description** | Input context expanded sharply between consecutive assistant turns. Requires at least 2 assistant messages. |
| **Severity** | `warning` |
| **Threshold** | `inputTokensGrowth > maxContextGrowthTokensPerTurn` (default 12,000) |
| **Evidence** | `previousInputTokens`, `latestInputTokens`, `growthTokens`, `budget` |
| **User action** | Identify the newly introduced prompt, tool result, skill, or schema and replace it with a bounded summary or narrower query. Confirm the growth source is intentional before ignoring. |

### OVERSIZED_USER_PROMPT

| Field | Value |
| --- | --- |
| **Code** | `OVERSIZED_USER_PROMPT` |
| **Description** | The latest user prompt (text-only estimate) is larger than the configured prompt budget. |
| **Severity** | `warning` |
| **Threshold** | `latestTextPromptTokens > maxPromptTokens` (default 4,000) |
| **Evidence** | `promptTokensEstimate`, `budget` |
| **User action** | Replace repeated background text with a concise task statement plus file references or an on-demand skill. This estimate only covers `text` content parts; images, tool results, and file attachments are excluded. |

### OVERSIZED_SYSTEM_CONTEXT

| Field | Value |
| --- | --- |
| **Code** | `OVERSIZED_SYSTEM_CONTEXT` |
| **Description** | System instructions and persistent project rules exceed the configured budget. |
| **Severity** | `warning` |
| **Threshold** | `systemTokensEstimate > maxSystemTokens` (default 8,000) |
| **Evidence** | `systemTokensEstimate`, `budget` |
| **User action** | Deduplicate rules, remove redundant examples, and move specialized procedures into on-demand skills. Keep only project-wide invariants in AGENTS.md; route task-specific workflows into focused SKILL.md files. |

### TOOL_SCHEMA_BLOAT

| Field | Value |
| --- | --- |
| **Code** | `TOOL_SCHEMA_BLOAT` |
| **Description** | Enabled tool definitions consume a large estimated portion of every model request, computed as the sum of tool schema tokens for tools actually observed in the session. |
| **Severity** | `warning` |
| **Threshold** | `toolSchemaTokensEstimate > maxToolSchemaTokens` (default 5,000) |
| **Confidence** | `low` — schema estimate is an upper bound from tools observed in the session and may include definitions loaded outside the session. |
| **Evidence** | `toolSchemaTokensEstimate`, `budget` |
| **User action** | Disable unused MCP tool families globally and enable them only for agents that require them. Scope large tool families to specialized agents in `opencode.json`. |

### OVERSIZED_TOOL_OUTPUT

| Field | Value |
| --- | --- |
| **Code** | `OVERSIZED_TOOL_OUTPUT` |
| **Description** | A tool returned more content than the configured result budget. Capped at 3 findings per session (largest offenders first). |
| **Severity** | `warning` |
| **Threshold** | `outputTokensEstimate > maxToolOutputTokens` (default 6,000) |
| **Evidence** | `tool`, `outputTokensEstimate`, `budget`, `alreadyTruncated` |
| **User action** | Narrow the query, request ranges or limits, or enable truncation. If `alreadyTruncated` is `true`, the output was already capped but still exceeds budget — reduce the budget or restructure the query. |

### DUPLICATE_TOOL_CALLS

| Field | Value |
| --- | --- |
| **Code** | `DUPLICATE_TOOL_CALLS` |
| **Description** | The session repeated one or more tools with identical normalized arguments (SHA-256 hash). |
| **Severity** | `warning` |
| **Threshold** | Same `argsHash` for same tool appears `>= duplicateToolCallThreshold` (default 2) |
| **Evidence** | `duplicateGroups`, `repeatedTools`, `threshold` |
| **User action** | Reuse prior results until relevant files or external state change. Before repeating an identical tool call, verify that its inputs or relevant repository state changed. |

### HIGH_REASONING_SHARE

| Field | Value |
| --- | --- |
| **Code** | `HIGH_REASONING_SHARE` |
| **Description** | The latest turn used a high share of generated tokens for reasoning. Only triggers when `reasoningTokens >= minReasoningTokens` (default 4,000). |
| **Severity** | `info` |
| **Threshold** | `reasoningRatio >= maxReasoningRatio` (default 0.55) when `reasoningTokens >= minReasoningTokens` |
| **Evidence** | `reasoningTokens`, `outputTokens`, `reasoningPercent` |
| **User action** | Use a lower reasoning setting or smaller model for routine deterministic edits. Reserve deeper reasoning for ambiguous or high-risk work. |

### EXCESSIVE_ASSISTANT_OUTPUT

| Field | Value |
| --- | --- |
| **Code** | `EXCESSIVE_ASSISTANT_OUTPUT` |
| **Description** | The latest assistant response exceeded the configured output budget. |
| **Severity** | `warning` |
| **Threshold** | `assistant output tokens > maxAssistantOutputTokens` (default 8,000) |
| **Evidence** | `outputTokens`, `budget` |
| **User action** | Request concise progress updates and cap model output where long prose is not part of the deliverable. In `enforce` mode, an output cap can be activated via `maxOutputTokens` configuration. |

### RETRY_WASTE

| Field | Value |
| --- | --- |
| **Code** | `RETRY_WASTE` |
| **Description** | Provider or tool retries are consuming repeated context and generation budget. |
| **Severity** | `warning` |
| **Threshold** | `retries >= 2` |
| **Evidence** | `retries` |
| **User action** | Resolve the first failure cause before continuing. After the first retry, inspect the error and change the request, model, limit, or tool arguments before another attempt. |

## Priority Scoring

Findings are ranked by a multiplicative formula:

```
score = severityWeight × confidenceFactor + savingsScore − riskPenalty
```

| Component | Values |
| --- | --- |
| `severityWeight` | `info` = 20, `warning` = 50, `critical` = 85 |
| `confidenceFactor` | `low` = 0.5, `medium` = 0.75, `high` = 1.0 |
| `savingsScore` | `min(15, log10(max(1, estimatedSavingsTokens)) × 4)`, rounded |
| `riskPenalty` | `low` = 0, `medium` = 4, `high` = 10 |

The final score is clamped to [0, 100]. Ties are broken first by estimated token savings (descending), then alphabetically by detection code. Scores are most differentiated at the extremes: `critical + high confidence` findings score 85-100, `warning + high confidence` score 50-65, and `info + high confidence` score 20-35.
