import { createHash } from "node:crypto"

/**
 * Estimates token count from character length using a configurable ratio.
 * @param text - Input text to estimate.
 * @param charsPerToken - Estimated characters per token (default 4).
 * @returns Estimated token count (always ≥ 0).
 */
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

/**
 * Creates a stable SHA-256-based hash for deduplication via canonical JSON serialization.
 * Unserializable values produce a marker hash rather than silently colliding.
 * @param value - Any value to hash.
 * @returns 16-character hex digest of the SHA-256 hash.
 */
export const stableHash = (value: unknown): string => {
  let serialized: string
  try {
    serialized = JSON.stringify(canonicalize(value))
  } catch {
    serialized = "[unhashable]"
  }
  return createHash("sha256").update(serialized).digest("hex").slice(0, 16)
}

/**
 * Sanitizes a string for use as a filename, replacing unsafe characters with underscores.
 * Dots are stripped to prevent path traversal.
 * @param value - Raw string to sanitize.
 * @returns Safe filename string (≤ 180 chars, or "unknown-session" if empty).
 */
export const safeFilename = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180) || "unknown-session"

/**
 * Truncates text preserving head and tail with a marker inserted in the middle.
 * @param text - Full text to potentially truncate.
 * @param maximumTokens - Token budget for the result.
 * @param charsPerToken - Estimated characters per token (default 4).
 * @param headRatio - Proportion of content budget allocated to head (default 0.7, clamped 0.1–0.9).
 * @returns Object with truncated text, whether truncation occurred, and original token estimate.
 */
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

  const maxChars = Math.floor(maximumTokens * charsPerToken)
  const clampedRatio = Math.min(0.9, Math.max(0.1, headRatio))
  const marker =
    "\n\n[SpankNSave truncated the middle of this tool result. Narrow the query or request a smaller range.]\n\n"
  const contentBudget = maxChars - marker.length
  if (contentBudget < 1) {
    return { text: marker.trim(), truncated: true, originalTokensEstimate }
  }
  const headChars = Math.floor(contentBudget * clampedRatio)
  const tailChars = contentBudget - headChars

  return {
    text: `${text.slice(0, headChars)}${marker}${text.slice(-tailChars)}`,
    truncated: true,
    originalTokensEstimate,
  }
}
