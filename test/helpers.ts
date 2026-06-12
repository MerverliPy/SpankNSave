import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { AssistantMessage } from "@opencode-ai/sdk"

type ChatParamsInput = Parameters<Required<Hooks>["chat.params"]>[0]
type ChatParamsOutput = Parameters<Required<Hooks>["chat.params"]>[1]
type ToolExecAftInput = Parameters<Required<Hooks>["tool.execute.after"]>[0]
type ToolExecAftOutput = Parameters<Required<Hooks>["tool.execute.after"]>[1]
type EventInput = Parameters<Required<Hooks>["event"]>[0]

const PLUGIN_INPUT_DEFAULTS = {
  directory: "/tmp/test",
  worktree: "/tmp/test",
  serverUrl: new URL("http://localhost:0"),
  project: { id: "test", worktree: "/tmp/test", time: { created: 0 } },
  client: { app: { log: async () => true }, tui: { showToast: async () => true } },
  experimental_workspace: { register() {} },
  $: {},
} as unknown as PluginInput

const CHAT_PARAMS_INPUT_DEFAULTS = {
  sessionID: "s",
  agent: "test",
  model: {
    id: "m",
    providerID: "p",
    api: { id: "a", url: "https://example.com", npm: "" },
    name: "test-model",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 10000, output: 4096 },
    status: "active" as const,
    options: {},
    headers: {},
  },
  provider: {
    source: "config" as const,
    info: { id: "p", name: "Test", source: "config" as const, env: [], options: {}, models: {} },
    options: {},
  },
  message: {
    id: "msg",
    sessionID: "s",
    role: "user" as const,
    time: { created: 0 },
    agent: "test",
    model: { providerID: "p", modelID: "m" },
  },
} as unknown as ChatParamsInput

export function mockPluginInput(overrides?: Record<string, unknown>): PluginInput {
  return { ...PLUGIN_INPUT_DEFAULTS, ...overrides } as PluginInput
}

export function mockChatParamsInput(overrides?: Record<string, unknown>): ChatParamsInput {
  return { ...CHAT_PARAMS_INPUT_DEFAULTS, ...overrides } as ChatParamsInput
}

export function mockChatParamsOutput(overrides?: Partial<ChatParamsOutput>): ChatParamsOutput {
  return {
    temperature: 0,
    topP: 1,
    topK: 0,
    maxOutputTokens: undefined as number | undefined,
    options: {},
    ...overrides,
  } as ChatParamsOutput
}

export function mockToolExecuteAfterInput(overrides?: Partial<ToolExecAftInput>): ToolExecAftInput {
  return {
    tool: "bash",
    sessionID: "s",
    callID: "c0",
    args: {},
    ...overrides,
  } as ToolExecAftInput
}

export function mockToolExecuteAfterOutput(overrides?: Partial<ToolExecAftOutput>): ToolExecAftOutput {
  return {
    title: "test",
    output: "",
    metadata: {},
    ...overrides,
  } as ToolExecAftOutput
}

export function mockEventMessageUpdated(
  overrides?: Partial<AssistantMessage>,
): EventInput {
  return {
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "m0",
          sessionID: "s",
          role: "assistant" as const,
          time: { created: 1 },
          providerID: "p",
          modelID: "m",
          mode: "default",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0,
          parentID: "p0",
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          ...overrides,
        },
      },
    },
  } as EventInput
}

export function mockEventSessionIdle(
  overrides?: { sessionID?: string },
): EventInput {
  return {
    event: {
      type: "session.idle",
      properties: { sessionID: overrides?.sessionID ?? "s" },
    },
  } as EventInput
}

export function mockEventSessionDeleted(
  overrides?: { id?: string },
): EventInput {
  return {
    event: {
      type: "session.deleted",
      properties: {
        info: {
          id: overrides?.id ?? "s",
          projectID: "proj",
          directory: "/tmp",
          title: "",
          version: "0",
          time: { created: 0, updated: 0 },
        },
      },
    },
  } as EventInput
}

export function mockEventMessageRemoved(
  overrides?: { sessionID?: string; messageID?: string },
): EventInput {
  return {
    event: {
      type: "message.removed",
      properties: {
        sessionID: overrides?.sessionID ?? "s",
        messageID: overrides?.messageID ?? "m0",
      },
    },
  } as EventInput
}
