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
  readonly step_update?: unknown;
  readonly result?: unknown;
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

class AgySession {
  readonly sessionId: string;
  readonly child: NodeChildProcess.ChildProcessWithoutNullStreams;
  readonly lines: NodeReadline.Interface;
  private readonly queuedEvents: AgyEvent[] = [];
  private readonly waiters: Array<{
    readonly resolve: (event: AgyEvent) => void;
    readonly reject: (error: Error) => void;
  }> = [];
  private closed = false;

  constructor(sessionId: string, cwd: string) {
    this.sessionId = sessionId;
    const binary = NodeProcess.env.AGY_BINARY?.trim() || "agy";
    this.child = NodeChildProcess.spawn(
      binary,
      ["--output-format", "stream-json", "--input-format", "stream-json"],
      {
        cwd,
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
    this.child.once("error", (error) => this.fail(error));
    this.child.once("exit", (code, signal) => {
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

  nextEvent(milliseconds = 120_000): Promise<AgyEvent> {
    if (this.queuedEvents.length > 0) return Promise.resolve(this.queuedEvents.shift()!);
    if (this.closed) return Promise.reject(new Error("Antigravity CLI session is closed."));
    return timeout(
      new Promise<AgyEvent>((resolve, reject) => this.waiters.push({ resolve, reject })),
      milliseconds,
      "Timed out waiting for Antigravity CLI stream output.",
    );
  }

  sendPrompt(text: string): void {
    if (this.closed || !this.child.stdin.writable) {
      throw new Error("Antigravity CLI session is closed.");
    }
    this.child.stdin.write(`${JSON.stringify({ event: "user", message: { content: text } })}\n`);
  }

  async waitForInit(): Promise<void> {
    for (;;) {
      const event = await this.nextEvent();
      if (event.event === "init") return;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.lines.close();
    this.child.kill("SIGTERM");
  }
}

const sessions = new Map<string, AgySession>();

async function createSession(id: string, cwd: string): Promise<AgySession> {
  const session = new AgySession(id, cwd);
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

async function promptSession(session: AgySession, params: unknown): Promise<JsonRecord> {
  const text = promptText(params);
  if (!text) throw new Error("Antigravity ACP bridge received an empty prompt.");
  session.sendPrompt(text);

  for (;;) {
    const event = await session.nextEvent();
    const step = isRecord(event.step_update) ? event.step_update : undefined;
    if (step) {
      const delta = stringValue(step.text_delta);
      if (delta) {
        writeJson({
          method: "session/update",
          params: {
            sessionId: session.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: delta },
            },
          },
        });
      }
      continue;
    }

    const result = isRecord(event.result) ? event.result : undefined;
    if (!result) continue;
    const status = stringValue(result.status);
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
        await createSession(createdId, cwd);
        writeResult(id, { sessionId: createdId });
        return;
      }
      case "session/load": {
        if (id === undefined || !isRecord(message.params)) return;
        const loadedId = sessionIdFrom(message.params) || NodeCrypto.randomUUID();
        const cwd = stringValue(message.params.cwd) ?? NodeProcess.cwd();
        await createSession(loadedId, cwd);
        writeResult(id, { modes: null, models: null, configOptions: null });
        return;
      }
      case "session/set_model":
      case "session/set_config_option":
        if (id !== undefined) writeResult(id, {});
        return;
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
