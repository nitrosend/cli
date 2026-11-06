import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import { currentProfile, defaultApiUrl, deleteCurrentProfile, namedProfile, Profile, storeProfile } from "./config.js";
import { CliError } from "./errors.js";
import { fetchJson, fetchText, httpError, parseJsonBody, restApiBase } from "./http.js";

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

  // A named profile (--profile, or profile: in .nitrosend.yml) is used as
  // named; otherwise the one last logged in.
  const profile = profileName ? await namedProfile(profileName) : await currentProfile();
  if (!profile) {
    const login = profileName ? `nitrosend login --profile ${profileName} --api-key ...` : "nitrosend login --api-key ...";
    throw new CliError(
      profileName ? `Profile ${profileName} is not logged in. Run \`${login}\`.` : "Not logged in. Run `nitrosend login --api-key ...` or set NITROSEND_API_KEY.",
      {
        code: "not_authenticated",
        exitCodeName: "permission",
        nextAction: profileName ? `Run \`${login}\`.` : "Run `nitrosend login --api-key ...` or set NITROSEND_API_KEY."
      }
    );
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

export interface SignupOptions {
  email: string;
  password: string;
  profile: string;
  apiUrl?: string;
  attribution?: Record<string, string>;
  fetcher?: typeof fetch;
}

export interface PendingSignup {
  status: "verification_required";
  next_action: string;
}

export async function signupWithPassword(options: SignupOptions): Promise<PendingSignup> {
  const apiUrl = options.apiUrl || defaultApiUrl();
  const base = restApiBase(apiUrl);
  const json = { "Accept": "application/json", "Content-Type": "application/json" };

  const signup = await fetchText(`${base}/v1/signup`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      user: {
        email: options.email,
        password: options.password,
        ...(options.attribution && Object.keys(options.attribution).length > 0
          ? { attribution_context: options.attribution }
          : {})
      }
    })
  }, { fetcher: options.fetcher, name: "POST signup", service: "Nitrosend API", bodyPreview: "never" });
  const body = parseJsonBody<{ error_code?: string }>(signup);
  if (signup.status === 409 && body?.error_code === "verification_required") {
    return { status: "verification_required", next_action: "Read the verification email, then pipe JSON with token and a final password to `nitrosend signup verify --verification-stdin`. No profile has changed." };
  }
  if (!signup.ok) throw httpError(signup, body);
  throw new CliError("The server did not return the required verification step. No profile has changed.", {
    code: "signup_protocol_mismatch", exitCodeName: "data"
  });
}

export async function resendSignupVerification(options: Pick<SignupOptions, "email" | "apiUrl" | "fetcher">): Promise<PendingSignup> {
  await fetchJson(`${restApiBase(options.apiUrl || defaultApiUrl())}/v1/signup/resend`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: options.email })
  }, { fetcher: options.fetcher, name: "POST signup resend", service: "Nitrosend API", bodyPreview: "never" });
  return { status: "verification_required", next_action: "If this address is eligible, check its inbox. Run `nitrosend signup verify --verification-stdin` with JSON containing token and your final password." };
}

export async function completeSignup(options: Pick<SignupOptions, "profile" | "apiUrl" | "fetcher"> & (
  { token: string; password: string } | { email: string; password: string }
)): Promise<Profile> {
  const apiUrl = options.apiUrl || defaultApiUrl();
  const base = restApiBase(apiUrl);
  const json = { "Accept": "application/json", "Content-Type": "application/json" };
  const verifying = "token" in options;
  const signup = await fetchText(`${base}/v1/signup/${verifying ? "verify" : "activate"}`, {
    method: "POST", headers: json,
    body: JSON.stringify(verifying ? { token: options.token, password: options.password } : { email: options.email, password: options.password })
  }, { fetcher: options.fetcher, name: "POST signup completion", service: "Nitrosend API", bodyPreview: "never" });
  if (!signup.ok) {
    const error = httpError(signup, parseJsonBody<unknown>(signup));
    throw new CliError(error.message, {
      code: error.code, exitCode: error.exitCode, retriable: error.retriable,
      nextAction: "If email verification already succeeded, use `nitrosend signup resume --email <email> --password-stdin` with your final password. Otherwise request a new link with `nitrosend signup resend --email <email>`."
    });
  }

  const session = signup.headers.get("authorization");
  if (!session?.startsWith("Bearer ")) {
    throw new CliError("Signup succeeded but returned no session token.", {
      code: "signup_session_missing",
      exitCodeName: "data",
      nextAction: "Sign in at https://app.nitrosend.com and create an API key, then run `nitrosend login --api-key ...`."
    });
  }

  try {
    const key = await fetchJson<{ secret_key?: string; api_key?: { secret_key?: string } }>(`${base}/v1/my/api_keys`, {
    method: "POST",
    headers: { ...json, "Authorization": session },
    body: JSON.stringify({ name: "Nitrosend CLI" })
  }, { fetcher: options.fetcher, name: "POST create API key", service: "Nitrosend API", bodyPreview: "never" });
  const secret = key.secret_key ?? key.api_key?.secret_key;
  if (!secret) {
    throw new CliError("The account was created but no API key secret came back.", {
      code: "api_key_secret_missing",
      exitCodeName: "data",
      nextAction: "Create a key under Settings > API Keys at https://app.nitrosend.com, then run `nitrosend login --api-key ...`."
    });
  }

    return await loginWithApiKey(secret, { profile: options.profile, apiUrl });
  } catch {
    // Neither provider error bodies nor a failed file write may reveal the
    // short-lived session or new key. The account can be recovered separately.
    throw new CliError("Your account is active, but its CLI profile could not be saved.", {
      code: "signup_profile_incomplete", exitCodeName: "temporary", retriable: true,
      nextAction: "Retry with `nitrosend signup resume --email <email> --password-stdin` using your final password and the same --profile and --api-url. Review unused keys in Settings > API Keys."
    });
  }
}

export async function logout(): Promise<string | null> {
  return deleteCurrentProfile();
}

export async function loginWithOAuth(options: {
  profile: string;
  apiUrl?: string;
  openBrowser?: boolean;
  notice?: (text: string) => void;
}): Promise<Profile> {
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

    // The URL goes to stderr before the wait starts, so --no-browser, a remote
    // shell, or a browser that never opened still has a way to sign in.
    const notice = options.notice ?? ((text: string) => process.stderr.write(text));
    if (options.openBrowser !== false) {
      openUrl(authorizeUrl.toString());
      notice(`Opening your browser to sign in. If it does not open, visit:\n  ${authorizeUrl}\n`);
    } else {
      notice(`Open this URL in a browser to sign in:\n  ${authorizeUrl}\n`);
    }
    notice("Waiting up to 5 minutes for the sign-in to finish.\n");

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
  const { command, args } = browserCommand(url);
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
}

// Windows opens the URL through the shell's URL handler, never `cmd /c start`,
// which splits the URL at every `&` and drops the OAuth parameters.
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  return { command: "xdg-open", args: [url] };
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
