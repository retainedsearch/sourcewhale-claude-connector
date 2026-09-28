# SourceWhale connector for Claude

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/retainedsearch/sourcewhale-claude-connector)

Lets your organisation's Claude read data from your SourceWhale account. It
runs in **your own** Cloudflare account, with **your own** SourceWhale API key,
and your staff sign in with their Microsoft 365 work accounts. Nobody else hosts
it or holds your key or your data.

Setup takes about 30 minutes, entirely in the browser. No coding or command line.

---

## 1. What it does, and what it does not

**Claude can:**

| Tool | What it does |
| --- | --- |
| `list_campaigns` | Lists campaigns and their IDs, optionally with sourced, sent, opened, replied, interested and booked rates |
| `get_campaign_stats` | The same figures for one campaign, found by ID or part of its name |
| `get_activity_stats` | Team activity for a date range, totalled by team member and by type (business development or candidate sourcing) |
| `list_projects` | Lists projects and their IDs |
| `search_candidates` | Finds a person by exact email, phone, profile URL (such as LinkedIn) or photo URL, and shows their projects and outreach stage |

Two more tools, `add_candidate` and `modify_candidate`, are **off by default**.
See section 5.

**It cannot**, because SourceWhale's public API does not allow it:

- Search people by name, company or job title. Only by exact email, phone, profile URL or photo URL.
- Say which campaign a person is in. It shows their projects and outreach stage instead.
- Show one campaign's activity for a date range. Campaign figures are lifetime totals.
- Create campaigns, edit sequences, send messages or read replies.
- Page through campaigns. On accounts with very many campaigns the list may be cut short. The tool says how many it received.

**Figures are passed through exactly as SourceWhale's API reports them.** Some
campaigns may show rates (for example 100% opened and 100% booked) that differ
from what you expect. Spot-check a campaign in the SourceWhale app before
relying on any figure for a decision.

**Deliberately left out:** SourceWhale's activity data also includes team
members' phone numbers and gender and ethnicity counts. The connector drops these
before Claude sees anything.

### Important: everyone sees the same data

The connector uses **one** SourceWhale API key, created by a SourceWhale admin.
Every person who connects sees whatever that key can see, which is normally the
whole team's campaigns, projects and candidates. Their personal access rights in
SourceWhale do not apply. Decide who may connect with that in mind (section 3,
step 4).

---

## 2. What you need

| Item | Who | Notes |
| --- | --- | --- |
| A Cloudflare account | Whoever sets it up | Free. You can create one during step 1. No website or domain needed |
| A GitHub account | Whoever sets it up | Free, at https://github.com/signup. Cloudflare keeps your copy of the code there |
| A SourceWhale API key | A SourceWhale admin | In SourceWhale: click your initials (bottom left), then **Integrations**. API access may depend on your SourceWhale plan |
| Admin access to Microsoft Entra (Microsoft 365) | Your Microsoft 365 admin | About 10 minutes, to register the sign-in app |
| A Claude **Owner** on your Team or Enterprise plan | Your Claude Owner | To add the connector for the organisation |

**Cost:** Cloudflare's free plan allows 100,000 requests a day, far more than a
recruitment team will use.

**What data goes where:** Claude talks to your Cloudflare server, which talks to
SourceWhale. The server stores nothing from SourceWhale. The only thing it stores
is sign-in tokens, in Cloudflare storage in your own account.

---

## 3. Set it up

### Step 1. Click the Deploy button

Click **Deploy to Cloudflare** at the top of this page. Then:

1. Log in to Cloudflare, or create a free account.
2. Connect your GitHub account when asked. Cloudflare saves your own copy of the code there.
3. On the setup form, keep the suggested names. Paste your **SourceWhale API key** into the box for `SOURCEWHALE_API_KEY`.
4. Click **Create and deploy**. It takes a couple of minutes.

When it finishes, Cloudflare shows your server's address, something like
`https://sourcewhale-mcp.YOUR-NAME.workers.dev`. This guide calls it YOUR-SERVER.

### Step 2. Open your server's setup page

Open YOUR-SERVER in your browser. (A brand-new address can take a few minutes
to start working.)

You'll see a **setup checklist**. It checks every setting live and tells you
exactly what to fix. It already shows the address you need for Microsoft, with a
Copy button. Keep this page open.

### Step 3. Register the sign-in app in Microsoft Entra

Your Microsoft 365 admin follows the steps on the setup page. In short, at
https://entra.microsoft.com:

1. **App registrations**, then **New registration**. Name it `SourceWhale connector for Claude`.
2. Account type: **Accounts in this organizational directory only**. This is what limits sign-in to your own staff.
3. Redirect URI: **Web**, then paste the address from the setup page (it ends in `/callback`).
4. Note the **Application (client) ID** and **Directory (tenant) ID**.
5. **Certificates & secrets**, then **New client secret**, 24 months. Copy the **Value** column.

> **The most common mistake:** copying the **Secret ID** instead of the
> **Value**. Microsoft only shows the Value once. If it is hidden, create a new
> secret. The setup page spots this mistake and tells you.

6. Recommended: **API permissions**, then **Grant admin consent**, so staff are not asked individually.

### Step 4. Enter the Microsoft settings in Cloudflare

The setup page has a link straight to your server's settings in Cloudflare. Go
to **Variables and Secrets**, click **Add** for each row, then click **Deploy**:

| Name | Type | Value |
| --- | --- | --- |
| `MICROSOFT_TENANT_ID` | Text | Directory (tenant) ID |
| `MICROSOFT_CLIENT_ID` | Text | Application (client) ID |
| `MICROSOFT_CLIENT_SECRET` | **Secret** | The client secret Value |
| `ALLOWED_EMAILS` | Text | Optional. Emails allowed to connect, separated by commas. Leave out to allow anyone in your organisation |

Given that everyone sees the same SourceWhale data, a named list in
`ALLOWED_EMAILS` is the safer choice for most firms.

### Step 5. Refresh the setup page

Every item should now show a green tick, and the page shows **Setup complete**
with the connector address for your Claude Owner. If anything shows a red cross,
the page explains the fix. Changes can take a minute to show.

The setup page is safe to leave public. Once setup is complete it shows only the
connector address and a summary of the access settings, never keys or IDs.

---

## 4. Add it to Claude

### Claude Owner (once, for the whole organisation)

1. In Claude, go to **Organization settings**, then **Connectors**, then **Add**, then **Custom**, then **Web**.
2. **Name:** `SourceWhale`
3. **URL:** copy it from the setup page. It is YOUR-SERVER followed by `/mcp`.
4. **OAuth client:** choose **Use Claude's published identity**. If connecting
   fails with that option, edit the connector and choose **Register
   automatically** instead. Do not use "Use your own OAuth client".
5. Save.

### Each person who uses it

1. In Claude, go to **Settings**, then **Connectors**, find **SourceWhale** and click **Connect**.
2. On "Allow Claude to read SourceWhale?", click **Allow and sign in**.
3. Sign in with your Microsoft work account.
4. You return to Claude with SourceWhale connected.

### Check it works

In a new chat with the connector switched on, try:

- "List my SourceWhale projects"
- "Show all SourceWhale campaigns with their metrics"
- "What was the team's SourceWhale activity last month?"
- "Look up [a colleague's email] in SourceWhale"

---

## 5. Turning on the write tools

`add_candidate` creates a new person in SourceWhale, optionally in a campaign or
projects. `modify_candidate` changes details on an existing person.

**Why they are off by default:**

- They change live records, and changes cannot be undone from Claude.
- Claude acts on its reading of a conversation. A misunderstanding could edit the wrong person.
- Because everyone shares one admin key, anyone who connects could change any record.
- The tools tell Claude to confirm with the person first, but that is an
  instruction to Claude, not a technical block.

`add_candidate` never starts outreach. It always tells SourceWhale not to send.
Sending is only ever started from the SourceWhale app.

**To turn them on:** in Cloudflare, open your server's **Settings**, then
**Variables and Secrets**. Add `ENABLE_WRITE_TOOLS` as **Text** with the value
`true`, then click **Deploy**. People may need to disconnect and reconnect the
connector in Claude to see the new tools. To turn them off, delete that variable
or set it to `false`.

---

## 6. Maintenance

**Start with the setup page.** Open YOUR-SERVER. If anything is wrong with a
setting, a key or the Microsoft secret, it says so in plain English.

All settings live in Cloudflare: open your server (**Workers & Pages**, then
**sourcewhale-mcp**), then **Settings**, then **Variables and Secrets**. After any
change, click **Deploy**.

### Troubleshooting

| What you see | Cause | Fix |
| --- | --- | --- |
| Setup page shows a red cross | That setting is missing or wrong | Follow the message beside it |
| "Microsoft did not confirm your account" when connecting | Usually a wrong or expired client secret | Open the setup page, it will say which |
| Microsoft page shows `AADSTS50011` | The Redirect URI in Entra does not match exactly | Copy it again from the setup page into Entra |
| "Access not allowed" | The person is not in `ALLOWED_EMAILS` | Add them in Cloudflare, then Deploy |
| "App not allowed" | Something other than Claude tried to connect | Connect from Claude's connector settings |
| Claude says "SourceWhale refused the API key" | Key wrong, revoked, or API access not on your plan | Replace `SOURCEWHALE_API_KEY` in Cloudflare |
| Claude says "rate limit was reached" | Too many requests to SourceWhale at once | Wait a minute. The connector does not retry automatically |
| Address does not load right after setup | New addresses take a few minutes | Wait five minutes and try again |

For anything else, Cloudflare keeps logs: open your server, then **Logs**. Logs
never contain the API key or candidate records.

### Removing someone's access

Remove them from `ALLOWED_EMAILS` and Deploy. This takes effect on their next
request, even if they are already connected. Disabling their Microsoft 365
account also stops them signing in again.

### Replacing a secret

**Set a calendar reminder** a few weeks before the Microsoft client secret
expires (24 months after you created it).

- **Microsoft secret:** in Entra, create a new client secret. In Cloudflare, edit
  `MICROSOFT_CLIENT_SECRET`, paste the new Value, and Deploy. Check the setup page
  shows a green tick, then delete the old secret in Entra.
- **SourceWhale key:** create a new key in SourceWhale, update
  `SOURCEWHALE_API_KEY` in Cloudflare, Deploy, then revoke the old key.

### Updates

Your copy of the code lives in your GitHub account, and Cloudflare redeploys
automatically whenever it changes. When a new version is released, replace the
files in your GitHub copy with the new ones (in GitHub: **Add file**, then
**Upload files**). Your settings, secrets and connected users carry over, so
nobody needs to reconnect.

If SourceWhale changes its API and a tool starts failing, whoever maintains the
code should compare SourceWhale's published definition
(https://sourcewhale.app/public-api/swagger) with `docs/sourcewhale-openapi.json`.
The tools are in `src/tools.ts`.

---

## 7. Terms and scope

SourceWhale's API terms allow you to pull your own data, but not to build
anything that competes with SourceWhale or copies its interface. This connector
is a read-mostly data link between SourceWhale and Claude, and should stay that
way.

---

## Appendix: setting up from the command line instead

For technical staff who prefer not to use GitHub. Needs Node.js 22 or newer.
Download this code, open a terminal in its folder, and run these one at a time:

```bash
npm install
```

```bash
npx wrangler login
```

```bash
npx wrangler deploy
```

The last command prints YOUR-SERVER. Carry on from **section 3, step 2**. Add
`SOURCEWHALE_API_KEY` as a Secret in step 4 as well.

To update later, replace the files, then run `npm install` and `npx wrangler deploy`
again. Settings entered in Cloudflare are kept.

**Mac only:** `scripts/set-secret-from-clipboard.sh NAME` uploads a secret
straight from your clipboard without it appearing on screen. It is an
alternative to the Cloudflare dashboard.

### Folder contents

| File | Job |
| --- | --- |
| `wrangler.jsonc` | Cloudflare settings. You should not need to edit it |
| `src/worker.ts` | The server Claude connects to, protected by sign-in |
| `src/setup-page.ts` | The setup checklist at the server's home address |
| `src/microsoft-login.ts` | The Microsoft 365 sign-in and consent pages |
| `src/tools.ts` | The tools Claude sees, and how results are summarised |
| `src/sourcewhale.ts` | Calls SourceWhale and turns errors into short, safe messages |
| `src/local.ts` | Optional: runs the tools on one computer for Claude Code or Claude Desktop, reading `SOURCEWHALE_API_KEY` from a `.env` file |
| `docs/sourcewhale-openapi.json` | The SourceWhale API definition this was built against |

Prepared by Retrained Search. Built and tested against SourceWhale's public API
in September 2026.
