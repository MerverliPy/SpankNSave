import assert from "node:assert/strict"
import test from "node:test"
import { DEFAULT_CONFIG, normalizeConfig, shouldEnforceTool } from "../src/config.ts"

test("normalizes configuration", () => {
  const config = normalizeConfig({ mode: "invalid", warningContextRatio: -5, charsPerTokenEstimate: 100 })
  assert.equal(config.mode, "suggest")
  assert.equal(config.warningContextRatio, 0.05)
  assert.equal(config.charsPerTokenEstimate, 12)
})

test("denylist takes precedence", () => {
  const config = { ...DEFAULT_CONFIG, enforcementToolAllowlist: ["bash", "read"], enforcementToolDenylist: ["read"] }
  assert.equal(shouldEnforceTool("bash", config), true)
  assert.equal(shouldEnforceTool("read", config), false)
})
