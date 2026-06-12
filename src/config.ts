import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Mode, SpankNSaveConfig } from "./types.ts"

/** Default configuration values used when no user config file is present. */
export const DEFAULT_CONFIG: SpankNSaveConfig = {
  enabled: true,
  mode: "suggest",
  notify: true,
  warningContextRatio: 0.7,
  criticalContextRatio: 0.85,
  maxToolOutputTokens: 6_000,
  maxPromptTokens: 4_000,
  maxSystemTokens: 8_000,
  maxToolSchemaTokens: 5_000,
  maxReasoningRatio: 0.55,
  minReasoningTokens: 4_000,
  maxAssistantOutputTokens: 8_000,
  maxContextGrowthTokensPerTurn: 12_000,
  duplicateToolCallThreshold: 2,
  maxToolObservationsPerSession: 1_000,
  maxOutputTokens: undefined,
  reportDirectory: ".opencode/spank-n-save/reports",
  maxReports: 100,
  toastCooldownMs: 30_000,
  charsPerTokenEstimate: 4,
  truncationHeadRatio: 0.7,
  enforcementToolAllowlist: [],
  enforcementToolDenylist: [],
}

const VALID_MODES = new Set<Mode>(["observe", "suggest", "enforce"])

const PRE = "[spank-n-save]"

const finiteNumber = (
  key: string,
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    if (value !== undefined && value !== null) {
      console.warn(`${PRE} ${key}: invalid value, using default ${fallback}`)
    }
    return fallback
  }
  const clamped = Math.min(maximum, Math.max(minimum, value))
  if (clamped !== value) {
    console.warn(`${PRE} ${key}: ${value} clamped to ${clamped}`)
  }
  return clamped
}

const positiveInteger = (key: string, value: unknown, fallback: number, maximum = 10_000_000): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    if (value !== undefined && value !== null) {
      console.warn(`${PRE} ${key}: invalid value, using default ${fallback}`)
    }
    return fallback
  }
  const raw = value as number
  const clamped = Math.floor(Math.min(maximum, Math.max(1, raw)))
  if (clamped !== raw || Math.floor(raw) !== raw) {
    console.warn(`${PRE} ${key}: ${raw} clamped to ${clamped}`)
  }
  return clamped
}

const stringArray = (value: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(value)) return fallback
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))]
}

/**
 * Normalizes and validates a raw configuration value into a SpankNSaveConfig.
 * Missing or invalid fields fall back to DEFAULT_CONFIG with console warnings.
 * @param value - Raw config value (parsed JSON or unknown).
 * @returns A validated SpankNSaveConfig with all fields populated.
 */
export const normalizeConfig = (value: unknown): SpankNSaveConfig => {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const mode = typeof source.mode === "string" && VALID_MODES.has(source.mode as Mode)
    ? (source.mode as Mode)
    : DEFAULT_CONFIG.mode

  const warningContextRatio = finiteNumber(
    "warningContextRatio",
    source.warningContextRatio,
    DEFAULT_CONFIG.warningContextRatio,
    0.05,
    0.99,
  )
  const criticalContextRatio = finiteNumber(
    "criticalContextRatio",
    source.criticalContextRatio,
    DEFAULT_CONFIG.criticalContextRatio,
    warningContextRatio,
    1,
  )

  const maxOutputTokens = source.maxOutputTokens === undefined
    ? undefined
    : positiveInteger("maxOutputTokens", source.maxOutputTokens, DEFAULT_CONFIG.maxAssistantOutputTokens)

  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_CONFIG.enabled,
    mode,
    notify: typeof source.notify === "boolean" ? source.notify : DEFAULT_CONFIG.notify,
    warningContextRatio,
    criticalContextRatio,
    maxToolOutputTokens: positiveInteger("maxToolOutputTokens", source.maxToolOutputTokens, DEFAULT_CONFIG.maxToolOutputTokens),
    maxPromptTokens: positiveInteger("maxPromptTokens", source.maxPromptTokens, DEFAULT_CONFIG.maxPromptTokens),
    maxSystemTokens: positiveInteger("maxSystemTokens", source.maxSystemTokens, DEFAULT_CONFIG.maxSystemTokens),
    maxToolSchemaTokens: positiveInteger("maxToolSchemaTokens", source.maxToolSchemaTokens, DEFAULT_CONFIG.maxToolSchemaTokens),
    maxReasoningRatio: finiteNumber("maxReasoningRatio", source.maxReasoningRatio, DEFAULT_CONFIG.maxReasoningRatio, 0.05, 1),
    minReasoningTokens: positiveInteger("minReasoningTokens", source.minReasoningTokens, DEFAULT_CONFIG.minReasoningTokens),
    maxAssistantOutputTokens: positiveInteger(
      "maxAssistantOutputTokens",
      source.maxAssistantOutputTokens,
      DEFAULT_CONFIG.maxAssistantOutputTokens,
    ),
    maxContextGrowthTokensPerTurn: positiveInteger(
      "maxContextGrowthTokensPerTurn",
      source.maxContextGrowthTokensPerTurn,
      DEFAULT_CONFIG.maxContextGrowthTokensPerTurn,
    ),
    duplicateToolCallThreshold: Math.max(
      2,
      positiveInteger(
        "duplicateToolCallThreshold",
        source.duplicateToolCallThreshold,
        DEFAULT_CONFIG.duplicateToolCallThreshold,
        100,
      ),
    ),
    maxToolObservationsPerSession: positiveInteger(
      "maxToolObservationsPerSession",
      source.maxToolObservationsPerSession,
      DEFAULT_CONFIG.maxToolObservationsPerSession,
      100_000,
    ),
    maxOutputTokens,
    reportDirectory:
      typeof source.reportDirectory === "string" && source.reportDirectory.trim()
        ? source.reportDirectory.trim()
        : DEFAULT_CONFIG.reportDirectory,
    maxReports: positiveInteger("maxReports", source.maxReports, DEFAULT_CONFIG.maxReports, 100_000),
    toastCooldownMs: positiveInteger("toastCooldownMs", source.toastCooldownMs, DEFAULT_CONFIG.toastCooldownMs, 86_400_000),
    charsPerTokenEstimate: finiteNumber(
      "charsPerTokenEstimate",
      source.charsPerTokenEstimate,
      DEFAULT_CONFIG.charsPerTokenEstimate,
      1,
      12,
    ),
    truncationHeadRatio: finiteNumber(
      "truncationHeadRatio",
      source.truncationHeadRatio,
      DEFAULT_CONFIG.truncationHeadRatio,
      0.1,
      0.9,
    ),
    enforcementToolAllowlist: stringArray(
      source.enforcementToolAllowlist,
      DEFAULT_CONFIG.enforcementToolAllowlist,
    ),
    enforcementToolDenylist: stringArray(
      source.enforcementToolDenylist,
      DEFAULT_CONFIG.enforcementToolDenylist,
    ),
  }
}

const readJson = async (path: string): Promise<unknown | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8"))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "EACCES" || code === "EPERM") return undefined
    if (error instanceof SyntaxError) return undefined
    throw new Error(`Unable to read SpankNSave configuration at ${path}: ${(error as Error).message}`)
  }
}

/**
 * Loads and validates plugin configuration from a directory.
 * Reads .opencode/spank-n-save.json first, then falls back to legacy .opencode/token-guard.json.
 * Returns DEFAULT_CONFIG if neither file exists or is unreadable.
 * @param directory - Project root directory.
 * @returns Resolved config, file path, and optional legacy migration source.
 * @throws If the config file exists but cannot be parsed due to a non-recoverable filesystem error.
 */
export const loadConfig = async (
  directory: string,
): Promise<{ config: SpankNSaveConfig; path: string; migratedFrom?: string }> => {
  const preferredPath = join(directory, ".opencode", "spank-n-save.json")
  const legacyPath = join(directory, ".opencode", "token-guard.json")

  const preferred = await readJson(preferredPath)
  if (preferred !== undefined) return { config: normalizeConfig(preferred), path: preferredPath }

  const legacy = await readJson(legacyPath)
  if (legacy !== undefined) {
    return { config: normalizeConfig(legacy), path: preferredPath, migratedFrom: legacyPath }
  }

  return { config: DEFAULT_CONFIG, path: preferredPath }
}

/**
 * Checks whether a tool should be enforced based on allowlist/denylist configuration.
 * Denylist takes precedence; if allowlist is empty, all tools are enforced.
 * @param tool - Tool name to check.
 * @param config - Resolved plugin configuration.
 * @returns true if the tool should be enforced.
 */
export const shouldEnforceTool = (tool: string, config: SpankNSaveConfig): boolean => {
  if (config.enforcementToolDenylist.includes(tool)) return false
  if (config.enforcementToolAllowlist.length === 0) return true
  return config.enforcementToolAllowlist.includes(tool)
}
