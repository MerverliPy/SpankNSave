import assert from "node:assert/strict"
import test from "node:test"
import { estimateTokens, stableHash, truncateMiddle } from "../src/estimation.ts"

test("estimateTokens uses the configured character ratio", () => {
  assert.equal(estimateTokens("12345678", 4), 2)
  assert.equal(estimateTokens("", 4), 0)
})

test("stableHash ignores object key order", () => {
  assert.equal(stableHash({ a: 1, b: 2 }), stableHash({ b: 2, a: 1 }))
  assert.notEqual(stableHash({ a: 1 }), stableHash({ a: 2 }))
})

test("truncateMiddle preserves the beginning and tail", () => {
  const source = `HEAD-${"x".repeat(2000)}-TAIL`
  const result = truncateMiddle(source, 100, 4, 0.7)

  assert.equal(result.truncated, true)
  assert.match(result.text, /^HEAD-/)
  assert.match(result.text, /-TAIL$/)
  assert.match(result.text, /SpankNSave truncated/)
})
