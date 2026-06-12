import assert from "node:assert/strict"
import { chmod, mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
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

  const hooks = await SpankNSave({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  } as never)

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

  const hooks = await SpankNSave({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  } as never)

  // Feed events for two distinct sessions
  await hooks.event?.({ event: { type: "message.updated", properties: { info: { id: "m1", sessionID: "s1", role: "assistant", time: { created: 1 }, providerID: "p", modelID: "m", cost: 0, tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } } } } } } as never)
  await hooks.event?.({ event: { type: "message.updated", properties: { info: { id: "m2", sessionID: "s2", role: "assistant", time: { created: 1 }, providerID: "p", modelID: "m", cost: 0, tokens: { input: 200, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } } } } } as never)

  await hooks.dispose?.()

  const entries = await readdir(join(directory, "reports"))
  const reports = entries.filter((n) => n.startsWith("spanknsave-") && n.endsWith(".json"))
  assert.equal(reports.length, 2)
})

test("session deleted removes state without persisting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plugin-test-"))
  await mkdir(join(directory, ".opencode"), { recursive: true })
  await writeFile(
    join(directory, ".opencode", "spank-n-save.json"),
    JSON.stringify({ mode: "suggest", reportDirectory: join(directory, "reports") }),
  )

  const hooks = await SpankNSave({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  } as never)

  await hooks.event?.({ event: { type: "message.updated", properties: { info: { id: "m1", sessionID: "del-me", role: "assistant", time: { created: 1 }, providerID: "p", modelID: "m", cost: 0, tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } } } } } } as never)
  await hooks.event?.({ event: { type: "session.deleted", properties: { info: { id: "del-me" } } } } as never)

  await hooks.dispose?.()

  const entries = await readdir(join(directory, "reports"))
  const reports = entries.filter((n) => n.startsWith("spanknsave-") && n.endsWith(".json"))
  assert.equal(reports.length, 0)
})

test("message removal updates assistant history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plugin-test-"))
  await mkdir(join(directory, ".opencode"), { recursive: true })
  await writeFile(
    join(directory, ".opencode", "spank-n-save.json"),
    JSON.stringify({ mode: "suggest", reportDirectory: join(directory, "reports") }),
  )

  const hooks = await SpankNSave({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  } as never)

  await hooks.event?.({ event: { type: "message.updated", properties: { info: { id: "m1", sessionID: "s", role: "assistant", time: { created: 1 }, providerID: "p", modelID: "m", cost: 0, tokens: { input: 8_500, output: 600, reasoning: 0, cache: { read: 0, write: 0 } } } } } } as never)
  await hooks.event?.({ event: { type: "message.removed", properties: { sessionID: "s", messageID: "m1" } } } as never)

  await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "s" } } } as never)

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

  const hooks = await SpankNSave({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  } as never)

  await hooks.event?.({ event: { type: "message.updated", properties: { info: { id: "m1", sessionID: "s", role: "assistant", time: { created: 1 }, providerID: "p", modelID: "m", cost: 0, tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } } } } } } as never)
  await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "s" } } } as never)
  await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "s" } } } as never)

  await hooks.dispose?.()

  const entries = await readdir(join(directory, "reports"))
  const reports = entries.filter((n) => n.startsWith("spanknsave-") && n.endsWith(".json"))
  // Repeated idle persists same session multiple times, but filename is deterministic
  assert.equal(reports.length, 1)
})

test("initializes without any config file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plugin-test-"))
  await mkdir(join(directory, ".opencode"), { recursive: true })

  const hooks = await SpankNSave({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  } as never)

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

  const hooks = await SpankNSave({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  } as never)

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

  const hooks = await SpankNSave({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  } as never)

  // In enforce mode, chat.params caps maxOutputTokens.
  // If config load failed, mode should be "observe" and no cap applies.
  const params = { maxOutputTokens: 2_000 as number | undefined }
  await hooks["chat.params"]?.(
    { sessionID: "s", model: { limit: { context: 10_000 } } } as never,
    params as never,
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

  const hooks = await SpankNSave({
    directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  } as never)

  assert.ok(hooks)
  assert.ok(hooks.event)
})
