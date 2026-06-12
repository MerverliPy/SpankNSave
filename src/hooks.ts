import type { Hooks } from "@opencode-ai/plugin"
import type { AssistantMessage, Part } from "@opencode-ai/sdk"
import type { AssistantUsage, SessionState, SpankNSaveConfig } from "./types.ts"
import type { OrderedMap } from "./ordered-map.ts"
import { MAX_ASSISTANT_MESSAGES } from "./state.ts"

const normalizeAssistantMessage = (message: AssistantMessage): AssistantUsage => ({
  id: message.id,
  sessionID: message.sessionID,
  createdAt: message.time.created,
  providerID: message.providerID,
  modelID: message.modelID,
  cost: message.cost,
  input: message.tokens.input,
  output: message.tokens.output,
  reasoning: message.tokens.reasoning,
  cacheRead: message.tokens.cache.read,
  cacheWrite: message.tokens.cache.write,
})

const textTokenEstimate = (parts: Part[], charsPerToken: number, estimateTokens: (text: string, charsPerToken: number) => number): number =>
  parts.reduce(
    (sum, part) =>
      sum +
      (part.type === "text" && "text" in part
        ? estimateTokens(part.text, charsPerToken)
        : 0),
    0,
  )

type Deps = {
  states: OrderedMap<string, SessionState>
  config: SpankNSaveConfig
  toolSchemaEstimates: Map<string, number>
  getState: (states: OrderedMap<string, SessionState>, sessionID: string) => SessionState
  persistReport: (sessionID: string) => Promise<void>
  evictLRU: () => Promise<void>
  estimateTokens: (text: string, charsPerToken: number) => number
  stableHash: (value: unknown) => string
  truncateMiddle: (text: string, maxTokens: number, charsPerToken: number, headRatio: number) => { text: string; truncated: boolean }
  shouldEnforceTool: (tool: string, config: SpankNSaveConfig) => boolean
}

export const createHooks = (
  deps: Deps,
): Pick<Hooks, "chat.message" | "chat.params" | "experimental.chat.system.transform" | "tool.definition" | "tool.execute.after" | "event" | "dispose"> => {
  const { states, config, toolSchemaEstimates, getState, persistReport, evictLRU, estimateTokens, stableHash, truncateMiddle, shouldEnforceTool } = deps

  return {
    "chat.message": async (input, output) => {
      const state = getState(states, input.sessionID)
      state.userTextPromptTokensEstimate = textTokenEstimate(
        output.parts,
        config.charsPerTokenEstimate,
        estimateTokens,
      )
    },

    "chat.params": async (input, output) => {
      const state = getState(states, input.sessionID)
      state.contextLimit = input.model.limit?.context

      if (config.mode === "enforce" && config.maxOutputTokens !== undefined) {
        output.maxOutputTokens = Math.min(
          output.maxOutputTokens ?? config.maxOutputTokens,
          config.maxOutputTokens,
        )
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) return
      const state = getState(states, input.sessionID)
      state.systemTokensEstimate = output.system.reduce(
        (sum, value) => sum + estimateTokens(value, config.charsPerTokenEstimate),
        0,
      )
    },

    "tool.definition": async (input, output) => {
      let parameters: string
      try {
        parameters = JSON.stringify(output.parameters)
      } catch {
        parameters = String(output.parameters)
      }
      toolSchemaEstimates.set(
        input.toolID,
        estimateTokens(`${output.description ?? ""}\n${parameters}`, config.charsPerTokenEstimate),
      )
    },

    "tool.execute.after": async (input, output) => {
      const state = getState(states, input.sessionID)
      const originalOutput = typeof output.output === "string" ? output.output : ""
      const originalTokensEstimate = estimateTokens(originalOutput, config.charsPerTokenEstimate)
      let truncated = false

      if (
        config.mode === "enforce" &&
        shouldEnforceTool(input.tool, config) &&
        originalTokensEstimate > config.maxToolOutputTokens
      ) {
        const result = truncateMiddle(
          originalOutput,
          config.maxToolOutputTokens,
          config.charsPerTokenEstimate,
          config.truncationHeadRatio,
        )
        output.output = result.text
        truncated = result.truncated
      }

      state.tools.push({
        callID: input.callID,
        tool: input.tool,
        argsHash: stableHash(input.args),
        outputChars: originalOutput.length,
        outputTokensEstimate: originalTokensEstimate,
        truncated,
        observedAt: Date.now(),
      })

      if (state.tools.length > config.maxToolObservationsPerSession) {
        state.tools.splice(0, state.tools.length - config.maxToolObservationsPerSession)
      }
    },

    event: async ({ event }) => {
      if (event.type === "message.updated") {
        const message = event.properties.info
        if (message.role === "assistant") {
          const state = getState(states, message.sessionID)
          state.assistantMessages.set(
            message.id,
            normalizeAssistantMessage(message),
          )
          // Cap retained messages: only keep the most recent entries.
          if (state.assistantMessages.size > MAX_ASSISTANT_MESSAGES) {
            let oldestId: string | undefined
            let oldestTime = Infinity
            for (const [id, msg] of state.assistantMessages) {
              if (msg.createdAt < oldestTime) { oldestTime = msg.createdAt; oldestId = id }
            }
            if (oldestId !== undefined) state.assistantMessages.delete(oldestId)
          }
        }
        return
      }

      if (event.type === "message.removed") {
        states.get(event.properties.sessionID)?.assistantMessages.delete(event.properties.messageID)
        return
      }

      if (event.type === "message.part.updated") {
        const part = event.properties.part
        if (part.type === "retry") getState(states, part.sessionID).retries += 1
        return
      }

      if (event.type === "session.diff") {
        const state = getState(states, event.properties.sessionID)
        state.filesChangedCount += event.properties.diff.length
        return
      }

      if (event.type === "session.compacted") {
        getState(states, event.properties.sessionID).compactions += 1
        return
      }

      if (event.type === "session.idle") {
        await persistReport(event.properties.sessionID)
        await evictLRU()
        return
      }

      if (event.type === "session.deleted") {
        try {
          await persistReport(event.properties.info.id)
        } catch {
          console.warn("[spank-n-save] persist-before-delete failed")
          // Fail-open: persist failure must not prevent cleanup.
        }
        states.delete(event.properties.info.id)
      }
    },

    dispose: async () => {
      for (const sessionID of states.keys()) await persistReport(sessionID)
      states.clear()
      toolSchemaEstimates.clear()
    },
  }
}
