export interface CursorSdkImageDimension {
  readonly width: number;
  readonly height: number;
}

export type CursorSdkImage =
  | {
      readonly url: string;
      readonly dimension?: CursorSdkImageDimension;
    }
  | {
      readonly data: string;
      readonly mimeType: string;
      readonly dimension?: CursorSdkImageDimension;
    };

export interface CursorSdkUserMessage {
  readonly text: string;
  readonly images?: ReadonlyArray<CursorSdkImage>;
}

export interface CursorSdkModelParameterValue {
  readonly id: string;
  readonly value: string;
}

export interface CursorSdkModelSelection {
  readonly id: string;
  readonly params?: ReadonlyArray<CursorSdkModelParameterValue>;
}

export interface CursorSdkModelParameterDefinition {
  readonly id: string;
  readonly displayName?: string;
  readonly values: ReadonlyArray<{
    readonly value: string;
    readonly displayName?: string;
  }>;
}

export interface CursorSdkModelVariant {
  readonly params: ReadonlyArray<CursorSdkModelParameterValue>;
  readonly displayName: string;
  readonly description?: string;
  readonly isDefault?: boolean;
}

export interface CursorSdkModelListItem {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly aliases?: ReadonlyArray<string>;
  readonly parameters?: ReadonlyArray<CursorSdkModelParameterDefinition>;
  readonly variants?: ReadonlyArray<CursorSdkModelVariant>;
}

export interface CursorSdkUser {
  readonly apiKeyName: string;
  readonly userId?: number;
  readonly userEmail?: string;
  readonly userFirstName?: string;
  readonly userLastName?: string;
  readonly createdAt: string;
}

export interface CursorSdkTextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface CursorSdkToolUseBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export type CursorSdkMessage =
  | {
      readonly type: "system";
      readonly subtype?: "init";
      readonly agent_id: string;
      readonly run_id: string;
      readonly model?: CursorSdkModelSelection;
      readonly tools?: ReadonlyArray<string>;
    }
  | {
      readonly type: "assistant";
      readonly agent_id: string;
      readonly run_id: string;
      readonly message: {
        readonly role: "assistant";
        readonly content: ReadonlyArray<CursorSdkTextBlock | CursorSdkToolUseBlock>;
      };
    }
  | {
      readonly type: "user";
      readonly agent_id: string;
      readonly run_id: string;
      readonly message: {
        readonly role: "user";
        readonly content: ReadonlyArray<CursorSdkTextBlock>;
      };
    }
  | {
      readonly type: "tool_call";
      readonly agent_id: string;
      readonly run_id: string;
      readonly call_id: string;
      readonly name: string;
      readonly status: "running" | "completed" | "error";
      readonly args?: unknown;
      readonly result?: unknown;
      readonly truncated?: {
        readonly args?: boolean;
        readonly result?: boolean;
      };
    }
  | {
      readonly type: "thinking";
      readonly agent_id: string;
      readonly run_id: string;
      readonly text: string;
      readonly thinking_duration_ms?: number;
    }
  | {
      readonly type: "status";
      readonly agent_id: string;
      readonly run_id: string;
      readonly status: "CREATING" | "RUNNING" | "FINISHED" | "ERROR" | "CANCELLED" | "EXPIRED";
      readonly message?: string;
    }
  | {
      readonly type: "request";
      readonly agent_id: string;
      readonly run_id: string;
      readonly request_id: string;
    }
  | {
      readonly type: "task";
      readonly agent_id: string;
      readonly run_id: string;
      readonly status?: string;
      readonly text?: string;
    };

export type CursorSdkRunStatus = "running" | "finished" | "error" | "cancelled";
export type CursorSdkRunResultStatus = Exclude<CursorSdkRunStatus, "running">;
export type CursorSdkRunOperation = "stream" | "wait" | "cancel" | "conversation";

export interface CursorSdkRunResult {
  readonly id: string;
  readonly status: CursorSdkRunResultStatus;
  readonly result?: string;
  readonly model?: CursorSdkModelSelection;
  readonly durationMs?: number;
  readonly git?: unknown;
}

export interface CursorSdkRun {
  readonly id: string;
  readonly agentId: string;
  supports(operation: CursorSdkRunOperation): boolean;
  stream(): AsyncGenerator<CursorSdkMessage, void>;
  wait(): Promise<CursorSdkRunResult>;
  cancel(): Promise<void>;
  readonly status: CursorSdkRunStatus;
  readonly result?: string;
  readonly model?: CursorSdkModelSelection;
  readonly durationMs?: number;
  readonly git?: unknown;
}

export interface CursorSdkMcpServerConfig {
  readonly type?: "stdio" | "http" | "sse";
  readonly command?: string;
  readonly args?: ReadonlyArray<string>;
  readonly env?: Record<string, string>;
  readonly cwd?: string;
  readonly url?: string;
  readonly headers?: Record<string, string>;
}

export interface CursorSdkAgentOptions {
  readonly model?: CursorSdkModelSelection;
  readonly apiKey?: string;
  readonly name?: string;
  readonly local?: {
    readonly cwd?: string | ReadonlyArray<string>;
    readonly settingSources?: ReadonlyArray<
      "project" | "user" | "team" | "mdm" | "plugins" | "all"
    >;
    readonly sandboxOptions?: {
      readonly enabled: boolean;
    };
  };
  readonly cloud?: unknown;
  readonly mcpServers?: Record<string, CursorSdkMcpServerConfig>;
  readonly agents?: Record<string, unknown>;
  readonly agentId?: string;
  readonly idempotencyKey?: string;
}

export interface CursorSdkSendOptions {
  readonly model?: CursorSdkModelSelection;
  readonly mcpServers?: Record<string, CursorSdkMcpServerConfig>;
  readonly local?: {
    readonly force?: boolean;
  };
  readonly idempotencyKey?: string;
}

export interface CursorSdkAgent {
  readonly agentId: string;
  readonly model?: CursorSdkModelSelection;
  send(
    message: string | CursorSdkUserMessage,
    options?: CursorSdkSendOptions,
  ): Promise<CursorSdkRun>;
  close(): void;
  reload(): Promise<void>;
  [Symbol.asyncDispose]?(): Promise<void>;
}

export interface CursorSdkRequestOptions {
  readonly apiKey?: string;
}

export interface CursorSdkClient {
  createAgent(options: CursorSdkAgentOptions): Promise<CursorSdkAgent>;
  resumeAgent(agentId: string, options?: CursorSdkAgentOptions): Promise<CursorSdkAgent>;
  prompt(message: string, options?: CursorSdkAgentOptions): Promise<CursorSdkRunResult>;
  listModels(options?: CursorSdkRequestOptions): Promise<ReadonlyArray<CursorSdkModelListItem>>;
  getCurrentUser(options?: CursorSdkRequestOptions): Promise<CursorSdkUser>;
}

interface CursorSdkModule {
  readonly Agent: {
    create(options: CursorSdkAgentOptions): Promise<CursorSdkAgent>;
    resume(agentId: string, options?: CursorSdkAgentOptions): Promise<CursorSdkAgent>;
    prompt(message: string, options?: CursorSdkAgentOptions): Promise<CursorSdkRunResult>;
  };
  readonly Cursor: {
    me(options?: CursorSdkRequestOptions): Promise<CursorSdkUser>;
    readonly models: {
      list(options?: CursorSdkRequestOptions): Promise<ReadonlyArray<CursorSdkModelListItem>>;
    };
  };
}

const importCursorSdk = async (): Promise<CursorSdkModule> => {
  const importer = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<unknown>;
  const module = await importer("@cursor/sdk");
  return module as CursorSdkModule;
};

export const liveCursorSdkClient: CursorSdkClient = {
  async createAgent(options) {
    const sdk = await importCursorSdk();
    return sdk.Agent.create(options);
  },
  async resumeAgent(agentId, options) {
    const sdk = await importCursorSdk();
    return sdk.Agent.resume(agentId, options);
  },
  async prompt(message, options) {
    const sdk = await importCursorSdk();
    return sdk.Agent.prompt(message, options);
  },
  async listModels(options) {
    const sdk = await importCursorSdk();
    return sdk.Cursor.models.list(options);
  },
  async getCurrentUser(options) {
    const sdk = await importCursorSdk();
    return sdk.Cursor.me(options);
  },
};
