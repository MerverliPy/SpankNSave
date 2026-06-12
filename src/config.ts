import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Mode, SpankNSaveConfig } from "./types.ts"

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

const finiteNumber = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, value))
}

const positiveInteger = (value: unknown, fallback: number, maximum = 10_000_000): number =>
  Math.floor(finiteNumber(value, fallback, 1, maximum))

const stringArray = (value: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(value)) return fallback
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))]
}

export const normalizeConfig = (value: unknown): SpankNSaveConfig => {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const mode = typeof source.mode === "string" && VALID_MODES.has(source.mode as Mode)
    ? (source.mode as Mode)
    : DEFAULT_CONFIG.mode

  const warningContextRatio = finiteNumber(
    source.warningContextRatio,
    DEFAULT_CONFIG.warningContextRatio,
    0.05,
    0.99,
  )
  const criticalContextRatio = finiteNumber(
    source.criticalContextRatio,
    DEFAULT_CONFIG.criticalContextRatio,
    warningContextRatio,
    1,
  )

  const maxOutputTokens = source.maxOutputTokens === undefined
    ? undefined
    : positiveInteger(source.maxOutputTokens, DEFAULT_CONFIG.maxAssistantOutputTokens)

  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_CONFIG.enabled,
    mode,
    notify: typeof source.notify === "boolean" ? source.notify : DEFAULT_CONFIG.notify,
    warningContextRatio,
    criticalContextRatio,
    maxToolOutputTokens: positiveInteger(source.maxToolOutputTokens, DEFAULT_CONFIG.maxToolOutputTokens),
    maxPromptTokens: positiveInteger(source.maxPromptTokens, DEFAULT_CONFIG.maxPromptTokens),
    maxSystemTokens: positiveInteger(source.maxSystemTokens, DEFAULT_CONFIG.maxSystemTokens),
    maxToolSchemaTokens: positiveInteger(source.maxToolSchemaTokens, DEFAULT_CONFIG.maxToolSchemaTokens),
    maxReasoningRatio: finiteNumber(source.maxReasoningRatio, DEFAULT_CONFIG.maxReasoningRatio, 0.05, 1),
    minReasoningTokens: positiveInteger(source.minReasoningTokens, DEFAULT_CONFIG.minReasoningTokens),
    maxAssistantOutputTokens: positiveInteger(
      source.maxAssistantOutputTokens,
      DEFAULT_CONFIG.maxAssistantOutputTokens,
    ),
    maxContextGrowthTokensPerTurn: positiveInteger(
      source.maxContextGrowthTokensPerTurn,
      DEFAULT_CONFIG.maxContextGrowthTokensPerTurn,
    ),
    duplicateToolCallThreshold: Math.max(
      2,
      positiveInteger(
        source.duplicateToolCallThreshold,
        DEFAULT_CONFIG.duplicateToolCallThreshold,
        100,
      ),
    ),
    maxToolObservationsPerSession: positiveInteger(
      source.maxToolObservationsPerSession,
      DEFAULT_CONFIG.maxToolObservationsPerSession,
      100_000,
    ),
    maxOutputTokens,
    reportDirectory:
      typeof source.reportDirectory === "string" && source.reportDirectory.trim()
        ? source.reportDirectory.trim()
        : DEFAULT_CONFIG.reportDirectory,
    maxReports: positiveInteger(source.maxReports, DEFAULT_CONFIG.maxReports, 100_000),
    toastCooldownMs: positiveInteger(source.toastCooldownMs, DEFAULT_CONFIG.toastCooldownMs, 86_400_000),
    charsPerTokenEstimate: finiteNumber(
      source.charsPerTokenEstimate,
      DEFAULT_CONFIG.charsPerTokenEstimate,
      1,
      12,
    ),
    truncationHeadRatio: finiteNumber(
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
    if (code === "ENOENT") return undefined
    throw new Error(`Unable to read SpankNSave configuration at ${path}: ${(error as Error).message}`)
  }
}

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

export const shouldEnforceTool = (tool: string, config: SpankNSaveConfig): boolean => {
  if (config.enforcementToolDenylist.includes(tool)) return false
  if (config.enforcementToolAllowlist.length === 0) return true
  return config.enforcementToolAllowlist.includes(tool)
}
