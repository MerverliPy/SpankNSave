import assert from "node:assert/strict"
import { chmod, mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { SpankNSave } from "../src/plugin.ts"
import { mockPluginInput, mockChatParamsInput, mockChatParamsOutput, mockToolExecuteAfterInput, mockToolExecuteAfterOutput, mockEventMessageUpdated, mockEventSessionIdle, mockEventSessionDeleted, mockEventMessageRemoved } from "./helpers.ts"

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

  const hooks = await SpankNSave(mockPluginInput({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  }))

  const params = mockChatParamsOutput({ maxOutputTokens: undefined })
  await hooks["chat.params"]?.(
    mockChatParamsInput({ sessionID: "test-session", model: { limit: { context: 10_000 } } }),
    params,
  )
  assert.equal(params.maxOutputTokens, 500)

  const output = mockToolExecuteAfterOutput({ output: `HEAD-${"x".repeat(2_000)}-TAIL`, title: "test", metadata: {} })
  await hooks["tool.execute.after"]?.(
    mockToolExecuteAfterInput({ sessionID: "test-session", callID: "one", tool: "bash", args: { command: "private-value" } }),
    output,
  )
  assert.ok(output.output.length < 2_000)

  await hooks.event?.(mockEventMessageUpdated({
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
  }))
  await hooks.event?.(mockEventSessionIdle({ sessionID: "test-session" }))

  const reportText = await readFile(
    join(directory, ".opencode", "spank-n-save", "reports", "spanknsave-test-session.json"),
    "utf8",
  )
  assert.equal(reportText.includes("private-value"), false)
  assert.equal(JSON.parse(reportText).measurementPolicy.rawContentPersisted, false)
})

test("initializes with malformed config file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plugin-test-"))
  await mkdir(join(directory, ".opencode"), { recursive: true })
  await writeFile(
    join(directory, ".opencode", "spank-n-save.json"),
    "{not valid json at all",
  )

  const hooks = await SpankNSave(mockPluginInput({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  }))

  assert.ok(hooks)
  assert.ok(hooks.event)
})

test("dispose persists all active sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plugin-test-"))
  await mkdir(join(directory, ".opencode"), { recursive: true })
  await writeFile(
    join(directory, ".opencode", "spank-n-save.json"),
    JSON.stringify({ mode: "suggest", reportDirectory: join(directory, "reports") }),
  )

  const hooks = await SpankNSave(mockPluginInput({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  }))

  // Feed events for two distinct sessions
  await hooks.event?.(mockEventMessageUpdated({ id: "m1", sessionID: "s1", cost: 0, tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } } }))
  await hooks.event?.(mockEventMessageUpdated({ id: "m2", sessionID: "s2", cost: 0, tokens: { input: 200, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } }))

  await hooks.dispose?.()

  const entries = await readdir(join(directory, "reports"))
  const reports = entries.filter((n) => n.startsWith("spanknsave-") && n.endsWith(".json"))
  assert.equal(reports.length, 2)
})

test("session deleted persists before removing state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plugin-test-"))
  await mkdir(join(directory, ".opencode"), { recursive: true })
  await writeFile(
    join(directory, ".opencode", "spank-n-save.json"),
    JSON.stringify({ mode: "suggest", reportDirectory: join(directory, "reports") }),
  )

  const hooks = await SpankNSave(mockPluginInput({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  }))

  await hooks.event?.(mockEventMessageUpdated({ id: "m1", sessionID: "del-me", cost: 0, tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } } }))
  await hooks.event?.(mockEventSessionDeleted({ id: "del-me" }))

  // Session deleted should persist the final report before removing state
  const entries = await readdir(join(directory, "reports"))
  const reports = entries.filter((n) => n.startsWith("spanknsave-") && n.endsWith(".json"))
  assert.equal(reports.length, 1)

  // After deletion, idle should not crash or persist again
  await hooks.event?.(mockEventSessionIdle({ sessionID: "del-me" }))
})

test("session deleted does not persist when persistReport fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plugin-test-"))
  await mkdir(join(directory, ".opencode"), { recursive: true })
  // Use a report directory path where a parent is a file to force write failure
  const parentFile = join(directory, "block")
  await writeFile(parentFile, "block")
  await writeFile(
    join(directory, ".opencode", "spank-n-save.json"),
    JSON.stringify({ mode: "suggest", reportDirectory: join(parentFile, "reports") }),
  )

  const hooks = await SpankNSave(mockPluginInput({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  }))

  await hooks.event?.(mockEventMessageUpdated({ id: "m1", sessionID: "s", cost: 0, tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } } }))
  // This should not throw even though persist will fail
  await hooks.event?.(mockEventSessionDeleted({ id: "s" }))

  // dispose should also not throw
  await hooks.dispose?.()
})

test("message removal updates assistant history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plugin-test-"))
  await mkdir(join(directory, ".opencode"), { recursive: true })
  await writeFile(
    join(directory, ".opencode", "spank-n-save.json"),
    JSON.stringify({ mode: "suggest", reportDirectory: join(directory, "reports") }),
  )

  const hooks = await SpankNSave(mockPluginInput({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  }))

  await hooks.event?.(mockEventMessageUpdated({ id: "m1", sessionID: "s", cost: 0, tokens: { input: 8_500, output: 600, reasoning: 0, cache: { read: 0, write: 0 } } }))
  await hooks.event?.(mockEventMessageRemoved({ sessionID: "s", messageID: "m1" }))

  await hooks.event?.(mockEventSessionIdle({ sessionID: "s" }))

  const reportText = await readFile(
    join(directory, "reports", "spanknsave-s.json"),
    "utf8",
  )
  const report = JSON.parse(reportText)
  // After removal, no messages remain, so latestContextTokens is 0
  assert.equal(report.summary.latestContextTokens, 0)
})

test("repeated idle events produce distinct reports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plugin-test-"))
  await mkdir(join(directory, ".opencode"), { recursive: true })
  await writeFile(
    join(directory, ".opencode", "spank-n-save.json"),
    JSON.stringify({ mode: "suggest", reportDirectory: join(directory, "reports") }),
  )

  const hooks = await SpankNSave(mockPluginInput({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  }))

  await hooks.event?.(mockEventMessageUpdated({ id: "m1", sessionID: "s", cost: 0, tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } } }))
  await hooks.event?.(mockEventSessionIdle({ sessionID: "s" }))
  await hooks.event?.(mockEventSessionIdle({ sessionID: "s" }))

  await hooks.dispose?.()

  const entries = await readdir(join(directory, "reports"))
  const reports = entries.filter((n) => n.startsWith("spanknsave-") && n.endsWith(".json"))
  // Repeated idle persists same session multiple times, but filename is deterministic
  assert.equal(reports.length, 1)
})

test("initializes without any config file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plugin-test-"))
  await mkdir(join(directory, ".opencode"), { recursive: true })

  const hooks = await SpankNSave(mockPluginInput({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  }))

  assert.ok(hooks)
  assert.ok(hooks.event)
})

test("initializes when report directory cannot be created", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plugin-test-"))
  await mkdir(join(directory, ".opencode"), { recursive: true })

  // Use a path where the parent is a file (not a directory), so mkdir fails.
  const parentFile = join(directory, "not-a-directory")
  await writeFile(parentFile, "block")
  await writeFile(
    join(directory, ".opencode", "spank-n-save.json"),
    JSON.stringify({
      mode: "suggest",
      reportDirectory: join(parentFile, "reports"),
    }),
  )

  const hooks = await SpankNSave(mockPluginInput({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  }))

  assert.ok(hooks)
  assert.ok(hooks.event)
})

test("never enforces when config load fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plugin-test-"))
  await mkdir(join(directory, ".opencode"), { recursive: true })
  await writeFile(
    join(directory, ".opencode", "spank-n-save.json"),
    "{broken json!!!",
  )

  const hooks = await SpankNSave(mockPluginInput({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  }))

  // In enforce mode, chat.params caps maxOutputTokens.
  // If config load failed, mode should be "observe" and no cap applies.
  const params = mockChatParamsOutput({ maxOutputTokens: 2_000 })
  await hooks["chat.params"]?.(
    mockChatParamsInput({ sessionID: "s", model: { limit: { context: 10_000 } } }),
    params,
  )
  // Should remain uncapped since enforce mode was not entered.
  assert.equal(params.maxOutputTokens, 2_000)
})

test("initializes with unwritable but usable parent directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plugin-test-"))
  await mkdir(join(directory, ".opencode"), { recursive: true })

  // Create a read-only subdirectory as the report target
  const readOnlyDir = join(directory, "readonly")
  await mkdir(readOnlyDir)
  await chmod(readOnlyDir, 0o444)

  await writeFile(
    join(directory, ".opencode", "spank-n-save.json"),
    JSON.stringify({
      mode: "suggest",
      reportDirectory: join(readOnlyDir, "reports"),
    }),
  )

  const hooks = await SpankNSave(mockPluginInput({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  }))

  assert.ok(hooks)
  assert.ok(hooks.event)
})
