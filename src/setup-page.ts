/**
 * The setup page shown at the server's home address.
 *
 * While setup is unfinished, it runs live checks on every setting (including
 * asking Microsoft whether the client secret is genuine) and says exactly what
 * to fix. Once everything passes, it shows the connector address for the
 * Claude Owner and nothing sensitive.
 *
 * Check results are cached for five minutes, keyed on the current settings, so
 * refreshing the page cannot be used to hammer SourceWhale or Microsoft.
 */

import { callSourceWhale } from "./sourcewhale";
import { copyBox, escapeHtml, htmlPage } from "./html";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_SECONDS = 300;

export type MicrosoftConfig = { tenantId: string; clientId: string; clientSecret: string };

/** The Microsoft settings, if all three are present and well formed. */
export function microsoftConfig(env: Env): MicrosoftConfig | null {
  const tenantId = (env.MICROSOFT_TENANT_ID ?? "").trim();
  const clientId = (env.MICROSOFT_CLIENT_ID ?? "").trim();
  const clientSecret = (env.MICROSOFT_CLIENT_SECRET ?? "").trim();
  if (!GUID.test(tenantId) || !GUID.test(clientId) || !clientSecret || GUID.test(clientSecret)) return null;
  return { tenantId, clientId, clientSecret };
}

/** Quick offline test used before every sign-in: is everything at least present? */
export function isConfigured(env: Env): boolean {
  return Boolean((env.SOURCEWHALE_API_KEY ?? "").trim()) && microsoftConfig(env) !== null;
}

type Check = { label: string; state: "ok" | "bad" | "info"; detail: string };

// ---------------------------------------------------------------------------
// Live checks
// ---------------------------------------------------------------------------

async function runChecks(env: Env): Promise<Check[]> {
  const checks: Check[] = [];
  const key = (env.SOURCEWHALE_API_KEY ?? "").trim();
  const tenantId = (env.MICROSOFT_TENANT_ID ?? "").trim();
  const clientId = (env.MICROSOFT_CLIENT_ID ?? "").trim();
  const secret = (env.MICROSOFT_CLIENT_SECRET ?? "").trim();

  // 1. SourceWhale key: try a harmless read.
  if (!key) {
    checks.push({ label: "SourceWhale API key", state: "bad", detail: "Not set. Add SOURCEWHALE_API_KEY as a Secret." });
  } else {
    const result = await callSourceWhale<{ projects?: unknown[] }>(key, "GET", "/v1/projects/list");
    checks.push(
      result.ok
        ? { label: "SourceWhale API key", state: "ok", detail: "SourceWhale accepted the key." }
        : { label: "SourceWhale API key", state: "bad", detail: result.message },
    );
  }

  // 2. Tenant ID: must be a real Microsoft 365 tenant.
  let tenantOk = false;
  if (!tenantId) {
    checks.push({ label: "Microsoft tenant ID", state: "bad", detail: "Not set. Add MICROSOFT_TENANT_ID (the Directory (tenant) ID)." });
  } else if (!GUID.test(tenantId)) {
    checks.push({ label: "Microsoft tenant ID", state: "bad", detail: "This does not look like a tenant ID. It should look like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx." });
  } else {
    const r = await fetch(`https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`);
    tenantOk = r.ok;
    checks.push(
      tenantOk
        ? { label: "Microsoft tenant ID", state: "ok", detail: "Microsoft recognises this organisation." }
        : {
            label: "Microsoft tenant ID",
            state: "bad",
            detail: "Microsoft does not recognise this as an organisation. Check you copied the Directory (tenant) ID, not the Application (client) ID.",
          },
    );
  }

  // 3. Client ID: format only (checked properly with the secret below).
  const clientIdOk = GUID.test(clientId) && clientId.toLowerCase() !== tenantId.toLowerCase();
  if (!clientId) {
    checks.push({ label: "Microsoft client ID", state: "bad", detail: "Not set. Add MICROSOFT_CLIENT_ID (the Application (client) ID)." });
  } else if (!clientIdOk) {
    checks.push({ label: "Microsoft client ID", state: "bad", detail: "This does not look right. Use the Application (client) ID, which is different from the tenant ID." });
  }

  if (clientIdOk && !(tenantOk && secret && !GUID.test(secret))) {
    checks.push({ label: "Microsoft client ID", state: "info", detail: "Set. It is tested together with the client secret." });
  }

  // 4. Client secret: ask Microsoft directly whether it is genuine.
  if (!secret) {
    checks.push({ label: "Microsoft client secret", state: "bad", detail: "Not set. Add MICROSOFT_CLIENT_SECRET as a Secret." });
  } else if (GUID.test(secret)) {
    checks.push({
      label: "Microsoft client secret",
      state: "bad",
      detail: "This is the Secret ID, not the secret. In Entra, copy the Value column instead. If it is hidden, create a new client secret.",
    });
  } else if (tenantOk && clientIdOk) {
    const verdict = await testClientSecret(tenantId, clientId, secret);
    if (verdict.ok) {
      checks.push({ label: "Microsoft client ID", state: "ok", detail: "Microsoft recognises this app." });
      checks.push({ label: "Microsoft client secret", state: "ok", detail: "Microsoft accepted the secret." });
    } else {
      checks.push({ label: "Microsoft client ID and secret", state: "bad", detail: verdict.message });
    }
  } else {
    checks.push({ label: "Microsoft client secret", state: "info", detail: "Set. It will be tested once the tenant ID and client ID are right." });
  }

  // 5. Options (information only).
  const allowed = (env.ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  checks.push({
    label: "Who can connect",
    state: "info",
    detail: allowed.length
      ? `${allowed.length} named ${allowed.length === 1 ? "person" : "people"} (ALLOWED_EMAILS).`
      : "Anyone with a Microsoft account in your organisation. Set ALLOWED_EMAILS to limit this.",
  });
  checks.push({
    label: "Write tools",
    state: "info",
    detail: env.ENABLE_WRITE_TOOLS === "true" ? "On: Claude can add and change candidates." : "Off: Claude can only read. (Recommended.)",
  });

  return checks;
}

/** Ask Microsoft for an app-only token. Success proves the client ID and secret belong together. */
async function testClientSecret(tenantId: string, clientId: string, secret: string) {
  const r = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  if (r.ok) return { ok: true as const };

  const body = (await r.json().catch(() => ({}))) as { error_codes?: number[] };
  const codes = body.error_codes ?? [];
  const has = (code: number) => codes.includes(code);
  let message = `Microsoft refused the sign-in details (code AADSTS${codes.join(", AADSTS") || r.status}).`;
  if (has(7000215)) message = "Microsoft rejected the client secret. Copy the Value (not the Secret ID) of a new client secret and save it again.";
  if (has(7000222)) message = "The client secret has expired. Create a new client secret in Entra and save its Value.";
  if (has(700016)) message = "Microsoft cannot find an app with this client ID in your organisation. Recopy the Application (client) ID.";
  return { ok: false as const, message };
}

/** Cached wrapper, keyed on a fingerprint of the current settings. */
async function cachedChecks(env: Env): Promise<Check[]> {
  const fingerprint = await sha256(
    [env.SOURCEWHALE_API_KEY, env.MICROSOFT_TENANT_ID, env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET, env.ALLOWED_EMAILS, env.ENABLE_WRITE_TOOLS]
      .map((v) => v ?? "")
      .join("\u0000"),
  );
  const cacheKey = `setup-check:${fingerprint}`;
  const cached = await env.OAUTH_KV.get<Check[]>(cacheKey, "json");
  if (cached) return cached;

  const checks = await runChecks(env);
  await env.OAUTH_KV.put(cacheKey, JSON.stringify(checks), { expirationTtl: CACHE_SECONDS });
  return checks;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export async function renderSetupPage(request: Request, env: Env): Promise<Response> {
  const origin = new URL(request.url).origin;
  const checks = await cachedChecks(env);
  const ready = checks.every((c) => c.state !== "bad");

  if (ready) return readyPage(origin, checks);
  return checklistPage(origin, checks);
}

function checkList(checks: Check[]): string {
  const mark = { ok: "✓", bad: "✗", info: "•" };
  return checks
    .map(
      (c) =>
        `<div class="check"><span class="mark ${c.state}">${mark[c.state]}</span>` +
        `<div><strong>${escapeHtml(c.label)}</strong><br>${escapeHtml(c.detail)}</div></div>`,
    )
    .join("");
}

function readyPage(origin: string, checks: Check[]): Response {
  return htmlPage(
    "SourceWhale connector: ready",
    `<h1>SourceWhale connector for Claude</h1>
     <div class="banner ok"><strong>Setup complete.</strong> Everything checks out.</div>

     <h2>For your Claude Owner</h2>
     <p>In Claude, go to <strong>Organization settings, Connectors, Add, Custom, Web</strong>. Name it <code>SourceWhale</code> and use this URL:</p>
     ${copyBox(`${origin}/mcp`)}
     <p>For <strong>OAuth client</strong>, choose <strong>Use Claude's published identity</strong>. If connecting fails, switch it to <strong>Register automatically</strong>.</p>

     <h2>For everyone else</h2>
     <p>In Claude, go to <strong>Customize, Connectors</strong>, click <strong>Connect</strong> next to SourceWhale, then sign in with your Microsoft work account.</p>

     <h2>Current settings</h2>
     ${checkList(checks.filter((c) => c.state === "info"))}
     <p><small>This page re-checks the settings whenever they change.</small></p>`,
  );
}

function checklistPage(origin: string, checks: Check[]): Response {
  const host = new URL(origin).hostname;
  // On a workers.dev address, the first part is the Worker's name, which lets us link straight to its settings.
  const workerName = host.endsWith(".workers.dev") ? host.split(".")[0] : "";
  const settingsLink = workerName
    ? `https://dash.cloudflare.com/?to=/:account/workers/services/view/${encodeURIComponent(workerName)}/production/settings`
    : "https://dash.cloudflare.com/?to=/:account/workers-and-pages";

  return htmlPage(
    "SourceWhale connector: finish setup",
    `<h1>SourceWhale connector for Claude</h1>
     <div class="banner bad"><strong>Setup is not finished yet.</strong> Fix the items marked ✗, then refresh this page. Changes can take a minute to show.</div>
     ${checkList(checks)}

     <h2>Step 1. Register the sign-in app in Microsoft Entra</h2>
     <p>Your Microsoft 365 admin does this at <a href="https://entra.microsoft.com" target="_blank" rel="noopener">entra.microsoft.com</a>:</p>
     <ol>
       <li><strong>Entra ID</strong> (or <strong>Identity, Applications</strong>), then <strong>App registrations</strong>, then <strong>New registration</strong>.</li>
       <li>Name: <code>SourceWhale connector for Claude</code></li>
       <li>Supported account types: <strong>Accounts in this organizational directory only</strong>.</li>
       <li>Redirect URI: choose <strong>Web</strong> and paste:${copyBox(`${origin}/callback`)}</li>
       <li>Click <strong>Register</strong>. From the Overview page, note the <strong>Application (client) ID</strong> and <strong>Directory (tenant) ID</strong>.</li>
       <li><strong>Certificates &amp; secrets</strong>, <strong>New client secret</strong>, expiry 24 months, <strong>Add</strong>. Copy the <strong>Value</strong> column, <em>not</em> the Secret ID. Microsoft shows it only once.</li>
       <li>Recommended: <strong>API permissions</strong>, then <strong>Grant admin consent</strong>, so staff are not asked individually.</li>
     </ol>

     <h2>Step 2. Enter the settings in Cloudflare</h2>
     <p>Open <a href="${settingsLink}" target="_blank" rel="noopener">this Worker's settings in Cloudflare</a>, go to <strong>Variables and Secrets</strong>, click <strong>Add</strong> for each of these, then <strong>Deploy</strong>:</p>
     <table>
       <tr><th>Name</th><th>Type</th><th>Value</th></tr>
       <tr><td><code>MICROSOFT_TENANT_ID</code></td><td>Text</td><td>Directory (tenant) ID</td></tr>
       <tr><td><code>MICROSOFT_CLIENT_ID</code></td><td>Text</td><td>Application (client) ID</td></tr>
       <tr><td><code>MICROSOFT_CLIENT_SECRET</code></td><td>Secret</td><td>The client secret Value</td></tr>
       <tr><td><code>SOURCEWHALE_API_KEY</code></td><td>Secret</td><td>Only if not given in the Deploy form</td></tr>
       <tr><td><code>ALLOWED_EMAILS</code></td><td>Text</td><td>Optional: emails allowed to connect, separated by commas</td></tr>
     </table>
     <p>Then come back and refresh this page. It turns green when everything works.</p>`,
  );
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
