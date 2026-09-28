// Settings are entered in the Cloudflare dashboard (Worker > Settings >
// Variables and Secrets), or in the Deploy button's form, not in
// wrangler.jsonc. Any of them may be missing while setup is in progress, so
// they are all optional here, and the code checks them before use.
interface Env {
  /** Secret. From SourceWhale (admins only): Admin > Settings > Generate API Key (sourcewhale.app/admin#settings). */
  SOURCEWHALE_API_KEY?: string;
  /** From the Microsoft Entra app registration (Directory (tenant) ID). */
  MICROSOFT_TENANT_ID?: string;
  /** From the Microsoft Entra app registration (Application (client) ID). */
  MICROSOFT_CLIENT_ID?: string;
  /** Secret. The client secret VALUE from Entra (not the Secret ID). */
  MICROSOFT_CLIENT_SECRET?: string;
  /** Optional. Comma-separated emails allowed to connect. Empty = anyone in the tenant. */
  ALLOWED_EMAILS?: string;
  /** Optional. "true" turns on the add/modify candidate tools. */
  ENABLE_WRITE_TOOLS?: string;
  /** Optional, testing only. "true" lets Claude Code / Desktop on a local machine connect. */
  ALLOW_LOCAL_CLIENTS?: string;
}
