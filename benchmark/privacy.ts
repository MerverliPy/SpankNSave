import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SpankNSave } from "../src/plugin.ts"
import {
  mockEventMessageUpdated,
  mockEventSessionIdle,
  mockPluginInput,
  mockToolExecuteAfterInput,
  mockToolExecuteAfterOutput,
} from "../test/helpers.ts"

const sessionCount = Number.parseInt(process.env.PRIVACY_SESSION_COUNT ?? "50", 10)
if (!Number.isInteger(sessionCount) || sessionCount < 1 || sessionCount > 500) {
  throw new Error("PRIVACY_SESSION_COUNT must be an integer from 1 through 500")
}

const directory = await mkdtemp(join(tmpdir(), "spanksave-privacy-"))
const reportDirectory = join(directory, "reports")
const canaries: string[] = []

try {
  await mkdir(join(directory, ".opencode"), { recursive: true })
  await writeFile(
    join(directory, ".opencode", "spank-n-save.json"),
    JSON.stringify({
      mode: "suggest",
      notify: false,
      reportDirectory,
      maxReports: sessionCount + 10,
      maxToolObservationsPerSession: 20,
    }),
    "utf8",
  )

  const hooks = await SpankNSave(mockPluginInput({
    directory,
    worktree: directory,
    client: {
      app: { log: async () => undefined },
      tui: { showToast: async () => undefined },
    },
  }))

  for (let index = 0; index < sessionCount; index += 1) {
    const sessionID = `privacy-session-${index}`
    const values = {
      prompt: `CANARY_PROMPT_${index}_6f181dc0`,
      system: `CANARY_SYSTEM_${index}_b43b7461`,
      toolDescription: `CANARY_TOOL_DESCRIPTION_${index}_71ce084f`,
      toolSchema: `CANARY_TOOL_SCHEMA_${index}_09d52b30`,
      toolArgument: `CANARY_TOOL_ARGUMENT_${index}_bcfe0db2`,
      toolOutput: `CANARY_TOOL_OUTPUT_${index}_05b184e6`,
      messageID: `CANARY_MESSAGE_ID_${index}_43b84e95`,
      providerID: `CANARY_PROVIDER_${index}_a5acfd27`,
      modelID: `CANARY_MODEL_${index}_543d7e26`,
    }
    canaries.push(...Object.values(values))

    await hooks["chat.message"]?.(
      { sessionID } as never,
      {
        message: {},
        parts: [{ type: "text", text: values.prompt }],
      } as never,
    )

    await hooks["experimental.chat.system.transform"]?.(
      { sessionID } as never,
      { system: [values.system] } as never,
    )

    await hooks["tool.definition"]?.(
      { toolID: "bash" } as never,
      {
        description: values.toolDescription,
        parameters: { type: "object", secret: values.toolSchema },
      } as never,
    )

    await hooks["tool.execute.after"]?.(
      mockToolExecuteAfterInput({
        sessionID,
        callID: `call-${index}`,
        tool: "bash",
        args: { command: values.toolArgument },
      }),
      mockToolExecuteAfterOutput({ output: values.toolOutput }),
    )

    await hooks.event?.(
      mockEventMessageUpdated({
        id: values.messageID,
        sessionID,
        providerID: values.providerID,
        modelID: values.modelID,
        time: { created: index + 1 },
        cost: 0.01,
        tokens: {
          input: 9_000,
          output: 1_000,
          reasoning: 100,
          cache: { read: 0, write: 0 },
        },
      }),
    )

    await hooks.event?.(mockEventSessionIdle({ sessionID }))
  }

  await hooks.dispose?.()

  const filenames = (await readdir(reportDirectory)).filter((name) => name.endsWith(".json")).sort()
  const leaks: Array<{ filename: string; canary: string }> = []
  const modeFailures: Array<{ filename: string; mode: string }> = []

  for (const filename of filenames) {
    const path = join(reportDirectory, filename)
    const contents = await readFile(path, "utf8")
    for (const canary of canaries) {
      if (contents.includes(canary)) leaks.push({ filename, canary })
    }
    if (process.platform !== "win32") {
      const fileMode = (await stat(path)).mode & 0o777
      if (fileMode !== 0o600) modeFailures.push({ filename, mode: fileMode.toString(8) })
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    sessions: sessionCount,
    reportFiles: filenames.length,
    injectedCanaries: canaries.length,
    rawCanaryLeaks: leaks.length,
    permissionFailures: modeFailures.length,
    leaks,
    modeFailures,
  }

  const resultsDirectory = join(process.cwd(), "benchmark", "results")
  await mkdir(resultsDirectory, { recursive: true })
  await writeFile(join(resultsDirectory, "privacy.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8")

  const markdown = [
    "# Privacy regression benchmark",
    "",
    `Generated: ${result.generatedAt}`,
    "",
    `- Sessions: **${result.sessions}**`,
    `- Reports scanned: **${result.reportFiles}**`,
    `- Unique raw-content canaries injected: **${result.injectedCanaries}**`,
    `- Raw canary leaks: **${result.rawCanaryLeaks}**`,
    `- Report permission failures: **${result.permissionFailures}**`,
    "",
  ].join("\n")
  await writeFile(join(resultsDirectory, "privacy.md"), markdown, "utf8")
  console.log(markdown)

  if (leaks.length > 0 || modeFailures.length > 0 || filenames.length !== sessionCount) {
    process.exitCode = 1
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
