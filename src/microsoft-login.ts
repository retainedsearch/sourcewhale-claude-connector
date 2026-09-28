/**
 * Sign-in pages for the hosted (Cloudflare) version.
 *
 * When someone connects this server in Claude, they are sent here. The flow:
 *   1. /authorize (GET)  Check the request comes from Claude, then show a
 *                        short "Allow Claude to access SourceWhale?" page.
 *   2. /authorize (POST) They click Allow. We send them to Microsoft to sign in.
 *   3. /callback         Microsoft sends them back. We check the account belongs
 *                        to the organisation's Microsoft 365 tenant (and, if
 *                        set, is on the approved email list), then hand Claude
 *                        its access token.
 *
 * The home page (/) is the setup checklist, see setup-page.ts.
 *
 * The security plumbing (one-time codes, browser-bound cookies, encrypted
 * storage) is done by Cloudflare's workers-oauth-provider library.
 */

import { AuthorizationError, CimdFetchError, type AuthRequest, type ClientInfo, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { escapeHtml, htmlPage } from "./html";
import { isConfigured, microsoftConfig, renderSetupPage, type MicrosoftConfig } from "./setup-page";

type LoginEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

/** What we remember about the signed-in person, attached to their Claude token. */
export type SignedInUser = { email: string; name: string };

// Claude's official return addresses for connectors.
const CLAUDE_CALLBACKS = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"];

export const loginHandler = {
  async fetch(request: Request, plainEnv: Env): Promise<Response> {
    // The sign-in library adds its helpers to env as OAUTH_PROVIDER.
    const env = plainEnv as LoginEnv;
    const { pathname } = new URL(request.url);

    if (pathname === "/" && request.method === "GET") return renderSetupPage(request, env);

    if (!isConfigured(env)) {
      return htmlPage(
        "Not set up yet",
        `<h1>Not set up yet</h1><p>This connector has not finished setup. Open <a href="/">the setup page</a> to see what is missing.</p>`,
        503,
      );
    }
    const microsoft = microsoftConfig(env)!;

    try {
      if (pathname === "/authorize" && request.method === "GET") return await showConsent(request, env);
      if (pathname === "/authorize" && request.method === "POST") return await handleConsent(request, env, microsoft);
      if (pathname === "/callback" && request.method === "GET") return await handleMicrosoftReturn(request, env, microsoft);
    } catch (error) {
      return handleAuthError(error);
    }

    return message("Not found", "There is nothing at this address.", 404);
  },
};

// ---------------------------------------------------------------------------
// Step 1: the consent page
// ---------------------------------------------------------------------------

async function showConsent(request: Request, env: LoginEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const authRequest = await oauth.parseAuthRequest(request);

  if (!isAllowedReturnAddress(authRequest.redirectUri, env)) {
    return message(
      "App not allowed",
      "Only Claude can connect to this server. If you were trying to connect from Claude, contact your administrator.",
      403,
    );
  }

  const client = await oauth.lookupClient(authRequest.clientId);
  const consent = await oauth.beginConsent(authRequest);

  // Our page, plus the library's security headers (browser-bound cookie, no framing).
  const page = htmlPage("Connect SourceWhale", consentBody(client, authRequest, consent.handle));
  const headers = new Headers(page.headers);
  consent.headers.forEach((value, name) => headers.append(name, value));
  return new Response(page.body, { status: 200, headers });
}

// ---------------------------------------------------------------------------
// Step 2: they clicked Allow or Deny
// ---------------------------------------------------------------------------

async function handleConsent(request: Request, env: LoginEnv, microsoft: MicrosoftConfig): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const form = await request.formData();
  const handle = String(form.get("handle") ?? "");

  if (form.get("decision") !== "approve") {
    const denied = await oauth.denyConsent(request, handle);
    denied.headers.set("Location", denied.redirectTo);
    return new Response(null, { status: 302, headers: denied.headers });
  }

  const approved = await oauth.approveConsent(request, handle);

  // PKCE: a one-time secret proving the Microsoft reply belongs to this sign-in.
  const verifier = randomString();
  const upstream = await oauth.beginUpstream(approved.request, { data: { verifier }, headers: approved.headers });

  const url = new URL(`https://login.microsoftonline.com/${microsoft.tenantId}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", microsoft.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", callbackUrl(request));
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", upstream.state);
  url.searchParams.set("code_challenge", await sha256Base64Url(verifier));
  url.searchParams.set("code_challenge_method", "S256");

  upstream.headers.set("Location", url.href);
  return new Response(null, { status: 302, headers: upstream.headers });
}

// ---------------------------------------------------------------------------
// Step 3: back from Microsoft
// ---------------------------------------------------------------------------

async function handleMicrosoftReturn(request: Request, env: LoginEnv, microsoft: MicrosoftConfig): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const { request: original, data, headers } = await oauth.finishUpstream<{ verifier: string }>(request);
  const params = new URL(request.url).searchParams;

  // They cancelled at Microsoft, or Microsoft refused.
  const code = params.get("code");
  if (params.get("error") || !code) return redirectWithError(original, headers, "Microsoft sign-in was cancelled or failed.");

  const user = await exchangeCodeForUser(code, data.verifier, request, microsoft);
  if (!user) {
    return message(
      "Sign-in failed",
      "Microsoft did not confirm your account. Please try connecting again. If this keeps happening, your administrator can check the setup page at this server's home address.",
      400,
    );
  }

  if (!isAllowedUser(user.email, env)) {
    return message(
      "Access not allowed",
      `${user.email} is not on the list of people allowed to use this connector. Contact your administrator.`,
      403,
    );
  }

  const { redirectTo } = await oauth.completeAuthorization({
    request: original,
    userId: user.id,
    metadata: { label: user.name },
    scope: original.scope,
    props: { email: user.email, name: user.name } satisfies SignedInUser,
  });
  headers.set("Location", redirectTo);
  return new Response(null, { status: 302, headers });
}

/** Swap Microsoft's one-time code for the person's identity, and check it is genuine. */
async function exchangeCodeForUser(code: string, verifier: string, request: Request, microsoft: MicrosoftConfig) {
  const response = await fetch(`https://login.microsoftonline.com/${microsoft.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: microsoft.clientId,
      client_secret: microsoft.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl(request),
      code_verifier: verifier,
    }),
  });
  if (!response.ok) {
    // Log only Microsoft's error codes (e.g. AADSTS7000215 = wrong client secret),
    // never the full body, which can contain request details.
    const body = (await response.json().catch(() => ({}))) as { error?: string; error_codes?: number[] };
    console.error(
      `Microsoft token exchange failed with HTTP ${response.status}: ${body.error ?? "unknown"} ` +
        `(AADSTS${(body.error_codes ?? []).join(", AADSTS")})`,
    );
    return null;
  }

  const { id_token } = (await response.json()) as { id_token?: string };
  if (!id_token) return null;

  // The ID token came straight from Microsoft over HTTPS in exchange for our
  // client secret, so we can read its claims directly. We still check it was
  // issued for this app, by this organisation's tenant, and has not expired.
  const claims = decodeJwtPayload(id_token);
  const tenant = microsoft.tenantId.toLowerCase();
  const valid =
    claims &&
    claims.aud === microsoft.clientId &&
    String(claims.tid).toLowerCase() === tenant &&
    String(claims.iss).toLowerCase() === `https://login.microsoftonline.com/${tenant}/v2.0` &&
    Number(claims.exp) * 1000 > Date.now();
  if (!valid) return null;

  const email = String(claims.email || claims.preferred_username || "").toLowerCase();
  if (!email) return null;
  return { id: String(claims.oid), email, name: String(claims.name || email) };
}

// ---------------------------------------------------------------------------
// Rules: who and what may connect
// ---------------------------------------------------------------------------

function isAllowedReturnAddress(redirectUri: string, env: Env): boolean {
  if (CLAUDE_CALLBACKS.includes(redirectUri)) return true;
  // Optional, for testing from Claude Code or Claude Desktop on your own machine.
  if (env.ALLOW_LOCAL_CLIENTS === "true") {
    const host = new URL(redirectUri).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  }
  return false;
}

/** If ALLOWED_EMAILS is set, only those people may sign in. Empty means anyone in the tenant. */
export function isAllowedUser(email: string, env: Env): boolean {
  const list = (env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.length === 0 || list.includes(email.toLowerCase());
}

// ---------------------------------------------------------------------------
// Pages and small helpers
// ---------------------------------------------------------------------------

function consentBody(client: ClientInfo | null, authRequest: AuthRequest, handle: string): string {
  const appName = escapeHtml(client?.clientName ?? "An app");
  const host = new URL(authRequest.redirectUri).hostname;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host);
  return `<h1>Allow ${appName} to read SourceWhale?</h1>
     <p>You will be asked to sign in with your Microsoft work account. Access will be sent to <strong>${escapeHtml(host)}</strong>.</p>
     ${local ? "<p><strong>This sends access to an app on your own computer.</strong> Only continue if you just started connecting from it.</p>" : ""}
     <form method="post">
       <input type="hidden" name="handle" value="${escapeHtml(handle)}">
       <button name="decision" value="approve">Allow and sign in</button>
       <button name="decision" value="deny" class="secondary">Cancel</button>
     </form>`;
}

/** A simple page with a heading and one message. The message is escaped here. */
function message(title: string, text: string, status: number): Response {
  return htmlPage(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>`, status);
}

function redirectWithError(original: AuthRequest, headers: Headers, description: string): Response {
  const back = new URL(original.redirectUri);
  back.searchParams.set("error", "access_denied");
  back.searchParams.set("error_description", description);
  if (original.state) back.searchParams.set("state", original.state);
  if (original.issuer) back.searchParams.set("iss", original.issuer);
  headers.set("Location", back.href);
  return new Response(null, { status: 302, headers });
}

function handleAuthError(error: unknown): Response {
  // Errors that are safe to send back to the app that asked (the library has already validated it).
  if (error instanceof AuthorizationError && error.redirectUri) {
    const back = new URL(error.redirectUri);
    back.searchParams.set("error", error.code);
    back.searchParams.set("error_description", error.description);
    if (error.state) back.searchParams.set("state", error.state);
    if (error.issuer) back.searchParams.set("iss", error.issuer);
    return Response.redirect(back.href, 302);
  }
  if (error instanceof AuthorizationError) {
    return message("Sign-in problem", `${error.description} Please start connecting again from Claude.`, 400);
  }
  if (error instanceof CimdFetchError) {
    return message("Sign-in problem", "The app trying to connect could not be verified.", 400);
  }
  throw error;
}

function callbackUrl(request: Request): string {
  return new URL("/callback", request.url).href;
}

function randomString(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(Uint8Array.from(atob(part), (c) => c.charCodeAt(0)));
    return JSON.parse(json);
  } catch {
    return null;
  }
}
