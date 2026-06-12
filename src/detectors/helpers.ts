import type { Confidence, Finding, PatchProposal, Risk, Severity } from "../types.ts"

const severityWeight: Record<Severity, number> = { info: 20, warning: 50, critical: 85 }
const confidenceFactor: Record<Confidence, number> = { low: 0.5, medium: 0.75, high: 1.0 }
const riskPenalty: Record<Risk, number> = { low: 0, medium: 4, high: 10 }

/**
 * Computes a priority score (0–100) from severity, confidence, savings, and risk.
 */
export const scoreFinding = (
  severity: Severity,
  confidence: Confidence,
  risk: Risk,
  estimatedSavingsTokens = 0,
): number => {
  const base = severityWeight[severity] * confidenceFactor[confidence]
  const savingsScore = Math.min(15, Math.round(Math.log10(Math.max(1, estimatedSavingsTokens)) * 4))
  return Math.round(Math.max(0, Math.min(100, base + savingsScore - riskPenalty[risk])))
}

/**
 * Builds a typed PatchProposal.
 */
export const makePatch = (
  kind: PatchProposal["kind"],
  target: string,
  summary: string,
  change: string,
  risk: Risk,
  autoApplicable = false,
): PatchProposal => ({ kind, target, summary, change, risk, autoApplicable })

/**
 * Creates a Finding, computing its priorityScore via scoreFinding.
 * The patch's risk defaults to "low" if not provided and no patch is given.
 */
export const createFinding = (input: Omit<Finding, "priorityScore">): Finding => {
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
