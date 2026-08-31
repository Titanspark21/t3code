// @effect-diagnostics nodeBuiltinImport:off
/**
 * Small ACP adapter for the Antigravity CLI.
 *
 * The CLI speaks newline-delimited stream JSON, not ACP. T3 launches this
 * module as a child process and supplies the account-isolated environment;
 * this bridge keeps the two protocols separate and translates only the
 * prompt/response surface T3 needs.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeProcess from "node:process";
import * as NodeReadline from "node:readline";
import * as NodeTimers from "node:timers";

import { parseAntigravityModels } from "../Drivers/AntigravityLaunch.ts";

type JsonRpcId = string | number;
type JsonRecord = Record<string, unknown>;

interface JsonRpcMessage {
  readonly jsonrpc?: string;
  readonly id?: JsonRpcId;
  readonly method?: string;
  readonly params?: unknown;
}

interface AgyEvent {
  readonly event?: unknown;
  readonly conversation_id?: unknown;
  readonly step_update?: unknown;
  readonly result?: unknown;
}

interface AgyModelState {
  readonly availableModels: ReadonlyArray<{ readonly modelId: string; readonly name: string }>;
  readonly currentModelId: string;
}

/**
 * How long a running turn may go without producing a single stream event.
 *
 * A real coding turn is mostly silence: `agy` emits nothing while a build, a
 * test run or a long tool call is in flight. The previous two-minute budget
 * cancelled those turns mid-flight and surfaced as the answer simply never
 * arriving, so this tracks the CLI's own five-minute print timeout with room
 * to spare rather than guessing at model latency.
 */
const STREAM_IDLE_TIMEOUT_MS = positiveEnvInteger("AGY_STREAM_IDLE_TIMEOUT_MS") ?? 900_000;

/** Startup is not silent, so it keeps the shorter budget. */
const SESSION_START_TIMEOUT_MS = positiveEnvInteger("AGY_SESSION_START_TIMEOUT_MS") ?? 120_000;

function positiveEnvInteger(name: string): number | undefined {
  const parsed = Number.parseInt(NodeProcess.env[name]?.trim() ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function sessionIdFrom(params: unknown): string {
  return stringValue(isRecord(params) ? params.sessionId : undefined) ?? "";
}

function promptText(params: unknown): string {
  const blocks = isRecord(params) && Array.isArray(params.prompt) ? params.prompt : [];
  return blocks
    .flatMap((block) => {
      if (!isRecord(block)) return [];
      if (block.type !== "text") {
        throw new Error(
          `Antigravity ACP bridge only supports text prompt blocks; received ${String(block.type)}.`,
        );
      }
      const text = stringValue(block.text);
      return text ? [text] : [];
    })
    .join("\n\n");
}

function writeJson(message: JsonRecord): void {
  NodeProcess.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function writeResult(id: JsonRpcId, result: unknown): void {
  writeJson({ id, result });
}

function writeError(id: JsonRpcId, code: number, message: string): void {
  writeJson({ id, error: { code, message } });
}

function timeout<T>(promise: Promise<T>, milliseconds: number, detail: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // @effect-diagnostics-next-line globalTimers:off - ACP bridge is a standalone Node stdio process.
    const timer = NodeTimers.setTimeout(() => reject(new Error(detail)), milliseconds);
    void promise.then(
      (value) => {
        NodeTimers.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        NodeTimers.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

interface CollectedProcessOutput {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

async function collectProcessOutput(
  child: NodeChildProcess.ChildProcess,
  milliseconds: number,
): Promise<CollectedProcessOutput> {
  if (!child.stdout || !child.stderr) {
    throw new Error("Antigravity CLI did not expose stdout and stderr pipes.");
  }
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const result = await timeout(
    new Promise<CollectedProcessOutput>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    }),
    milliseconds,
    "Timed out waiting for Antigravity CLI output.",
  ).catch((error: unknown) => {
    child.kill("SIGTERM");
    throw error;
  });
  return result;
}

async function discoverModels(cwd: string): Promise<AgyModelState["availableModels"]> {
  const binary = NodeProcess.env.AGY_BINARY?.trim() || "agy";
  const child = NodeChildProcess.spawn(binary, ["models"], {
    cwd,
    env: NodeProcess.env,
    // `agy models` waits for EOF even though it does not consume input.
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const result = await collectProcessOutput(child, 30_000);
    if (result.code !== 0) return [];
    return parseAntigravityModels(result.stdout).map((model) => ({
      modelId: model.slug,
      name: model.name,
    }));
  } catch {
    return [];
  }
}

const STANDALONE_COMMANDS = new Set([
  "agents",
  "changelog",
  "config",
  "credits",
  "effort",
  "help",
  "hooks",
  "model",
  "permissions",
  "skills",
  "usage",
  "quota",
]);

function standaloneCommandName(text: string): string | undefined {
  const match = /^\/(\S+)/u.exec(text.trim());
  const name = match?.[1]?.toLowerCase();
  return name && STANDALONE_COMMANDS.has(name) ? name : undefined;
}

async function runStandaloneCommand(cwd: string, command: string): Promise<string> {
  const binary = NodeProcess.env.AGY_BINARY?.trim() || "agy";
  const child = NodeChildProcess.spawn(binary, ["-p", command, "--output-format", "text"], {
    cwd,
    env: NodeProcess.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const result = await collectProcessOutput(child, 120_000);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `Antigravity command ${command} failed.`);
  }
  return result.stdout.trim() || result.stderr.trim() || "Antigravity command completed.";
}

/**
 * Arguments for one streaming `agy` child.
 *
 * `--add-dir` is the load-bearing one. Without it `agy` works out of a scratch
 * directory under its profile home instead of the thread's workspace: it never
 * sees the project, its own permission check denies every path outside that
 * scratch, and the turn still reports success having changed nothing. Chat-shaped
 * prompts answer normally under that failure, which is what made it look like
 * only "real" coding prompts were broken.
 */
export function antigravityStreamArgs(input: {
  readonly cwd: string;
  readonly model?: string;
  readonly conversationId?: string;
  readonly mode?: string;
}): ReadonlyArray<string> {
  return [
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--add-dir",
    input.cwd,
    ...(input.model ? ["--model", input.model] : []),
    ...(input.conversationId ? ["--conversation", input.conversationId] : []),
    ...(input.mode === "accept-edits" || input.mode === "plan" ? ["--mode", input.mode] : []),
  ];
}

class AgySession {
  sessionId: string;
  readonly cwd: string;
  child!: NodeChildProcess.ChildProcessWithoutNullStreams;
  lines!: NodeReadline.Interface;
  modelState: AgyModelState;
  /** Tool calls already announced this turn, so repeats become updates. */
  readonly announcedToolCalls = new Set<string>();
  private turnIndex = 0;
  private syntheticToolIndex = 0;
  private readonly queuedEvents: AgyEvent[] = [];
  private readonly waiters: Array<{
    readonly resolve: (event: AgyEvent) => void;
    readonly reject: (error: Error) => void;
  }> = [];
  private closed = false;
  private disposed = false;
  private exited = false;
  private processGeneration = 0;
  private conversationId: string | undefined;

  constructor(sessionId: string, cwd: string, modelState: AgyModelState, conversationId?: string) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.modelState = modelState;
    this.startChild(conversationId);
  }

  private startChild(conversationId?: string): void {
    const binary = NodeProcess.env.AGY_BINARY?.trim() || "agy";
    const model =
      this.modelState.currentModelId !== "default" ? this.modelState.currentModelId : undefined;
    const mode = NodeProcess.env.AGY_MODE?.trim();
    const generation = ++this.processGeneration;
    this.exited = false;
    this.child = NodeChildProcess.spawn(
      binary,
      antigravityStreamArgs({
        cwd: this.cwd,
        ...(model ? { model } : {}),
        ...(conversationId ? { conversationId } : {}),
        ...(mode ? { mode } : {}),
      }),
      {
        cwd: this.cwd,
        env: NodeProcess.env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.lines = NodeReadline.createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => {
      try {
        const parsed = JSON.parse(line) as AgyEvent;
        this.enqueue(parsed);
      } catch {
        // The CLI may write human diagnostics to stdout on a failed startup.
        // ACP must remain JSONL, so ignore that line and let the timeout report
        // a useful bridge failure to the parent.
      }
    });
    this.child.stderr.resume();
    this.child.once("error", (error) => {
      if (generation === this.processGeneration) this.fail(error);
    });
    this.child.once("exit", (code, signal) => {
      if (generation !== this.processGeneration) return;
      this.exited = true;
      this.fail(
        new Error(
          `Antigravity CLI exited before completing the request (code=${String(code)}, signal=${String(signal)}).`,
        ),
      );
    });
  }

  private enqueue(event: AgyEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(event);
    } else {
      this.queuedEvents.push(event);
    }
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  nextEvent(milliseconds = STREAM_IDLE_TIMEOUT_MS): Promise<AgyEvent> {
    if (this.queuedEvents.length > 0) return Promise.resolve(this.queuedEvents.shift()!);
    if (this.closed) return Promise.reject(new Error("Antigravity CLI session is closed."));
    return timeout(
      new Promise<AgyEvent>((resolve, reject) => this.waiters.push({ resolve, reject })),
      milliseconds,
      "Timed out waiting for Antigravity CLI stream output.",
    );
  }

  /**
   * Scope tool call ids to one turn. `agy` numbers its steps per conversation,
   * but a resumed conversation restarts them, and a reused id would edit the
   * previous turn's row instead of opening a new one.
   */
  beginTurn(): void {
    this.turnIndex += 1;
    this.syntheticToolIndex = 0;
    this.announcedToolCalls.clear();
  }

  toolCallId(stepIndex: number | undefined): string {
    const index = stepIndex ?? `x${(this.syntheticToolIndex += 1)}`;
    return `agy-tool-${this.turnIndex}-${index}`;
  }

  /**
   * Write one turn to the CLI, restarting it first when the previous turn left
   * it dead.
   *
   * `agy` exits on some errors, and the conversation id survives it, so a
   * resumed child keeps the history. Refusing the prompt instead would strand
   * the thread: every later message in it would fail the same way with no way
   * back short of a new thread.
   */
  async sendPrompt(text: string): Promise<void> {
    if (this.disposed) throw new Error("Antigravity CLI session is closed.");
    if (this.closed || !this.child.stdin.writable) {
      this.closed = false;
      this.queuedEvents.splice(0);
      this.startChild(this.conversationId);
      await this.waitForInit();
    }
    this.child.stdin.write(`${JSON.stringify({ event: "user", message: { content: text } })}\n`);
  }

  async waitForInit(): Promise<void> {
    for (;;) {
      const event = await this.nextEvent(SESSION_START_TIMEOUT_MS);
      if (event.event === "init") {
        this.conversationId = stringValue(event.conversation_id) ?? this.conversationId;
        return;
      }
    }
  }

  async setModel(modelId: string): Promise<void> {
    const normalizedModelId = modelId.trim();
    if (!normalizedModelId || normalizedModelId === this.modelState.currentModelId) return;
    if (
      this.modelState.availableModels.length > 0 &&
      !this.modelState.availableModels.some((model) => model.modelId === normalizedModelId)
    ) {
      throw new Error(`Unknown Antigravity model: ${normalizedModelId}`);
    }
    if (!this.conversationId) {
      throw new Error("Antigravity has not reported a conversation id yet.");
    }

    const oldChild = this.child;
    this.processGeneration += 1;
    this.lines.close();
    oldChild.stdin.destroy();
    oldChild.kill("SIGTERM");
    // Model changes restart the stream in-place. Do not leave the previous
    // provider process behind if it is stuck in authentication or networking.
    // @effect-diagnostics-next-line globalTimers:off - standalone Node bridge cleanup.
    const forceKillTimer = NodeTimers.setTimeout(() => {
      oldChild.kill("SIGKILL");
    }, 1_000);
    forceKillTimer.unref();
    this.queuedEvents.splice(0);
    this.modelState = {
      ...this.modelState,
      currentModelId: normalizedModelId,
    };
    this.startChild(this.conversationId);
    await this.waitForInit();
  }

  adoptConversationId(): void {
    if (this.conversationId) this.sessionId = this.conversationId;
  }

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.closed = true;
    this.lines.close();
    this.child.stdin.destroy();
    this.child.kill("SIGTERM");
    // A provider process can be waiting inside its auth/network stack and not
    // react to SIGTERM promptly. The bridge must still honor ACP close/cancel
    // and never leave an orphaned account process behind.
    const child = this.child;
    // @effect-diagnostics-next-line globalTimers:off - standalone Node bridge cleanup.
    const forceKillTimer = NodeTimers.setTimeout(() => {
      if (!this.exited) child.kill("SIGKILL");
    }, 1_000);
    forceKillTimer.unref();
  }
}

const sessions = new Map<string, AgySession>();

async function createSession(
  id: string,
  cwd: string,
  conversationId?: string,
): Promise<AgySession> {
  const availableModels = await discoverModels(cwd);
  const requestedModel = NodeProcess.env.AGY_MODEL?.trim();
  const currentModelId = requestedModel || availableModels[0]?.modelId || "default";
  const modelsWithRequested =
    requestedModel && !availableModels.some((model) => model.modelId === requestedModel)
      ? [...availableModels, { modelId: requestedModel, name: requestedModel }]
      : availableModels;
  const modelState: AgyModelState = {
    availableModels: modelsWithRequested,
    currentModelId,
  };
  const session = new AgySession(id, cwd, modelState, conversationId);
  sessions.set(id, session);
  try {
    await session.waitForInit();
    return session;
  } catch (error) {
    session.close();
    sessions.delete(id);
    throw error;
  }
}

function resultUsage(result: JsonRecord): JsonRecord | undefined {
  const usage = isRecord(result.usage) ? result.usage : undefined;
  if (!usage) return undefined;
  const inputTokens = numberValue(usage.input_tokens);
  const outputTokens = numberValue(usage.output_tokens);
  const totalTokens =
    numberValue(usage.total_tokens) ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);
  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) {
    return undefined;
  }
  return { inputTokens, outputTokens, totalTokens };
}

/**
 * ACP tool kind for an `agy` tool name.
 *
 * Only affects the icon and grouping a client picks, so unknown tools degrade
 * to `other` rather than being dropped.
 */
export function toolKind(toolName: string): string {
  const name = toolName.toLowerCase();
  if (name.startsWith("browser_") || name.includes("url") || name.includes("web")) return "fetch";
  if (name.includes("delete") || name.includes("remove")) return "delete";
  if (name.includes("write") || name.includes("edit") || name.includes("replace")) return "edit";
  if (name.includes("command") || name.includes("terminal") || name.includes("run")) {
    return "execute";
  }
  if (name.includes("search") || name.includes("find") || name.includes("grep")) return "search";
  if (name.includes("view") || name.includes("read") || name.includes("list")) return "read";
  return "other";
}

const TOOL_PATH_PARAMETERS = [
  "TargetFile",
  "AbsolutePath",
  "DirectoryPath",
  "SearchDirectory",
  "Path",
  "File",
];

function toolPath(parameters: JsonRecord): string | undefined {
  for (const key of TOOL_PATH_PARAMETERS) {
    const value = stringValue(parameters[key]);
    if (value) return value;
  }
  return undefined;
}

/** Human title for the tool row: the tool plus the one detail worth reading. */
export function toolTitle(toolName: string, parameters: JsonRecord): string {
  const command = stringValue(parameters["CommandLine"]);
  if (command) return command;
  const path = toolPath(parameters);
  return path ? `${toolName} ${path}` : toolName;
}

export function toolStatus(state: string | undefined): string {
  switch (state) {
    case "ACTIVE":
      return "in_progress";
    case "DONE":
      return "completed";
    case "ERROR":
    case "FAILED":
      return "failed";
    default:
      return "pending";
  }
}

/**
 * Translate one `agy` tool step into an ACP tool call.
 *
 * `agy` reports the same `step_index` for the start and the end of a tool, so
 * the first report opens the call and later ones update it. Without this the
 * client sees an idle spinner for the whole working part of a turn and then a
 * bare answer, which reads as the turn having done nothing.
 */
function emitToolUpdate(session: AgySession, step: JsonRecord): void {
  const toolName = stringValue(step.tool_name) ?? "tool";
  const toolCallId = session.toolCallId(numberValue(step.step_index));
  const info = isRecord(step.tool_info) ? step.tool_info : {};
  const parameters = isRecord(info.parameters) ? info.parameters : {};
  const path = toolPath(parameters);
  const output = stringValue(info.output);
  const error = isRecord(info.error) ? stringValue(info.error.message) : undefined;
  const detail = error ?? output;
  const isNew = !session.announcedToolCalls.has(toolCallId);
  session.announcedToolCalls.add(toolCallId);

  writeJson({
    method: "session/update",
    params: {
      sessionId: session.sessionId,
      update: {
        sessionUpdate: isNew ? "tool_call" : "tool_call_update",
        toolCallId,
        title: toolTitle(toolName, parameters),
        kind: toolKind(toolName),
        status: toolStatus(stringValue(step.state)),
        rawInput: parameters,
        ...(path ? { locations: [{ path }] } : {}),
        ...(detail
          ? { content: [{ type: "content", content: { type: "text", text: detail } }] }
          : {}),
      },
    },
  });
}

async function promptSession(session: AgySession, params: unknown): Promise<JsonRecord> {
  const text = promptText(params);
  if (!text) throw new Error("Antigravity ACP bridge received an empty prompt.");

  // AGY explicitly rejects slash commands in a stream-json session. Run the
  // provider-owned report commands as isolated one-shot invocations so the
  // persistent conversation remains healthy after `/help`, `/usage`, etc.
  if (standaloneCommandName(text) || /^\/(?:exit|quit)$/iu.test(text.trim())) {
    if (/^\/(?:exit|quit)$/iu.test(text.trim())) {
      session.close();
      return { stopReason: "end_turn" };
    }
    const report = await runStandaloneCommand(session.cwd, text.trim());
    writeJson({
      method: "session/update",
      params: {
        sessionId: session.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: report },
        },
      },
    });
    return {
      stopReason: "end_turn",
      ...(isRecord(params) && stringValue(params.messageId)
        ? { userMessageId: params.messageId }
        : {}),
    };
  }

  session.beginTurn();
  await session.sendPrompt(text);
  let emittedText = false;

  for (;;) {
    const event = await session.nextEvent();
    const step = isRecord(event.step_update) ? event.step_update : undefined;
    if (step) {
      const stepType = stringValue(step.step_type);
      const delta = stringValue(step.text_delta);
      if (delta) {
        const thought = stepType === "thinking" || stepType === "reasoning";
        if (!thought) emittedText = true;
        writeJson({
          method: "session/update",
          params: {
            sessionId: session.sessionId,
            update: {
              sessionUpdate: thought ? "agent_thought_chunk" : "agent_message_chunk",
              content: { type: "text", text: delta },
            },
          },
        });
      }
      if (stepType === "tool") emitToolUpdate(session, step);
      continue;
    }

    const result = isRecord(event.result) ? event.result : undefined;
    if (!result) continue;
    const status = stringValue(result.status);
    const failure = isRecord(result.error) ? stringValue(result.error.message) : undefined;
    const response = stringValue(result.response) ?? failure;
    if (response && !emittedText) {
      writeJson({
        method: "session/update",
        params: {
          sessionId: session.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: response },
          },
        },
      });
    }
    return {
      stopReason: status === "SUCCESS" ? "end_turn" : "refusal",
      ...(resultUsage(result) ? { usage: resultUsage(result) } : {}),
      ...(isRecord(params) && stringValue(params.messageId)
        ? { userMessageId: params.messageId }
        : {}),
    };
  }
}

async function handleMessage(message: JsonRpcMessage): Promise<void> {
  const method = message.method;
  if (!method) return;
  const id = message.id;
  try {
    switch (method) {
      case "initialize":
        if (id === undefined) return;
        writeResult(id, {
          protocolVersion: 1,
          agentInfo: { name: "t3-antigravity-bridge", title: "Antigravity CLI", version: "1.0.0" },
          authMethods: [
            {
              id: "cached_token",
              name: "Cached Antigravity login",
              description: "Uses the isolated AGY profile selected by T3 Code.",
            },
          ],
          agentCapabilities: {
            promptCapabilities: { image: false, audio: false, embeddedContext: false },
            sessionCapabilities: { close: {} },
          },
        });
        return;
      case "authenticate":
        if (id !== undefined) writeResult(id, {});
        return;
      case "session/new": {
        if (id === undefined || !isRecord(message.params)) return;
        const createdId = NodeCrypto.randomUUID();
        const cwd = stringValue(message.params.cwd) ?? NodeProcess.cwd();
        const session = await createSession(createdId, cwd);
        session.adoptConversationId();
        if (session.sessionId !== createdId) {
          sessions.delete(createdId);
          sessions.set(session.sessionId, session);
        }
        writeResult(id, { sessionId: session.sessionId, models: session.modelState });
        return;
      }
      case "session/load": {
        if (id === undefined || !isRecord(message.params)) return;
        const requestedSessionId = sessionIdFrom(message.params);
        const loadedId = requestedSessionId || NodeCrypto.randomUUID();
        const cwd = stringValue(message.params.cwd) ?? NodeProcess.cwd();
        const session = await createSession(loadedId, cwd, requestedSessionId || undefined);
        writeResult(id, { modes: null, models: session.modelState, configOptions: null });
        return;
      }
      case "session/set_model": {
        if (id === undefined || !isRecord(message.params)) return;
        const session = sessions.get(sessionIdFrom(message.params));
        if (!session) throw new Error("Unknown Antigravity ACP session.");
        const modelId = stringValue(message.params.modelId);
        if (!modelId) throw new Error("Antigravity ACP model selection requires modelId.");
        await session.setModel(modelId);
        writeResult(id, {});
        return;
      }
      case "session/set_config_option": {
        if (id === undefined || !isRecord(message.params)) return;
        const session = sessions.get(sessionIdFrom(message.params));
        if (!session) throw new Error("Unknown Antigravity ACP session.");
        const configId = stringValue(message.params.configId);
        const value = stringValue(message.params.value);
        if (configId !== "model" || !value) {
          throw new Error(
            "Antigravity ACP only supports changing the model between turns; use --mode at session start.",
          );
        }
        await session.setModel(value);
        writeResult(id, { configOptions: [] });
        return;
      }
      case "session/prompt": {
        if (id === undefined) return;
        const session = sessions.get(sessionIdFrom(message.params));
        if (!session) throw new Error("Unknown Antigravity ACP session.");
        writeResult(id, await promptSession(session, message.params));
        return;
      }
      case "session/cancel": {
        const session = sessions.get(sessionIdFrom(message.params));
        session?.close();
        return;
      }
      case "session/close": {
        const session = sessions.get(sessionIdFrom(message.params));
        session?.close();
        if (session) sessions.delete(session.sessionId);
        if (id !== undefined) writeResult(id, {});
        return;
      }
      default:
        if (id !== undefined) writeError(id, -32601, `Unsupported ACP method: ${method}`);
    }
  } catch (error) {
    if (id !== undefined) {
      writeError(id, -32000, error instanceof Error ? error.message : String(error));
    }
  }
}

export async function runAntigravityAcpBridge(): Promise<void> {
  const input = NodeReadline.createInterface({ input: NodeProcess.stdin });
  input.on("line", (line) => {
    if (!line.trim()) return;
    try {
      void handleMessage(JSON.parse(line) as JsonRpcMessage);
    } catch {
      // Keep stdout valid ACP JSONL even for malformed input.
    }
  });
  await new Promise<void>((resolve) => input.once("close", resolve));
  for (const session of sessions.values()) session.close();
  sessions.clear();
}
