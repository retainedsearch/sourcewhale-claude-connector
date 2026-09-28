/**
 * Runs the SourceWhale MCP server on your own computer, for Claude Code or
 * Claude Desktop. Claude starts this file itself and talks to it directly
 * (the "stdio" transport), so nothing is exposed to the internet.
 *
 * Settings come from the .env file in the project folder:
 *   SOURCEWHALE_API_KEY=...        (required)
 *   ENABLE_WRITE_TOOLS=true        (optional, off unless set)
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { buildServer } from "./tools";

// Find .env next to this project, wherever Claude launches us from.
const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const settings = {
  apiKey: (process.env.SOURCEWHALE_API_KEY ?? "").trim(),
  enableWriteTools: process.env.ENABLE_WRITE_TOOLS === "true",
};

// Messages go to stderr: stdout is reserved for talking to Claude.
if (!settings.apiKey) console.error(`No SOURCEWHALE_API_KEY found. Add it to ${envFile}`);

serveStdio(() => buildServer(settings));
