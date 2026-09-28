/**
 * The tools Claude can use, and how their results are presented.
 *
 * The same buildServer() is used by the local version (src/local.ts) and the
 * Cloudflare version (src/worker.ts), so both always behave identically.
 *
 * Results are turned into short readable text rather than raw API output.
 * Anything sensitive that SourceWhale returns but nobody asked for (team phone
 * numbers, diversity breakdowns) is left out on purpose.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { callSourceWhale, type ApiResult } from "./sourcewhale";

export type ServerSettings = {
  apiKey: string;
  /** Only when this is true are the add/modify tools offered to Claude. */
  enableWriteTools: boolean;
};

// ---------------------------------------------------------------------------
// Shapes of the SourceWhale responses we use (confirmed against live data)
// ---------------------------------------------------------------------------

type Campaign = {
  campaignId: string;
  campaignName: string;
  sourced?: number;
  sent?: number;
  openedProp?: number;
  repliedProp?: number;
  interestedProp?: number;
  bookedProp?: number;
};

type Project = { projectId: string; projectName: string };

type Candidate = Record<string, unknown> & {
  candidateId?: string;
  name?: string;
  projectIds?: string[];
};

type ActivityCounts = Record<string, number>;

type Dashboard = {
  counts?: Record<string, Record<string, ActivityCounts>>;
  team?: { userId?: string; userIds?: string[]; name?: string; email?: string }[];
};

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

const text = (body: string) => ({ content: [{ type: "text" as const, text: body }] });
const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

const percent = (value?: number) => (typeof value === "number" ? `${Math.round(value * 100)}%` : "n/a");

function campaignLine(c: Campaign, withMetrics: boolean): string {
  if (!withMetrics) return `- ${c.campaignName.trim()} (id: ${c.campaignId})`;
  return (
    `- ${c.campaignName.trim()} (id: ${c.campaignId})\n` +
    `  sourced ${c.sourced ?? "n/a"}, sent ${c.sent ?? "n/a"}, opened ${percent(c.openedProp)}, ` +
    `replied ${percent(c.repliedProp)}, interested ${percent(c.interestedProp)}, booked ${percent(c.bookedProp)}`
  );
}

/** SourceWhale sends dates as seconds since 1970 (confirmed on live data). Show them as YYYY-MM-DD. */
function formatDate(value: unknown): string | undefined {
  if (typeof value === "number" && value > 0) {
    const ms = value < 1e12 ? value * 1000 : value; // tolerate milliseconds too
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof value === "string" && value) return value.slice(0, 10);
  return undefined;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD, for example 2026-09-01");

const userEmailField = z
  .string()
  .optional()
  .describe("Optional. Limit results to one SourceWhale user's records, by their login email.");

// Shared lookup used by several tools.
async function fetchCampaigns(settings: ServerSettings, withMetrics: boolean, userEmail?: string) {
  return callSourceWhale<{ campaigns?: Campaign[] }>(settings.apiKey, "GET", "/v1/campaigns/list", {
    // The API wants the text "true" here; leaving it out turns metrics off.
    params: { userEmail, includeMetrics: withMetrics ? "true" : undefined },
  });
}

async function fetchProjectNames(settings: ServerSettings): Promise<Map<string, string>> {
  const result = await callSourceWhale<{ projects?: Project[] }>(settings.apiKey, "GET", "/v1/projects/list");
  const names = new Map<string, string>();
  if (result.ok) for (const p of result.data.projects ?? []) names.set(p.projectId, p.projectName);
  return names;
}

// ---------------------------------------------------------------------------
// The server and its tools
// ---------------------------------------------------------------------------

export function buildServer(settings: ServerSettings): McpServer {
  const server = new McpServer({ name: "sourcewhale", version: "1.0.0" });
  const readOnly = { readOnlyHint: true, openWorldHint: true };

  // ---- list_campaigns ------------------------------------------------------
  server.registerTool(
    "list_campaigns",
    {
      title: "List SourceWhale campaigns",
      description:
        "List the outreach campaigns in SourceWhale, with each campaign's ID. " +
        "Set include_metrics to also show sourced, sent, and open/reply/interested/booked rates. " +
        "Use this to find a campaign's ID or to compare campaign performance.",
      inputSchema: z.object({
        include_metrics: z.boolean().optional().describe("Show performance numbers for each campaign. Defaults to false."),
        user_email: userEmailField,
      }),
      annotations: readOnly,
    },
    async ({ include_metrics, user_email }) => {
      const result = await fetchCampaigns(settings, include_metrics ?? false, user_email);
      if (!result.ok) return failure(result.message);
      const campaigns = result.data.campaigns ?? [];
      if (campaigns.length === 0) return text("No campaigns found.");
      return text(
        `${campaigns.length} campaigns returned by SourceWhale. The API has no paging, so if the ` +
          `SourceWhale app shows more than this, the list may be incomplete.\n\n` +
          campaigns.map((c) => campaignLine(c, include_metrics ?? false)).join("\n"),
      );
    },
  );

  // ---- get_campaign_stats --------------------------------------------------
  server.registerTool(
    "get_campaign_stats",
    {
      title: "Get statistics for a campaign",
      description:
        "Get performance numbers for one campaign: people sourced, messages sent, and the share opened, " +
        "replied, interested and booked. Give the campaign's ID or part of its name. " +
        "Rates are as SourceWhale reports them.",
      inputSchema: z.object({
        campaign: z.string().min(1).describe("The campaign ID, or part of the campaign name (not case sensitive)."),
      }),
      annotations: readOnly,
    },
    async ({ campaign }) => {
      const result = await fetchCampaigns(settings, true);
      if (!result.ok) return failure(result.message);
      const search = campaign.trim().toLowerCase();
      const matches = (result.data.campaigns ?? []).filter(
        (c) => c.campaignId === campaign.trim() || c.campaignName.toLowerCase().includes(search),
      );
      if (matches.length === 0) return text(`No campaign matched "${campaign}". Use list_campaigns to see the names.`);
      const header = matches.length > 1 ? `${matches.length} campaigns matched "${campaign}":\n\n` : "";
      return text(header + matches.map((c) => campaignLine(c, true)).join("\n"));
    },
  );

  // ---- get_activity_stats --------------------------------------------------
  server.registerTool(
    "get_activity_stats",
    {
      title: "Get team activity for a date range",
      description:
        "Get SourceWhale dashboard activity for a date range: totals for sourced, sent, opened, clicked, " +
        "replied, interested, not interested and booked, broken down by team member and by type " +
        "(business development or candidate sourcing). Not broken down by campaign.",
      inputSchema: z.object({
        date_from: isoDate.describe("Start date, YYYY-MM-DD."),
        date_to: isoDate.describe("End date, YYYY-MM-DD."),
      }),
      annotations: readOnly,
    },
    async ({ date_from, date_to }) => {
      const result: ApiResult<Dashboard> = await callSourceWhale<Dashboard>(settings.apiKey, "GET", "/v1/statistics/dashboard", {
        params: { from: date_from, to: date_to },
      });
      if (!result.ok) return failure(result.message);
      return text(summariseDashboard(result.data, date_from, date_to));
    },
  );

  // ---- list_projects -------------------------------------------------------
  server.registerTool(
    "list_projects",
    {
      title: "List SourceWhale projects",
      description: "List the projects in SourceWhale (the folders candidates are grouped into), with each project's ID.",
      inputSchema: z.object({ user_email: userEmailField }),
      annotations: readOnly,
    },
    async ({ user_email }) => {
      const result = await callSourceWhale<{ projects?: Project[] }>(settings.apiKey, "GET", "/v1/projects/list", {
        params: { userEmail: user_email },
      });
      if (!result.ok) return failure(result.message);
      const projects = result.data.projects ?? [];
      if (projects.length === 0) return text("No projects found.");
      return text(
        `${projects.length} projects:\n` + projects.map((p) => `- ${p.projectName} (id: ${p.projectId})`).join("\n"),
      );
    },
  );

  // ---- search_candidates ---------------------------------------------------
  server.registerTool(
    "search_candidates",
    {
      title: "Look up a candidate",
      description:
        "Find a person in SourceWhale by an exact identifier: their email address, phone number, " +
        "LinkedIn or other profile URL (socialLink), or photo URL. " +
        "It cannot search by name, company, job title, project or campaign. " +
        "Returns their details, which projects they are in, and their outreach stage.",
      inputSchema: z.object({
        key: z.enum(["email", "phone", "socialLink", "photo"]).describe("Which identifier you are searching by."),
        value: z.string().min(1).describe("The exact value, for example jo@example.com or a LinkedIn profile URL."),
        user_email: userEmailField,
      }),
      annotations: readOnly,
    },
    async ({ key, value, user_email }) => {
      const result = await callSourceWhale<{ candidates?: Candidate[] }>(settings.apiKey, "GET", "/v1/candidates/search", {
        params: { key, value, userEmail: user_email },
      });
      if (!result.ok) return failure(result.message);
      const candidates = result.data.candidates ?? [];
      if (candidates.length === 0) return text(`No candidate found with ${key} "${value}".`);

      const projectNames = await fetchProjectNames(settings);
      const blocks = candidates.map((c) => describeCandidate(c, projectNames));
      return text(
        blocks.join("\n\n") +
          "\n\nNote: the SourceWhale API does not say which campaign a person is in. Projects and outreach stage are shown instead.",
      );
    },
  );

  // ---- Write tools: only offered when switched on ----------------------------
  if (settings.enableWriteTools) registerWriteTools(server, settings);

  return server;
}

// ---------------------------------------------------------------------------
// Write tools (off by default)
// ---------------------------------------------------------------------------

const CANDIDATE_FIELDS =
  "Accepted fields: firstName, lastName, name, salutation, emails (list), phones (list), company, " +
  "previousCompany, role, headline, summary, school, location, city, state, postcode, country, " +
  "companyLocation, socialLinks (list of profile URLs), links (list), companyLinkedinUrl, skills (list), " +
  "industries (list), keywords (list), comments, source, foundBy, customVariable to customVariable4.";

function registerWriteTools(server: McpServer, settings: ServerSettings) {
  server.registerTool(
    "add_candidate",
    {
      title: "Add a candidate to SourceWhale",
      description:
        "Create one new candidate record in SourceWhale, optionally placing them in a campaign or projects. " +
        "This changes live data. It never starts sending outreach; sending is started from the SourceWhale app. " +
        "Always confirm the details with the user before calling this.",
      inputSchema: z.object({
        candidate: z.record(z.string(), z.unknown()).describe(`The person's details. ${CANDIDATE_FIELDS}`),
        campaign_id: z.string().optional().describe("Optional campaign ID (from list_campaigns) to add them to."),
        project_ids: z.array(z.string()).optional().describe("Optional project IDs (from list_projects) to add them to."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ candidate, campaign_id, project_ids }) => {
      const result = await callSourceWhale(settings.apiKey, "POST", "/v1/candidates/add", {
        body: { candidates: [candidate], campaignId: campaign_id, projectIds: project_ids, sendImmediately: false },
      });
      if (!result.ok) return failure(result.message);
      return text("Candidate added to SourceWhale. No outreach has been sent.");
    },
  );

  server.registerTool(
    "modify_candidate",
    {
      title: "Update a candidate in SourceWhale",
      description:
        "Change details on an existing SourceWhale candidate. Find their candidate ID with search_candidates first. " +
        "This overwrites live data. Always confirm the exact changes with the user before calling this.",
      inputSchema: z.object({
        candidate_id: z.string().min(1).describe("The candidate's SourceWhale ID."),
        updates: z.record(z.string(), z.unknown()).describe(`Only the fields to change. ${CANDIDATE_FIELDS}`),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ candidate_id, updates }) => {
      const result = await callSourceWhale(settings.apiKey, "POST", "/v1/candidates/modify", {
        body: { candidate: { ...updates, candidateId: candidate_id } },
      });
      if (!result.ok) return failure(result.message);
      return text(`Candidate ${candidate_id} updated.`);
    },
  );
}

// ---------------------------------------------------------------------------
// Result summaries
// ---------------------------------------------------------------------------

function describeCandidate(c: Candidate, projectNames: Map<string, string>): string {
  const lines: string[] = [];
  const add = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    lines.push(`${label}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
  };

  add("Name", c.name);
  add("Candidate ID", c.candidateId);
  add("Role", c.role);
  add("Company", c.company);
  add("Location", c.location);
  add("Emails", c.emails);
  add("Profile links", c.socialLinks);
  const projects = (c.projectIds ?? []).map((id) => projectNames.get(id) ?? `Unknown project (${id})`);
  add("Projects", projects.length ? projects : undefined);
  add("Outreach stage", c.stage);
  add("Status", c.status);
  add("Opens", c.opens);
  add("Clicks", c.clicks);
  add("Added to SourceWhale", formatDate(c.createdAt));
  add("Last contacted", formatDate(c.lastContacted));
  add("Last activity", formatDate(c.lastActivity));
  return lines.join("\n");
}

const ACTIVITY_FIELDS = ["sourced", "sent", "opened", "clicked", "replied", "interested", "notInterested", "booked"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  businessDevelopment: "Business development",
  candidateSourcing: "Candidate sourcing",
  null: "Uncategorised",
};

function summariseDashboard(data: Dashboard, from: string, to: string): string {
  const counts = data.counts ?? {};

  // Work out each user ID's name from the team list.
  const nameById = new Map<string, string>();
  for (const member of data.team ?? []) {
    const label = member.name || member.email || "Unnamed user";
    for (const id of [member.userId, ...(member.userIds ?? [])]) if (id) nameById.set(id, label);
  }

  const emptyTotals = () => Object.fromEntries(ACTIVITY_FIELDS.map((f) => [f, 0])) as Record<string, number>;
  const byPerson = new Map<string, Record<string, number>>();
  const byCategory = new Map<string, Record<string, number>>();
  const overall = emptyTotals();

  for (const [userId, categories] of Object.entries(counts)) {
    const person = nameById.get(userId) ?? `Other user (${userId.slice(0, 8)})`;
    if (!byPerson.has(person)) byPerson.set(person, emptyTotals());
    for (const [category, numbers] of Object.entries(categories ?? {})) {
      if (!byCategory.has(category)) byCategory.set(category, emptyTotals());
      for (const field of ACTIVITY_FIELDS) {
        const n = Number(numbers?.[field] ?? 0);
        byPerson.get(person)![field] += n;
        byCategory.get(category)![field] += n;
        overall[field] += n;
      }
    }
  }

  const row = (t: Record<string, number>) =>
    `sourced ${t.sourced}, sent ${t.sent}, opened ${t.opened}, clicked ${t.clicked}, replied ${t.replied}, ` +
    `interested ${t.interested}, not interested ${t.notInterested}, booked ${t.booked}`;

  const out = [`SourceWhale activity from ${from} to ${to}`, "", `Whole team: ${row(overall)}`, "", "By team member:"];
  for (const [person, totals] of byPerson) out.push(`- ${person}: ${row(totals)}`);
  out.push("", "By type:");
  for (const [category, totals] of byCategory) out.push(`- ${CATEGORY_LABELS[category] ?? category}: ${row(totals)}`);
  return out.join("\n");
}
