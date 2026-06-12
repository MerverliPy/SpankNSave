import type { SessionState } from "./types.ts"
import { OrderedMap } from "./ordered-map.ts"

export const MAX_TRACKED_SESSIONS = 50
export const MAX_ASSISTANT_MESSAGES = 2

export const getState = (states: OrderedMap<string, SessionState>, sessionID: string): SessionState => {
  const existing = states.get(sessionID)
  if (existing) {
    existing.lastActivityAt = Date.now()
    states.moveToEnd(sessionID)
    return existing
  }

  const created: SessionState = {
    userTextPromptTokensEstimate: 0,
    systemTokensEstimate: 0,
    assistantMessages: new Map(),
    tools: [],
    retries: 0,
    compactions: 0,
    filesChangedCount: 0,
    lastToastAt: 0,
    lastActivityAt: Date.now(),
  }
  states.set(sessionID, created)
  return created
}
