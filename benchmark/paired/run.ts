import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { safeFilename } from "../../src/estimation.ts"

type Task = {
  id: string
  baseRef: string
  prompt: string
  verifyCommand: string
  setupCommand?: string
  prepareCommand?: string
  treatmentSetupCommand?: string
  timeoutSeconds?: number
  treatmentMode?: "observe" | "suggest" | "enforce"
  treatmentConfig?: Record<string, unknown>
  predictionConfig?: Record<string, unknown>
  expectedFindingCodes?: string[]
  savingsFindingCodes?: string[]
}

type Condition = "baseline" | "prediction" | "treatment"

type CommandResult = {
  status: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
}

const command = (
  executable: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): CommandResult => {
  const started = process.hrtime.bigint()
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: options.timeoutMs,
    maxBuffer: 100 * 1024 * 1024,
  })
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut: Boolean(result.error && "code" in result.error && result.error.code === "ETIMEDOUT"),
    durationMs,
  }
}

const shell = (script: string, cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): CommandResult =>
  command("bash", ["-lc", script], { cwd, env, timeoutMs })

const requireSuccess = (result: CommandResult, description: string): void => {
  if (result.status !== 0) {
    throw new Error(`${description} failed (status ${result.status}, signal ${result.signal ?? "none"})\n${result.stderr}\n${result.stdout}`)
  }
}

const parseOpenCode = (stdout: string) => {
  const totals = {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
  }
  let sessionID: string | undefined
  let stepFinishes = 0
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    let event: Record<string, unknown>
    try {
      event = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (typeof event.sessionID === "string") sessionID ??= event.sessionID
    if (event.type !== "step_finish") continue
    const part = event.part as Record<string, unknown> | undefined
    const tokens = part?.tokens as Record<string, unknown> | undefined
    const cache = tokens?.cache as Record<string, unknown> | undefined
    const number = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0
    totals.input += number(tokens?.input)
    totals.output += number(tokens?.output)
    totals.reasoning += number(tokens?.reasoning)
    totals.cacheRead += number(cache?.read)
    totals.cacheWrite += number(cache?.write)
    totals.cost += number(part?.cost)
    stepFinishes += 1
  }
  return {
    sessionID,
    stepFinishes,
    ...totals,
    totalTokens: totals.input + totals.output + totals.reasoning + totals.cacheRead + totals.cacheWrite,
  }
}

const repositoryRoot = process.cwd()
const targetRepository = resolve(process.env.TARGET_REPO ?? repositoryRoot)
const model = process.env.OPENCODE_MODEL?.trim()
if (!model) throw new Error("Set OPENCODE_MODEL to an exact `provider/model` identifier.")
if (!existsSync(join(targetRepository, ".git"))) {
  throw new Error(`TARGET_REPO must be a Git clone with a .git entry: ${targetRepository}`)
}

const repetitions = Number.parseInt(process.env.PAIRED_REPETITIONS ?? "3", 10)
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 30) {
  throw new Error("PAIRED_REPETITIONS must be an integer from 1 through 30.")
}

const taskPathInput = process.env.PAIRED_TASK_FILE ?? "benchmark/paired/tasks.json"
const taskPath = isAbsolute(taskPathInput) ? taskPathInput : join(repositoryRoot, taskPathInput)
const tasks = JSON.parse(await readFile(taskPath, "utf8")) as Task[]
if (!Array.isArray(tasks) || tasks.length === 0) throw new Error("The paired task file must contain a non-empty JSON array.")

const opencodeVersion = command("opencode", ["--version"])
requireSuccess(opencodeVersion, "opencode --version")
const gitVersion = command("git", ["--version"])
requireSuccess(gitVersion, "git --version")

const runID = process.env.PAIRED_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, "-")
const resultsDirectory = join(repositoryRoot, "benchmark", "results")
await mkdir(resultsDirectory, { recursive: true })
const outputPath = join(resultsDirectory, `paired-runs-${safeFilename(runID)}.jsonl`)
await writeFile(outputPath, "", "utf8")

const build = command("npm", ["run", "build"], { cwd: repositoryRoot, timeoutMs: 10 * 60 * 1000 })
requireSuccess(build, "SpankNSave build")

const baseEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  TARGET_REPO: targetRepository,
  OPENCODE_DISABLE_AUTOUPDATE: "true",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
  OPENCODE_PERMISSION: process.env.OPENCODE_PERMISSION ?? JSON.stringify({
    bash: "allow",
    read: "allow",
    edit: "allow",
    glob: "allow",
    grep: "allow",
    task: "allow",
    todowrite: "allow",
    webfetch: "deny",
    websearch: "deny",
    question: "deny",
  }),
}

const writeResult = async (value: Record<string, unknown>): Promise<void> => {
  const prior = await readFile(outputPath, "utf8")
  await writeFile(outputPath, `${prior}${JSON.stringify(value)}\n`, "utf8")
}

const runCondition = async (task: Task, repetition: number, condition: Condition) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), `spanksave-${safeFilename(task.id)}-${condition}-`))
  const worktree = join(temporaryRoot, "worktree")
  const configDirectory = join(temporaryRoot, "opencode-config")
  await mkdir(configDirectory, { recursive: true })
  await writeFile(join(configDirectory, "opencode.json"), "{}\n", "utf8")

  const env = { ...baseEnvironment, OPENCODE_CONFIG_DIR: configDirectory }
  let worktreeAdded = false
  try {
    const addWorktree = command("git", ["-C", targetRepository, "worktree", "add", "--detach", worktree, task.baseRef], { timeoutMs: 2 * 60 * 1000 })
    requireSuccess(addWorktree, `Add worktree for ${task.id}`)
    worktreeAdded = true

    await rm(join(worktree, ".opencode", "plugins"), { recursive: true, force: true })
    await rm(join(worktree, ".opencode", "spank-n-save"), { recursive: true, force: true })
    await rm(join(worktree, ".opencode", "spank-n-save.json"), { force: true })

    if (task.setupCommand) requireSuccess(shell(task.setupCommand, worktree, env, 5 * 60 * 1000), `${task.id} setup`)
    if (task.prepareCommand) requireSuccess(shell(task.prepareCommand, worktree, env, 20 * 60 * 1000), `${task.id} prepare`)

    if (condition !== "baseline") {
      const install = command("npm", ["run", "install:local", "--", worktree], { cwd: repositoryRoot, timeoutMs: 2 * 60 * 1000 })
      requireSuccess(install, `${task.id} plugin installation`)
      const config = {
        mode: condition === "prediction" ? "observe" : (task.treatmentMode ?? "enforce"),
        notify: false,
        reportDirectory: ".opencode/spank-n-save/reports",
        maxReports: 1000,
        ...(task.treatmentConfig ?? {}),
        ...(condition === "prediction" ? (task.predictionConfig ?? {}) : {}),
      }
      await writeFile(join(worktree, ".opencode", "spank-n-save.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8")
      if (condition === "treatment" && task.treatmentSetupCommand) {
        requireSuccess(shell(task.treatmentSetupCommand, worktree, env, 5 * 60 * 1000), `${task.id} treatment setup`)
      }
    }

    const title = `spanksave-benchmark-${safeFilename(runID)}-${safeFilename(task.id)}-${repetition}-${condition}`
    const args = [
      ...(condition === "baseline" ? ["--pure"] : []),
      "run",
      "--dir", worktree,
      "--model", model,
      "--format", "json",
      "--title", title,
      "--dangerously-skip-permissions",
    ]
    if (process.env.OPENCODE_VARIANT) args.push("--variant", process.env.OPENCODE_VARIANT)
    args.push(task.prompt)

    const timeoutMs = (task.timeoutSeconds ?? 1200) * 1000
    const openCodeResult = command("opencode", args, { cwd: worktree, env, timeoutMs })
    const usage = parseOpenCode(openCodeResult.stdout)
    const verification = shell(task.verifyCommand, worktree, env, timeoutMs)
    const diff = command("git", ["-C", worktree, "diff", "--stat"])

    let report: Record<string, unknown> | undefined
    if (condition !== "baseline" && usage.sessionID) {
      const reportPath = join(
        worktree,
        ".opencode",
        "spank-n-save",
        "reports",
        `spanknsave-${safeFilename(usage.sessionID)}.json`,
      )
      if (existsSync(reportPath)) report = JSON.parse(await readFile(reportPath, "utf8")) as Record<string, unknown>
    }

    const findings = Array.isArray(report?.findings) ? report.findings as Array<Record<string, unknown>> : []
    const findingCodes = findings.map((finding) => String(finding.code)).sort()
    const estimatedSavingsTokensAll = findings.reduce(
      (sum, finding) => sum + (typeof finding.estimatedSavingsTokens === "number" ? finding.estimatedSavingsTokens : 0),
      0,
    )
    const savingsFindingCodes = task.savingsFindingCodes ?? []
    const estimatedSavingsTokens = findings
      .filter((finding) => savingsFindingCodes.includes(String(finding.code)))
      .reduce(
        (sum, finding) => sum + (typeof finding.estimatedSavingsTokens === "number" ? finding.estimatedSavingsTokens : 0),
        0,
      )

    return {
      runID,
      taskID: task.id,
      repetition,
      condition,
      baseRef: task.baseRef,
      model,
      variant: process.env.OPENCODE_VARIANT ?? null,
      opencodeVersion: opencodeVersion.stdout.trim() || opencodeVersion.stderr.trim(),
      pluginCommit: command("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }).stdout.trim() || null,
      targetCommit: command("git", ["-C", targetRepository, "rev-parse", task.baseRef]).stdout.trim() || null,
      openCodeExitStatus: openCodeResult.status,
      openCodeSignal: openCodeResult.signal,
      openCodeTimedOut: openCodeResult.timedOut,
      wallTimeMs: openCodeResult.durationMs,
      verificationExitStatus: verification.status,
      success: openCodeResult.status === 0 && !openCodeResult.timedOut && verification.status === 0,
      usage,
      findingCodes,
      expectedFindingCodes: task.expectedFindingCodes ?? [],
      savingsFindingCodes,
      estimatedSavingsTokens,
      estimatedSavingsTokensAll,
      diffStat: diff.stdout.trim(),
      stderrBytes: Buffer.byteLength(openCodeResult.stderr, "utf8"),
      stderrSha256: createHash("sha256").update(openCodeResult.stderr).digest("hex"),
      collectedAt: new Date().toISOString(),
    }
  } finally {
    if (worktreeAdded) command("git", ["-C", targetRepository, "worktree", "remove", "--force", worktree], { timeoutMs: 2 * 60 * 1000 })
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

for (const task of tasks) {
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    const conditions: Condition[] = ["baseline", "prediction", "treatment"]
    const offset = (repetition + task.id.length) % conditions.length
    const order = [...conditions.slice(offset), ...conditions.slice(0, offset)]
    for (const condition of order) {
      console.log(`[${task.id}] repetition ${repetition}/${repetitions}: ${condition}`)
      try {
        const result = await runCondition(task, repetition, condition)
        await writeResult(result)
        console.log(`  success=${result.success} tokens=${result.usage.totalTokens} cost=${result.usage.cost}`)
      } catch (error) {
        const failure = {
          runID,
          taskID: task.id,
          repetition,
          condition,
          infrastructureFailure: true,
          error: error instanceof Error ? error.message : String(error),
          collectedAt: new Date().toISOString(),
        }
        await writeResult(failure)
        console.error(failure.error)
      }
    }
  }
}

console.log(`Paired raw results: ${outputPath}`)
