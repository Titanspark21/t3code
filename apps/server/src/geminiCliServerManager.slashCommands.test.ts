import { describe, expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { GeminiCliServerManager } from "./geminiCliServerManager.ts";

const asThreadId = (value: string): ThreadId => ThreadId.make(value);

type MutableSession = {
  status: string;
  activeProcess: unknown;
  conversationHistory: Array<{ role: "user" | "assistant"; text: string }>;
};

function getSession(manager: GeminiCliServerManager, threadId: string): MutableSession {
  const sessions = (manager as unknown as { sessions: Map<string, MutableSession> }).sessions;
  const session = sessions.get(threadId);
  if (!session) throw new Error(`missing session ${threadId}`);
  return session;
}

const flushImmediate = () => new Promise((resolve) => setImmediate(resolve));

async function startAntigravitySession(manager: GeminiCliServerManager, threadId: string) {
  await manager.startSession({
    threadId: asThreadId(threadId),
    provider: ProviderDriverKind.make("geminiCli"),
    runtimeMode: "full-access",
    modelSelection: {
      instanceId: ProviderInstanceId.make("geminiCli"),
      model: "Gemini 3.5 Flash",
    },
  });
}

describe("native slash commands", () => {
  it("runs /clear without spawning the CLI and resets the transcript", async () => {
    const manager = new GeminiCliServerManager({ antigravity: true });
    const events: ProviderRuntimeEvent[] = [];
    manager.on("event", (event: ProviderRuntimeEvent) => events.push(event));

    try {
      await startAntigravitySession(manager, "thread-1");
      const session = getSession(manager, "thread-1");
      session.conversationHistory.push({ role: "user", text: "earlier question" });
      session.conversationHistory.push({ role: "assistant", text: "earlier answer" });

      await manager.sendTurn({ threadId: asThreadId("thread-1"), input: "/clear" });
      await flushImmediate();

      expect(session.conversationHistory).toHaveLength(0);
      expect(session.activeProcess).toBeUndefined();
      expect(session.status).toBe("ready");

      const types = events.map((event) => event.type);
      expect(types).toContain("turn.started");
      expect(types).toContain("content.delta");
      expect(types).toContain("turn.completed");

      const completed = events.find((event) => event.type === "turn.completed");
      expect((completed as { payload?: { state?: string } } | undefined)?.payload?.state).toBe(
        "completed",
      );

      const delta = events.find((event) => event.type === "content.delta");
      const deltaText = (delta as { payload?: { delta?: string } } | undefined)?.payload?.delta;
      expect(deltaText).toMatch(/cleared/i);
    } finally {
      manager.stopAll();
    }
  });

  it("answers /help from T3 and preserves the transcript", async () => {
    const manager = new GeminiCliServerManager({ antigravity: true });
    const events: ProviderRuntimeEvent[] = [];
    manager.on("event", (event: ProviderRuntimeEvent) => events.push(event));

    try {
      await startAntigravitySession(manager, "thread-1");
      const session = getSession(manager, "thread-1");
      session.conversationHistory.push({ role: "user", text: "keep me" });

      await manager.sendTurn({ threadId: asThreadId("thread-1"), input: "/help" });
      await flushImmediate();

      // /help is informational — the transcript must be untouched.
      expect(session.conversationHistory).toHaveLength(1);
      expect(session.activeProcess).toBeUndefined();

      const delta = events.find((event) => event.type === "content.delta");
      const deltaText = (delta as { payload?: { delta?: string } } | undefined)?.payload?.delta;
      expect(deltaText).toContain("/clear");
      expect(deltaText).toContain("/stats");
    } finally {
      manager.stopAll();
    }
  });
});
