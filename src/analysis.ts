import type {
  AnalysisReport,
  AssistantUsage,
  Confidence,
  Finding,
  PatchProposal,
  Risk,
  SessionState,
  Severity,
  SpankNSaveConfig,
} from "./types.ts"

const severityWeight: Record<Severity, number> = { info: 20, warning: 60, critical: 90 }
const confidenceWeight: Record<Confidence, number> = { low: 5, medium: 12, high: 20 }
const riskPenalty: Record<Risk, number> = { low: 0, medium: 8, high: 18 }

const scoreFinding = (
  severity: Severity,
  confidence: Confidence,
  risk: Risk,
  estimatedSavingsTokens = 0,
): number => {
  const savingsScore = Math.min(25, Math.round(Math.log10(Math.max(1, estimatedSavingsTokens)) * 6))
  return Math.max(
    0,
    Math.min(100, severityWeight[severity] + confidenceWeight[confidence] + savingsScore - riskPenalty[risk]),
  )
}

const finding = (input: Omit<Finding, "priorityScore">): Finding => {
  const risk = input.proposedPatch?.risk ?? "low"
  return {
    ...input,
    priorityScore: scoreFinding(
      input.severity,
      input.confidence,
      risk,
      input.estimatedSavingsTokens,
    ),
  }
}

const totalTokens = (message: AssistantUsage): number =>
  message.input + message.output + message.reasoning + message.cacheRead + message.cacheWrite

const patch = (
  kind: PatchProposal["kind"],
  target: string,
  summary: string,
  change: string,
  risk: Risk,
  autoApplicable = false,
): PatchProposal => ({ kind, target, summary, change, risk, autoApplicable })

export const analyzeSession = (
  sessionID: string,
  state: SessionState,
  config: SpankNSaveConfig,
  toolSchemaTokensEstimate: number,
  version: string,
): AnalysisReport => {
  const messages = [...state.assistantMessages.values()].sort((a, b) => a.createdAt - b.createdAt)
  const latest = [...messages].reverse().find((message) => totalTokens(message) > 0)
  const findings: Finding[] = []

  const cumulative = messages.reduce(
    (sum, message) => ({
      input: sum.input + message.input,
      output: sum.output + message.output,
      reasoning: sum.reasoning + message.reasoning,
      cacheRead: sum.cacheRead + message.cacheRead,
      cacheWrite: sum.cacheWrite + message.cacheWrite,
      cost: sum.cost + message.cost,
    }),
    { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  )

  const latestTotal = latest ? totalTokens(latest) : 0
  const contextRatio = state.contextLimit ? latestTotal / state.contextLimit : undefined

  if (contextRatio !== undefined && contextRatio >= config.warningContextRatio) {
    const critical = contextRatio >= config.criticalContextRatio
    const savings = Math.round(latestTotal * (critical ? 0.45 : 0.3))
    findings.push(
      finding({
        severity: critical ? "critical" : "warning",
        code: "CONTEXT_PRESSURE",
        cause: "The active request is consuming a high percentage of the model context window.",
        confidence: "high",
        evidence: {
          latestContextTokens: latestTotal,
          contextLimit: state.contextLimit!,
          contextPercent: Math.round(contextRatio * 100),
        },
        estimatedSavingsTokens: savings,
        recommendation:
          "Compact completed work, preserve only active decisions and files, and move reusable procedures out of persistent context.",
        proposedPatch: patch(
          "compaction",
          "active OpenCode session",
          "Compact stale session context",
          "Run session compaction and retain the task, accepted decisions, active files, unresolved errors, and next actions only.",
          "medium",
        ),
      }),
    )
  }

  if (messages.length >= 2) {
    const previous = messages.at(-2)!
    const growth = latest ? latest.input - previous.input : 0
    if (growth > config.maxContextGrowthTokensPerTurn) {
      findings.push(
        finding({
          severity: "warning",
          code: "RAPID_CONTEXT_GROWTH",
          cause: "Input context expanded sharply between consecutive assistant turns.",
          confidence: "medium",
          evidence: {
            previousInputTokens: previous.input,
            latestInputTokens: latest?.input ?? 0,
            growthTokens: growth,
            budget: config.maxContextGrowthTokensPerTurn,
          },
          estimatedSavingsTokens: Math.max(0, growth - config.maxContextGrowthTokensPerTurn),
          recommendation:
            "Identify the newly introduced prompt, tool result, skill, or schema and replace it with a bounded summary or narrower query.",
          proposedPatch: patch(
            "workflow",
            "prompt and tool-result pipeline",
            "Bound one-turn context growth",
            `Keep incremental context growth below approximately ${config.maxContextGrowthTokensPerTurn} tokens unless the task explicitly requires bulk ingestion.`,
            "medium",
          ),
        }),
      )
    }
  }

  if (state.userPromptTokensEstimate > config.maxPromptTokens) {
    const savings = state.userPromptTokensEstimate - config.maxPromptTokens
    findings.push(
      finding({
        severity: "warning",
         code: "OVERSIZED_USER_PROMPT",
        cause: "The latest user prompt is larger than the configured prompt budget.",
        confidence: "medium",
        evidence: {
          promptTokensEstimate: state.userPromptTokensEstimate,
          budget: config.maxPromptTokens,
        },
        estimatedSavingsTokens: savings,
        recommendation:
          "Replace repeated background text with a concise task statement plus file references or an on-demand skill.",
        proposedPatch: patch(
          "prompt",
          ".opencode/skills/<domain>/SKILL.md",
          "Extract reusable prompt material",
          "Move stable procedures and examples into a narrowly described skill; keep live prompts task-specific.",
          "low",
        ),
      }),
    )
  }

  if (state.systemTokensEstimate > config.maxSystemTokens) {
    const savings = state.systemTokensEstimate - config.maxSystemTokens
    findings.push(
      finding({
        severity: "warning",
        code: "OVERSIZED_SYSTEM_CONTEXT",
        cause: "System instructions and persistent project rules exceed the configured budget.",
        confidence: "medium",
        evidence: {
          systemTokensEstimate: state.systemTokensEstimate,
          budget: config.maxSystemTokens,
        },
        estimatedSavingsTokens: savings,
        recommendation:
          "Deduplicate rules, remove redundant examples, and move specialized procedures into on-demand skills.",
        proposedPatch: patch(
          "prompt",
          "AGENTS.md and .opencode/skills/",
          "Split persistent and on-demand instructions",
          "Keep only project-wide invariants in AGENTS.md. Move task-specific workflows into focused SKILL.md files.",
          "medium",
        ),
      }),
    )
  }

  if (toolSchemaTokensEstimate > config.maxToolSchemaTokens) {
    const savings = toolSchemaTokensEstimate - config.maxToolSchemaTokens
    findings.push(
      finding({
        severity: "warning",
        code: "TOOL_SCHEMA_BLOAT",
        cause: "Enabled tool definitions consume a large estimated portion of every model request.",
        confidence: "medium",
        evidence: {
          toolSchemaTokensEstimate,
          budget: config.maxToolSchemaTokens,
        },
        estimatedSavingsTokens: savings,
        recommendation:
          "Disable unused MCP tool families globally and enable them only for agents that require them.",
        proposedPatch: patch(
          "configuration",
          "opencode.json",
          "Scope large tool families to specialized agents",
          '{\n  "tools": { "<large-prefix>_*": false },\n  "agent": { "<specialist>": { "tools": { "<large-prefix>_*": true } } }\n}',
          "low",
        ),
      }),
    )
  }

  const oversizedTools = state.tools
    .filter((tool) => tool.outputTokensEstimate > config.maxToolOutputTokens)
    .sort((a, b) => b.outputTokensEstimate - a.outputTokensEstimate)

  for (const tool of oversizedTools.slice(0, 3)) {
    findings.push(
      finding({
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
        proposedPatch: patch(
          "tooling",
          `.opencode/spank-n-save.json#maxToolOutputTokens`,
          `Bound '${tool.tool}' output`,
          `Set an appropriate output budget for '${tool.tool}' and prefer pagination, line ranges, or filtered commands.`,
          "low",
          config.mode === "enforce",
        ),
      }),
    )
  }

  const duplicateCounts = new Map<string, { count: number; tool: string; outputTokens: number }>()
  for (const tool of state.tools) {
    const key = `${tool.tool}:${tool.argsHash}`
    const current = duplicateCounts.get(key) ?? { count: 0, tool: tool.tool, outputTokens: 0 }
    current.count += 1
    current.outputTokens += tool.outputTokensEstimate
    duplicateCounts.set(key, current)
  }
  const duplicates = [...duplicateCounts.values()].filter(
    (entry) => entry.count >= config.duplicateToolCallThreshold,
  )
  if (duplicates.length > 0) {
    const duplicateWaste = duplicates.reduce(
      (sum, entry) => sum + Math.max(0, entry.outputTokens - entry.outputTokens / entry.count),
      0,
    )
    findings.push(
      finding({
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
        proposedPatch: patch(
          "workflow",
          "agent tool-use policy",
          "Avoid unchanged duplicate calls",
          "Before repeating an identical tool call, verify that its inputs or relevant repository state changed. Otherwise reuse the prior result.",
          "medium",
        ),
      }),
    )
  }

  if (latest) {
    const generated = latest.output + latest.reasoning
    const reasoningRatio = generated > 0 ? latest.reasoning / generated : 0
    if (latest.reasoning >= config.minReasoningTokens && reasoningRatio > config.maxReasoningRatio) {
      findings.push(
        finding({
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
          proposedPatch: patch(
            "configuration",
            "OpenCode agent/model configuration",
            "Route routine work to a lower-reasoning profile",
            "Create a focused routine-edit agent with a smaller model or lower reasoning level, while preserving the current profile for complex work.",
            "medium",
         ),
        }),
      )
    }

    if (latest.output > config.maxAssistantOutputTokens) {
      findings.push(
        finding({
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
          proposedPatch: patch(
            "configuration",
            ".opencode/spank-n-save.json#maxOutputTokens",
            "Cap generated output in enforce mode",
            `Set "maxOutputTokens" to ${config.maxAssistantOutputTokens} after confirming that this does not truncate required deliverables.`,
            "medium",
            config.mode === "enforce" && config.maxOutputTokens !== undefined,
          ),
        }),
      )
    }
  }

  if (state.retries >= 2) {
    findings.push(
      finding({
        severity: "warning",
        code: "RETRY_WASTE",
        cause: "Provider or tool retries are consuming repeated context and generation budget.",
        confidence: "medium",
        evidence: { retries: state.retries },
        recommendation:
          "Resolve the first failure cause before continuing; reduce oversized requests and validate provider or tool limits.",
        proposedPatch: patch(
          "workflow",
          "agent retry policy",
          "Diagnose before repeating",
          "After the first retry, inspect the error and change the request, model, limit, or tool arguments before another attempt.",
          "low",
        ),
      }),
    )
  }

  findings.sort((left, right) => {
    if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore
    return (right.estimatedSavingsTokens ?? 0) - (left.estimatedSavingsTokens ?? 0)
  })

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    plugin: { name: "SpankNSave", version, mode: config.mode },
    measurementPolicy: {
      authoritative: [
        "provider-reported input, output, reasoning, cache, and cost fields",
        "OpenCode model context limit",
      ],
      estimated: [
        "prompt component tokens",
        "system instruction tokens",
        "tool schema tokens",
        "tool output attribution",
        "potential token savings",
      ],
      rawContentPersisted: false,
    },
    summary: {
      sessionID,
      contextLimit: state.contextLimit,
      latestContextTokens: latestTotal,
      contextPercent: contextRatio === undefined ? undefined : Math.round(contextRatio * 100),
      cumulative,
      estimated: {
        latestPromptTokens: state.userPromptTokensEstimate,
        systemTokens: state.systemTokensEstimate,
        enabledToolSchemaTokens: toolSchemaTokensEstimate,
      },
      toolCalls: state.tools.length,
      retries: state.retries,
      compactions: state.compactions,
      filesChanged: state.filesChanged.size,
    },
    findings,
  }
}
