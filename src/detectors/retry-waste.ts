import type { Finding } from "../types.ts"
import { createFinding, makePatch } from "./helpers.ts"

export const detectRetryWaste = (retries: number): Finding | null => {
  if (retries < 2) return null

  return createFinding({
    severity: "warning",
    code: "RETRY_WASTE",
    cause: "Provider or tool retries are consuming repeated context and generation budget.",
    confidence: "medium",
    evidence: { retries },
    recommendation:
      "Resolve the first failure cause before continuing; reduce oversized requests and validate provider or tool limits.",
    proposedPatch: makePatch(
      "workflow",
      "agent retry policy",
      "Diagnose before repeating",
      "After the first retry, inspect the error and change the request, model, limit, or tool arguments before another attempt.",
      "low",
    ),
  })
}
