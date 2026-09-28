/**
 * The hosted version of the SourceWhale MCP server, for Cloudflare Workers.
 *
 * Claude connects to https://<your-worker-address>/mcp. Every request to /mcp
 * must carry a token that Claude only receives after the person has signed in
 * with Microsoft (see microsoft-login.ts). Without it, the server answers
 * "401 Unauthorized" and returns no data.
 *
 * Settings live in wrangler.jsonc ("vars") and in Cloudflare secrets. See README.
 */

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { buildServer } from "./tools";
import { isAllowedUser, loginHandler, type SignedInUser } from "./microsoft-login";

// The part that answers Claude's tool calls. Only reached with a valid token.
const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const user = ctx.props as SignedInUser | undefined;
    // Re-check the approved email list on every request, so removing someone
    // from ALLOWED_EMAILS takes effect straight away, not when their token expires.
    const email = user?.email ?? "";
    if (!email || !isAllowedUser(email, env)) {
      return new Response("This account is no longer allowed to use the SourceWhale connector.", { status: 403 });
    }

    const settings = {
      apiKey: env.SOURCEWHALE_API_KEY ?? "",
      enableWriteTools: env.ENABLE_WRITE_TOOLS === "true",
    };
    return createMcpHandler(() => buildServer(settings), { route: "/mcp" })(request, env, ctx);
  },
};

// The sign-in library needs this server's own public address. Rather than make
// you type it into a setting, we read it from the first request and build the
// provider once per address.
const providers = new Map<string, OAuthProvider<Env>>();

function providerFor(origin: string): OAuthProvider<Env> {
  let provider = providers.get(origin);
  if (!provider) {
    provider = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: mcpHandler,
      defaultHandler: loginHandler,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",
      // Lets Claude identify itself with a published metadata document.
      clientIdMetadataDocumentEnabled: true,
      resourceMetadata: {
        resource: `${origin}/mcp`,
        resource_name: "SourceWhale",
      },
    });
    providers.set(origin, provider);
  }
  return provider;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return providerFor(new URL(request.url).origin).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
