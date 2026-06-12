import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { SpankNSave } from "../src/plugin.ts"

test("writes a sanitized report and enforces caps", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plugin-test-"))
  await mkdir(join(directory, ".opencode"), { recursive: true })
  await writeFile(
    join(directory, ".opencode", "spank-n-save.json"),
    JSON.stringify({
      mode: "enforce",
      maxToolOutputTokens: 100,
      maxOutputTokens: 500,
      reportDirectory: ".opencode/spank-n-save/reports",
    }),
  )

  const hooks = await SpankNSave({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  } as never)

  const params = { maxOutputTokens: undefined as number | undefined }
  await hooks["chat.params"]?.(
    { sessionID: "test-session", model: { limit: { context: 10_000 } } } as never,
    params as never,
  )
  assert.equal(params.maxOutputTokens, 500)

  const output = { output: `HEAD-${"x".repeat(2_000)}-TAIL`, title: "test", metadata: {} }
  await hooks["tool.execute.after"]?.(
    { sessionID: "test-session", callID: "one", tool: "bash", args: { command: "private-value" } } as never,
    output as never,
  )
  assert.ok(output.output.length < 2_000)

  await hooks.event?.({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "m1",
          sessionID: "test-session",
          role: "assistant",
          time: { created: 1 },
          providerID: "p",
          modelID: "m",
          cost: 0.1,
          tokens: {
            input: 8_500,
            output: 600,
            reasoning: 100,
            cache: { read: 0, write: 0 },
          },
        },
      },
    },
  } as never)
  await hooks.event?.({
    event: { type: "session.idle", properties: { sessionID: "test-session" } },
  } as never)

  const reportText = await readFile(
    join(directory, ".opencode", "spank-n-save", "reports", "test-session.json"),
    "utf8",
  )
  assert.equal(reportText.includes("private-value"), false)
  assert.equal(JSON.parse(reportText).measurementPolicy.rawContentPersisted, false)
})
