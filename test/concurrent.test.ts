import assert from "node:assert/strict"
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import { SpankNSave } from "../src/plugin.ts"

/**
 * P3-20: Concurrent session stress tests
 *
 * The plugin's internal `states` OrderedMap is shared across all async hook
 * handlers.  JavaScript is single-threaded, so true parallelism does not
 * exist — but interleaving at `await` points can still cause races.
 *
 * The primary concurrency concern is in the `session.idle`, `session.deleted`,
 * and `dispose` handlers because they call `persistReport()`, an async
 * function that `await`s file I/O (`writeReport`, `pruneReports`).  During
 * those awaits other handlers (chat.message, tool.execute.after, etc.) may
 * mutate the shared session state.
 *
 * Handlers like `chat.message` and `tool.execute.after` have **no** internal
 * `await` points — they run synchronously to completion even though they are
 * declared `async`.  Their state mutations are therefore atomic within a
 * single microtask and pose no real interleaving risk.
 */

describe("P3-20: Concurrent session stress", () => {
  it("state survives concurrent idle + chat.message on same session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "concurrent-"))
    await mkdir(join(directory, ".opencode"), { recursive: true })
    await writeFile(
      join(directory, ".opencode", "spank-n-save.json"),
      JSON.stringify({
        mode: "suggest",
        reportDirectory: join(directory, "reports"),
      }),
    )

    const hooks = await SpankNSave({
      directory,
      client: {
        app: { log: async () => undefined },
        tui: { showToast: async () => undefined },
      },
    } as never)

    // Pre-populate session so idle has data to persist
    await hooks.event?.({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "m1",
            sessionID: "cs1",
            role: "assistant",
            time: { created: 1 },
            providerID: "p",
            modelID: "m",
            cost: 0.1,
            tokens: {
              input: 100,
              output: 50,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        },
      },
    } as never)

    // Fire session.idle (which awaits writeReport inside persistReport)
    // and chat.message concurrently.  During the fs-write await,
    // chat.message can mutate the same session's state on the event loop.
    await Promise.all([
      hooks.event?.({
        event: {
          type: "session.idle",
          properties: { sessionID: "cs1" },
        },
      } as never),
      hooks["chat.message"]?.(
        { sessionID: "cs1" } as never,
        {
          parts: [{ type: "text", text: "Hello from concurrent chat" }],
        } as never,
      ),
    ])

    // No crash → PASS.  Verify a report was persisted (the idle handler
    // writes before returning).  The report may reflect state from before
    // chat.message ran because analyzeSession() executes before the await
    // in persistReport — this is expected eventual-consistency behavior,
    // not a bug.
    const reportPath = join(directory, "reports", "spanknsave-cs1.json")
    const report = JSON.parse(await readFile(reportPath, "utf8"))
    assert.equal(report.summary.sessionID, "cs1")
  })

  it("tool.execute.after respect cap under concurrent Promise.all", async () => {
    const directory = await mkdtemp(join(tmpdir(), "concurrent-"))
    await mkdir(join(directory, ".opencode"), { recursive: true })
    await writeFile(
      join(directory, ".opencode", "spank-n-save.json"),
      JSON.stringify({
        mode: "suggest",
        maxToolObservationsPerSession: 4,
        reportDirectory: join(directory, "reports"),
      }),
    )

    const hooks = await SpankNSave({
      directory,
      client: {
        app: { log: async () => undefined },
        tui: { showToast: async () => undefined },
      },
    } as never)

    // The tool.execute.after handler contains zero `await` expressions, so
    // all 5 calls execute synchronously within a single microtask.
    // State mutations are therefore always atomic.  This test confirms the
    // cap (maxToolObservationsPerSession) is correctly applied even when
    // many calls are fired "concurrently" via Promise.all.
    await Promise.all([
      hooks["tool.execute.after"]?.(
        { sessionID: "cs2", callID: "c1", tool: "bash", args: { cmd: "a" } } as never,
        { output: "r1", title: "", metadata: {} } as never,
      ),
      hooks["tool.execute.after"]?.(
        { sessionID: "cs2", callID: "c2", tool: "bash", args: { cmd: "b" } } as never,
        { output: "r2", title: "", metadata: {} } as never,
      ),
      hooks["tool.execute.after"]?.(
        { sessionID: "cs2", callID: "c3", tool: "read", args: { path: "c" } } as never,
        { output: "r3", title: "", metadata: {} } as never,
      ),
      hooks["tool.execute.after"]?.(
        { sessionID: "cs2", callID: "c4", tool: "read", args: { path: "d" } } as never,
        { output: "r4", title: "", metadata: {} } as never,
      ),
      hooks["tool.execute.after"]?.(
        { sessionID: "cs2", callID: "c5", tool: "grep", args: { pat: "e" } } as never,
        { output: "r5", title: "", metadata: {} } as never,
      ),
    ])

    // Persist and inspect the toolCalls count via the report
    await hooks.event?.({
      event: {
        type: "session.idle",
        properties: { sessionID: "cs2" },
      },
    } as never)

    const reportPath = join(directory, "reports", "spanknsave-cs2.json")
    const report = JSON.parse(await readFile(reportPath, "utf8"))

    // maxToolObservationsPerSession=4, 5 calls fired — cap keeps oldest 4
    assert.equal(report.summary.toolCalls, 4)
  })

  it("dispose + concurrent message.updated does not crash", async () => {
    const directory = await mkdtemp(join(tmpdir(), "concurrent-"))
    await mkdir(join(directory, ".opencode"), { recursive: true })
    await writeFile(
      join(directory, ".opencode", "spank-n-save.json"),
      JSON.stringify({
        mode: "suggest",
        reportDirectory: join(directory, "reports"),
      }),
    )

    const hooks = await SpankNSave({
      directory,
      client: {
        app: { log: async () => undefined },
        tui: { showToast: async () => undefined },
      },
    } as never)

    // Pre-populate a session so dispose has work to do
    await hooks.event?.({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "m1",
            sessionID: "cs3",
            role: "assistant",
            time: { created: 1 },
            providerID: "p",
            modelID: "m",
            cost: 0,
            tokens: {
              input: 200,
              output: 100,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        },
      },
    } as never)

    // Fire dispose and message.updated concurrently.
    // dispose iterates sessions and await-s inside persistReport.
    // During those awaits message.updated may add a new message to the
    // same session.  After the loop, dispose clears all state.
    await Promise.all([
      hooks.dispose?.(),
      hooks.event?.({
        event: {
          type: "message.updated",
          properties: {
            info: {
              id: "m2",
              sessionID: "cs3",
              role: "assistant",
              time: { created: 2 },
              providerID: "p",
              modelID: "m",
              cost: 0,
              tokens: {
                input: 50,
                output: 25,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          },
        },
      } as never),
    ])

    // A report should have been persisted for cs3
    const entries = await readdir(join(directory, "reports"))
    const reports = entries.filter(
      (n) => n.startsWith("spanknsave-") && n.endsWith(".json"),
    )
    assert.ok(reports.length >= 1)

    // Second dispose is safe (state already cleared)
    await assert.doesNotReject(() => hooks.dispose?.() as Promise<unknown>)
  })

  it("rapid sequential operations maintain consistent state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "concurrent-"))
    await mkdir(join(directory, ".opencode"), { recursive: true })
    await writeFile(
      join(directory, ".opencode", "spank-n-save.json"),
      JSON.stringify({
        mode: "suggest",
        reportDirectory: join(directory, "reports"),
      }),
    )

    const hooks = await SpankNSave({
      directory,
      client: {
        app: { log: async () => undefined },
        tui: { showToast: async () => undefined },
      },
    } as never)

    const sid = "rapid-seq"

    // Burst of different event types on the same session
    await hooks.event?.({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "m1",
            sessionID: sid,
            role: "assistant",
            time: { created: 1 },
            providerID: "p",
            modelID: "m",
            cost: 0,
            tokens: {
              input: 100,
              output: 50,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        },
      },
    } as never)

    await hooks["tool.execute.after"]?.(
      { sessionID: sid, callID: "c1", tool: "bash", args: { cmd: "x" } } as never,
      { output: "ok", title: "", metadata: {} } as never,
    )

    await hooks.event?.({
      event: { type: "session.idle", properties: { sessionID: sid } },
    } as never)

    // After idle the session is still tracked (under the LRU cap of 50);
    // additional events must not crash.
    await hooks.event?.({
      event: {
        type: "message.part.updated",
        properties: { part: { type: "retry", sessionID: sid } },
      },
    } as never)

    await hooks["tool.execute.after"]?.(
      { sessionID: sid, callID: "c2", tool: "bash", args: { cmd: "y" } } as never,
      { output: "ok2", title: "", metadata: {} } as never,
    )

    // Persist final state and verify accumulated counters
    await hooks.event?.({
      event: { type: "session.idle", properties: { sessionID: sid } },
    } as never)

    const reportPath = join(directory, "reports", `spanknsave-${sid}.json`)
    const report = JSON.parse(await readFile(reportPath, "utf8"))
    assert.equal(report.summary.toolCalls, 2)
    assert.equal(report.summary.retries, 1)
  })

  it("concurrent session.deleted + chat.message does not crash", async () => {
    const directory = await mkdtemp(join(tmpdir(), "concurrent-"))
    await mkdir(join(directory, ".opencode"), { recursive: true })
    await writeFile(
      join(directory, ".opencode", "spank-n-save.json"),
      JSON.stringify({
        mode: "suggest",
        reportDirectory: join(directory, "reports"),
      }),
    )

    const hooks = await SpankNSave({
      directory,
      client: {
        app: { log: async () => undefined },
        tui: { showToast: async () => undefined },
      },
    } as never)

    // Pre-populate
    await hooks.event?.({
      event: {
        type: "message.updated",
        properties: {
          info: {
            id: "mx",
            sessionID: "cs4",
            role: "assistant",
            time: { created: 1 },
            providerID: "p",
            modelID: "m",
            cost: 0,
            tokens: {
              input: 300,
              output: 150,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        },
      },
    } as never)

    // session.deleted calls persistReport (which awaits writeReport),
    // then deletes the state.  chat.message may try to re-create it
    // concurrently.  The system must not crash.
    await Promise.all([
      hooks.event?.({
        event: {
          type: "session.deleted",
          properties: { info: { id: "cs4" } },
        },
      } as never),
      hooks["chat.message"]?.(
        { sessionID: "cs4" } as never,
        {
          parts: [{ type: "text", text: "After delete" }],
        } as never,
      ),
    ])

    // Verify deletion-persist report exists
    const entries = await readdir(join(directory, "reports"))
    const reports = entries.filter(
      (n) => n.startsWith("spanknsave-cs4") && n.endsWith(".json"),
    )
    assert.equal(reports.length, 1)

    // Idle after deletion should not crash (state may or may not exist
    // depending on whether chat.message re-created it)
    await hooks.event?.({
      event: {
        type: "session.idle",
        properties: { sessionID: "cs4" },
      },
    } as never)
  })
})
