import { createHash } from "node:crypto"

export const estimateTokens = (text: string, charsPerToken = 4): number => {
  if (!text) return 0
  const divisor = Number.isFinite(charsPerToken) && charsPerToken > 0 ? charsPerToken : 4
  return Math.ceil(text.length / divisor)
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    )
  }
  return value
}

export const stableHash = (value: unknown): string => {
  let serialized: string
  try {
    serialized = JSON.stringify(canonicalize(value))
  } catch {
    serialized = String(value)
  }
  return createHash("sha256").update(serialized).digest("hex").slice(0, 16)
}

export const safeFilename = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "unknown-session"

export const truncateMiddle = (
  text: string,
  maximumTokens: number,
  charsPerToken = 4,
  headRatio = 0.7,
): { text: string; truncated: boolean; originalTokensEstimate: number } => {
  const originalTokensEstimate = estimateTokens(text, charsPerToken)
  if (originalTokensEstimate <= maximumTokens) {
    return { text, truncated: false, originalTokensEstimate }
  }

  const maxChars = Math.max(256, Math.floor(maximumTokens * charsPerToken))
  const clampedRatio = Math.min(0.9, Math.max(0.1, headRatio))
  const marker =
    "\n\n[SpankNSave truncated the middle of this tool result. Narrow the query or request a smaller range.]\n\n"
  const contentBudget = Math.max(64, maxChars - marker.length)
  const headChars = Math.floor(contentBudget * clampedRatio)
  const tailChars = contentBudget - headChars

  return {
    text: `${text.slice(0, headChars)}${marker}${text.slice(-tailChars)}`,
    truncated: true,
    originalTokensEstimate,
  }
}
