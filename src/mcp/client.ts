import { AuthContext } from "../auth.js";
import { CliError } from "../errors.js";
import { fetchText, httpError, parseJsonBody } from "../http.js";
import { versionGate, VersionGate } from "../version/gate.js";
import { CURRENT_VERSION } from "../version/current.js";
import { ResourceReadResult, ToolCallResult, ToolListResult } from "./result.js";

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpClientOptions {
  auth: AuthContext;
  fetcher?: typeof fetch;
  gate?: VersionGate;
}

export class McpClient {
  private id = 0;
  private readonly auth: AuthContext;
  private readonly fetcher: typeof fetch;
  private readonly gate: VersionGate;

  constructor(options: McpClientOptions) {
    this.auth = options.auth;
    this.fetcher = options.fetcher ?? fetch;
    this.gate = options.gate ?? versionGate;
  }

  initialize(): Promise<unknown> {
    return this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: {
        name: "@nitrosend/cli",
        version: CURRENT_VERSION
      }
    });
  }

  async listTools(): Promise<ToolListResult> {
    return (await this.request<ToolListResult>("tools/list")) ?? { tools: [] };
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    return (await this.request<ToolCallResult>("tools/call", { name, arguments: args })) ?? {};
  }

  listResources(): Promise<unknown> {
    return this.request("resources/list");
  }

  async readResource(uri: string): Promise<ResourceReadResult> {
    return (await this.request<ResourceReadResult>("resources/read", { uri })) ?? { contents: [] };
  }

  listPrompts(): Promise<unknown> {
    return this.request("prompts/list");
  }

  getPrompt(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request("prompts/get", { name, arguments: args });
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T | null> {
    const response = await fetchText(this.auth.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${this.auth.token}`
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++this.id,
        method,
        ...(params === undefined ? {} : { params })
      })
    }, {
      fetcher: this.fetcher,
      name: `mcp ${method}`,
      service: "MCP"
    });

    this.gate.check(response.headers);

    if (response.status === 202) return null;

    const payload = parseJsonBody<JsonRpcResponse<T>>(response, "MCP");

    if (!response.ok) {
      throw httpError(response, payload);
    }

    if (payload.error) {
      throw new CliError(payload.error.message, {
        code: "mcp_json_rpc_error",
        exitCodeName: "data"
      });
    }

    return payload.result ?? null;
  }
}
