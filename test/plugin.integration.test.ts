import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { SpankNSave } from "../src/plugin.ts"

test("plugin writes a sanitized report and enforces configured tool limits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "spank-n-save-"))
  await mkdir(join(directory, ".opencode"), { recursive: true })
  await writeFile(
    join(directory, ".opencode", "spank-n-save.json"),
    JSON.stringify({
      mode: "enforce",
      notify: true,
      maxToolOutputTokens: 100,
      maxOutputTokens: 500,
      reportDirectory: ".opencode/spank-n-save/reports",
    }),
  )

  const toasts: unknown[] = []
  const logs: unknown[] = []
  const hooks = await SpankNSave({
    directory,
    client: {
      app: { log: async (value: unknown) => void logs.push(value) },
      tui: { showToast: async (value: unknown) => void toasts.push(value) },
    },
  } as never)

  const params = { maxOutputTokens: undefined as number | undefined }
  await hooks["chat.params"]?.(
    { sessionID: "session/test", model: { limit: { context: 10_000 } } } as never,
    params as never,
  )
  assert.equal(params.maxOutputTokens, 500)

  const toolOutput = { output: `BEGIN-${"x".repeat(2_000)}-END`, title: "synthetic", metadata: {} }
  await hooks["tool.execute.after"]?.(
    { sessionID: "session/test", callID: "call-1", tool: "bash", args: { command: "synthetic" } },
    toolOutput,
  )
  assert.match(toolOutput.output, /^BEGIN-/)
  assert.match(toolOutput.output, /-END$/)
  assert.match(toolOutput.output, /SpankNSave truncated/)

  await hooks.event?.({
    eventèì(€€€€€ÑåÁ”è€‰µ•ÍÍ…”¹ÕÁ‘…Ñ•ˆ°(€€€€€ÁÉ½Á•ÉÑ¥•Ìèì(€€€€€€€¥¹™¼èì(€€€€€€€€€¥è€‰µ•ÍÍ…”´Äˆ°(€€€€€€€€€Í•ÍÍ¥½¹%è€‰Í•ÍÍ¥½¸½Ñ•ÍÐˆ°(€€€€€€€€€É½±”è€‰…ÍÍ¥ÍÑ…¹Ðˆ°(€€€€€€€€€Ñ¥µ”èìÉ•…Ñ•è€Äô°(€€€€€€€€€ÁÉ½Ù¥‘•É%è€‰ÁÉ½Ù¥‘•Èˆ°(€€€€€€€€€µ½‘•±%è€‰µ½‘•°ˆ°(€€€€€€€€€½ÍÐè€À¸ÈÔ°(€€€€€€€€€Ñ½­•¹Ìèì(€€€€€€€€€€€¥¹ÁÕÐè€á|ÔÀÀ°(€€€€€€€€€€€½ÕÑÁÕÐè€ØÀÀ°(€€€€€€€€€€€É•…Í½¹¥¹œè€ÄÀÀ°(€€€€€€€€€€€…¡”èìÉ•…è€À°ÝÉ¥Ñ”è€Àô°(€€€€€€€€€ô°(€€€€€€€ô°(€€€€€ô°(€€€ô°(€ô…Ì¹•Ù•È¤(€…Ý…¥Ð¡½½­Ì¹•Ù•¹Ðü¸¡ì•Ù•¹ÐèìÑåÁ”è€‰Í•ÍÍ¥½¸¹¥‘±”ˆ°ÁÉ½Á•ÉÑ¥•ÌèìÍ•ÍÍ¥½¹%è€‰Í•ÍÍ¥½¸½Ñ•ÍÐˆôôô…Ì¹•Ù•È¤((€½¹ÍÐÉ•Á½ÉÑA…Ñ €ô©½¥¸¡‘¥É•Ñ½Éä°€ˆ¹½Á•¹½‘”ˆ°€‰ÍÁ…¹¬µ¸µÍ…Ù”ˆ°€‰É•Á½ÉÑÌˆ°€‰Í•ÍÍ¥½¹}Ñ•ÍÐ¹©Í½¸ˆ¤(€½¹ÍÐÉ•Á½ÉÐ€ô)M=8¹Á…ÉÍ”¡…Ý…¥ÐÉ•…‘¥±”¡É•Á½ÉÑA…Ñ °€‰ÕÑ˜àˆ¤¤((€…ÍÍ•ÉÐ¹•ÅÕ…°¡É•Á½ÉÐ¹µ•…ÍÕÉ•µ•¹ÑA½±¥ä¹É…Ý½¹Ñ•¹ÑA•ÉÍ¥ÍÑ•°™…±Í”¤(€…ÍÍ•ÉÐ¹•ÅÕ…°¡É•Á½ÉÐ¹ÍÕµµ…Éä¹Í•ÍÍ¥½¹%°€‰Í•ÍÍ¥½¸½Ñ•ÍÐˆ¤(€…ÍÍ•ÉÐ¹½¬¡É•Á½ÉÐ¹™¥¹‘¥¹Ì¹Í½µ” ¡¥Ñ•´èì½‘”èÍÑÉ¥¹œô¤€ôø¥Ñ•´¹½‘”€ôôô€‰=9QaQ}AIMMUIˆ¤¤(€…ÍÍ•ÉÐ¹½¬¡É•Á½ÉÐ¹™¥¹‘¥¹Ì¹Í½µ” ¡¥Ñ•´èì½‘”èÍÑÉ¥¹œô¤€ôø¥Ñ•´¹½‘”€ôôô€‰=YIM%i}Q==1}=UQAUPˆ¤¤(€…ÍÍ•ÉÐ¹•ÅÕ…°¡)M=8¹ÍÑÉ¥¹¥™ä¡É•Á½ÉÐ¤¹¥¹±Õ‘•Ì ‰Íå¹Ñ¡•Ñ¥Œˆ¤°™…±Í”¤(€…ÍÍ•ÉÐ¹½¬¡Ñ½…ÍÑÌ¹±•¹Ñ €øô€Ä¤(€…ÍÍ•ÉÐ¹½¬¡±½Ì¹±•¹Ñ €øô€Ä¤)ô¤(