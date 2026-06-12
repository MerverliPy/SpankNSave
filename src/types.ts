export type Mode = "observe" | "suggest" | "enforce"
export type Severity = "info" | "warning" | "critical"
export type Risk = "low" | "medium" | "high"
export type Confidence = "low" | "medium" | "high"

export type SpankNSaveConfig = {
  enabled: boolean
  mode: Mode
  notify: boolean
  warningContextRatio: number
  criticalContextRatio: number
  maxToolOutputTokens: number
  maxPromptTokens: number
  maxSystemTokens: number
  maxToolSchemaTokens: numbr
  maxReasoningRatio: number
  minReasoningTokens: number
  maxAssistantOutputTokens: number
  maxContextGrowthTokensPerTurn: number
  duplicateToolCallThreshold: number
  maxToolObservationsPerSession: number
  maxOutputTokens?: number
  reportDirectory: string
  maxReports: number
  toastCooldownMs: number
  charsPerTokenEstimate: number
  truncationHeadRatio: number
  enforcementToolAllowlist: string[]
  enforcementToolDenylist: string[]
}

export type AssistantUsage = {
  id: string
  sessionID: string
  createdAt: number
  providerID: string
  modelID: string
  cost: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

export type ToolObservation = {
  callID: string
  tool: string
  argsHash: string
  outputChars: number
  outputTokensEstimate: number
  truncated: boolean
  observedAt: number
}

export type PatchProposal = {
  kind: "configuration" | "prompt" | "tooling" | "workflow" | "compaction"
  target: string
  summary: string
  change: string
  risk: Risk
  autoApplicable: boolean
}

export type Finding = {
  severity: Severity
  code: string
  cause: string
  confidence: Confidence
  evidence: Record<string, number | string | string[] | boolean>
  estimatedSavingsTokens?: number
  recommendation: string
  proposedPatch?: PatchProposal
  priorityScore: number
}

export type SessionState = {
  contextLimit?: number
  userPromptTokensEstimate: number
  systemTokensEstimate: number
  assistantMessages: Map<string, AssistantUsage>
  tools: ToolObservation[]
  retries: number
  compactions: number
  filesChanged: Set<string>
  lastToastAt: number
}

export type SessionSummary = {
  sessionID: string
  contextLimit?: number
  latestContextTokens: number
  contextPercent?: number
  cumulative: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
    cost: number
  }
  estimated: {
    latestPromptTokens: number
    systemTokens: number
    enabledToolSchemaTokens: number
  }
  toolCalls: number
  retries: number
  compactions: number
  filesChanged: number
}

export type AnalysisReport = {
  schemaVersion: 1
  generatedAt: string
  plugin: {
    name: "SpankNSave"
    version: string
    mode: Mode
  }
  measurementPolicy: {
    authoritative: string[]
    estimated: string[]
    rawContentPersisted: false
  }
  summary: SessionSummary
  findings: Finding[]
}
