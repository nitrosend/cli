import { AuthContext } from "../auth.js";
import { CliError } from "../errors.js";
import { versionGate, VersionGate } from "../version/gate.js";
import { CURRENT_VERSION } from "../version/current.js";

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

  listTools(): Promise<unknown> {
    return this.request("tools/list");
  }

  callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request("tools/call", { name, arguments: args });
  }

  listResources(): Promise<unknown> {
    return this.request("resources/list");
  }

  readResource(uri: string): Promise<unknown> {
    return this.request("resources/read", { uri });
  }

  listPrompts(): Promise<unknown> {
    return this.request("prompts/list");
  }

  getPrompt(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request("prompts/get", { name, arguments: args });
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T | null> {
    const response = await this.fetcher(this.auth.apiUrl, {
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
    });

    this.gate.check(response.headers);

    if (response.status === 202) return null;

    const text = await response.text();
    let payload: JsonRpcResponse<T>;
    try {
      payload = JSON.parse(text) as JsonRpcResponse<T>;
    } catch {
      throw new CliError(`MCP response was not valid JSON (HTTP ${response.status})`);
    }

    if (!response.ok) {
      const message = payload.error?.message || `MCP request failed with HTTP ${response.status}`;
      throw new CliError(message, response.status === 401 || response.status === 403 ? 2 : 1);
    }

    if (payload.error) {
      throw new CliError(payload.error.message);
    }

    return payload.result ?? null;
  }
}
