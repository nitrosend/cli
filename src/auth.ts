import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import { currentProfile, defaultApiUrl, deleteCurrentProfile, Profile, storeProfile } from "./config.js";
import { CliError } from "./errors.js";
import { fetchJson } from "./http.js";

export interface AuthContext {
  token: string;
  tokenType: "api_key" | "bearer";
  apiUrl: string;
  source: "env" | "profile";
  profileName?: string;
}

interface OAuthServerMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export async function resolveAuth(profileName?: string): Promise<AuthContext> {
  const bearer = process.env.NITROSEND_BEARER_TOKEN;
  if (bearer) {
    return { token: bearer, tokenType: "bearer", apiUrl: defaultApiUrl(), source: "env" };
  }

  const apiKey = process.env.NITROSEND_API_KEY;
  if (apiKey) {
    validateApiKey(apiKey);
    return { token: apiKey, tokenType: "api_key", apiUrl: defaultApiUrl(), source: "env" };
  }

  const profile = await currentProfile();
  if (!profile) {
    throw new CliError("Not logged in. Run `nitrosend login --api-key ...` or set NITROSEND_API_KEY.", {
      code: "not_authenticated",
      exitCodeName: "permission",
      nextAction: "Run `nitrosend login --api-key ...` or set NITROSEND_API_KEY."
    });
  }

  if (profileName && profile.name !== profileName) {
    throw new CliError(`Profile ${profileName} is not active. Profile switching will be added after bootstrap.`, {
      code: "profile_not_active",
      exitCodeName: "permission"
    });
  }

  return {
    token: profile.token,
    tokenType: profile.tokenType,
    apiUrl: profile.apiUrl,
    source: "profile",
    profileName: profile.name
  };
}

export function validateApiKey(apiKey: string): void {
  if (!/^nskey_(?:live|test)_[A-Za-z0-9]+$/.test(apiKey)) {
    throw new CliError("Invalid API key format. Expected nskey_live_... or nskey_test_...");
  }
}

export async function loginWithApiKey(apiKey: string, options: { profile: string; apiUrl?: string }): Promise<Profile> {
  validateApiKey(apiKey);
  const profile: Profile = {
    name: options.profile,
    apiUrl: options.apiUrl || defaultApiUrl(),
    token: apiKey,
    tokenType: "api_key"
  };
  await storeProfile(profile);
  return profile;
}

export async function logout(): Promise<string | null> {
  return deleteCurrentProfile();
}

export async function loginWithOAuth(options: { profile: string; apiUrl?: string; openBrowser?: boolean }): Promise<Profile> {
  const apiUrl = options.apiUrl || defaultApiUrl();
  const baseUrl = new URL(apiUrl).origin;
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const state = base64Url(randomBytes(24));
  const callback = await createCallbackServer(state);

  try {
    const metadata = await discoverOAuthMetadata(baseUrl);
    const clientId = await registerClient(metadata, callback.redirectUri);
    const authorizeUrl = new URL(metadata.authorization_endpoint);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", callback.redirectUri);
    authorizeUrl.searchParams.set("scope", "mcp");
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("resource", `${baseUrl}/mcp`);

    if (options.openBrowser !== false) {
      openUrl(authorizeUrl.toString());
    }

    const code = await callback.waitForCode(authorizeUrl.toString());
    const token = await exchangeCode(metadata, {
      code,
      verifier,
      clientId,
      redirectUri: callback.redirectUri
    });

    const profile: Profile = {
      name: options.profile,
      apiUrl,
      token: token.access_token,
      tokenType: "bearer",
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : undefined
    };
    await storeProfile(profile);
    return profile;
  } finally {
    await callback.close();
  }
}

async function discoverOAuthMetadata(baseUrl: string): Promise<OAuthServerMetadata> {
  const protectedResource = await fetchJson<{ authorization_servers?: string[] }>(
    `${baseUrl}/.well-known/oauth-protected-resource/mcp`,
    {},
    { name: "oauth protected-resource", service: "OAuth protected resource metadata" }
  ).catch(() => ({ authorization_servers: undefined }));

  const issuer = protectedResource.authorization_servers?.[0] || baseUrl;
  const metadataUrl = `${issuer.replace(/\/$/, "")}/.well-known/oauth-authorization-server`;
  return fetchJson<OAuthServerMetadata>(
    metadataUrl,
    {},
    { name: "oauth metadata", service: "OAuth authorization server metadata" }
  );
}

async function registerClient(metadata: OAuthServerMetadata, redirectUri: string): Promise<string> {
  if (!metadata.registration_endpoint) {
    return process.env.NITROSEND_OAUTH_CLIENT_ID || "nitrosend-cli";
  }

  const body = await fetchJson<{ client_id?: string }>(metadata.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Nitrosend CLI",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "mcp"
    })
  }, {
    name: "oauth register",
    service: "OAuth registration"
  });

  if (!body.client_id) throw new CliError("OAuth client registration response did not include client_id");
  return body.client_id;
}

async function exchangeCode(
  metadata: OAuthServerMetadata,
  params: { code: string; verifier: string; clientId: string; redirectUri: string }
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.verifier,
    client_id: params.clientId,
    redirect_uri: params.redirectUri
  });

  const token = await fetchJson<OAuthTokenResponse>(metadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body
  }, {
    name: "oauth token",
    service: "OAuth token endpoint"
  });

  if (!token.access_token) throw new CliError("OAuth token response did not include access_token");
  return token;
}

function createCallbackServer(expectedState: string): Promise<{
  redirectUri: string;
  waitForCode(authorizeUrl: string): Promise<string>;
  close(): Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let resolveCode: ((code: string) => void) | null = null;
    let rejectCode: ((error: Error) => void) | null = null;

    const server = createServer((request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        response.writeHead(400, { "Content-Type": "text/plain" });
        response.end("Nitrosend CLI login failed. You can close this tab.");
        rejectCode?.(new CliError(`OAuth authorization failed: ${error}`));
        return;
      }

      if (!code || state !== expectedState) {
        response.writeHead(400, { "Content-Type": "text/plain" });
        response.end("Invalid Nitrosend CLI login callback.");
        rejectCode?.(new CliError("Invalid OAuth callback state"));
        return;
      }

      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("Nitrosend CLI login complete. You can close this tab.");
      resolveCode?.(code);
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new CliError("Could not bind OAuth callback server"));
        return;
      }

      settled = true;
      resolve({
        redirectUri: `http://127.0.0.1:${address.port}/callback`,
        waitForCode(authorizeUrl: string) {
          return new Promise<string>((codeResolve, codeReject) => {
            resolveCode = codeResolve;
            rejectCode = codeReject;
            setTimeout(() => {
              codeReject(new CliError(`Timed out waiting for OAuth callback. Open this URL manually: ${authorizeUrl}`));
            }, 5 * 60 * 1000).unref();
          });
        },
        close() {
          return new Promise((closeResolve) => server.close(() => closeResolve()));
        }
      });
    });

    setTimeout(() => {
      if (!settled) reject(new CliError("Timed out starting OAuth callback server"));
    }, 10_000).unref();
  });
}

function openUrl(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
