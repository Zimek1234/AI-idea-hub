# AI Idea Hub

A private, collaborative AI library and idea board for a small invited team. Built with Next.js App Router, TypeScript, Tailwind CSS, and Supabase Auth/PostgreSQL/RLS. Includes a stateless Streamable HTTP MCP endpoint at `/mcp`.

## Run locally

Requires Node.js 24 and npm. Use this existing checkout; no Git worktree is needed.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Without Supabase variables, the app opens a clearly labeled, interactive **demo**. Demo library edits live only in memory; personal notes and comments reset when their dialog closes. Nothing is sent to a backend. Remove placeholder Supabase values entirely to use demo mode.

For a real workspace, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the project's URL and **publishable key or legacy anon key**. Set `APP_URL` to your canonical origin (locally `http://localhost:3000`; no trailing slash). Public Supabase variables are intentionally public; database access is protected by RLS. This application does not need a service-role key. **Never use a service-role or secret key in a `NEXT_PUBLIC_` variable.** Restart Next.js after editing variables.

## Supabase setup (manual, requires infrastructure approval)

No remote database has been created or changed by this implementation.

1. Create/select a Supabase development project after approval. Run `supabase/migrations/202610310001_initial.sql` using the SQL editor, or link the project and use the Supabase CLI migration workflow. Apply it once; it is a versioned migration, not an idempotent seed script.
2. In Authentication settings, disable public signups. Set the Site URL to the app origin and explicitly allow local/deployed app URLs as auth redirect destinations. Configure SMTP for invitation and sign-in email delivery.
3. Invite the initial administrator through **Supabase Authentication → Users → Invite user**. They can follow the invite link to establish a session, or use “Email me a sign-in link” in the application. Existing accounts with passwords can sign in with email/password. For OAuth consent in a new browser, establish an app session via an invitation/magic link first or set a password through Supabase's account-management flow.
4. Sign in and create a workspace. The creator becomes its owner. In Workspace settings, create an invitation for each team member's email. The owner must separately ask the Supabase administrator to invite new Auth accounts; the workspace invitation does **not** send an email or create an Auth account.
5. Invitees sign in with their verified email. Matching workspace invitations are accepted automatically on sign-in. Existing signed-in users can use “Check for invitations” if they have no workspace, or sign out/in to refresh membership. Invitations expire after seven days. Pending invitations reserve seats, up to **five people including the owner**. Owners can revoke invitations and remove other members.
6. Verify with two invited accounts and one outsider before production use. Confirm workspace isolation, private notes, comments, and removal of membership. Never disable RLS to fix permissions.

For a local Supabase stack, apply the migration against that stack and use its local project URL/publishable key. The default CSP allows hosted `*.supabase.co` connections; add your explicit local/custom Supabase origin to `connect-src` in `next.config.ts` when using another host.

## What the MVP includes

- Entries for tools, agents, skills, prompts, workflows and automations; title, description, source URL, tags, category, author, timestamps, shared notes and status.
- To Try / Testing / Using / Trash, with editable status and recoverable Trash entries.
- AI Library and Ideas & Projects sections, grid/list views, literal search and combined filters.
- Canonical URL/title duplicate checks in the app and MCP; database uniqueness for workspace titles and exact normalized URLs. URL tracking parameters/fragments are removed on app/MCP writes. Semantically similar descriptions or different URLs to the same product are not fuzzy-detected.
- Personal ratings (1–5) and notes readable only by their author. Shared comments; authors may delete their own comments.
- Owner-managed membership/invites, responsive dark UI, keyboard-accessible dialogs.

Updates are fetched when entering/switching workspaces or after mutations; this MVP does not subscribe to live collaboration events. Refresh to see another user's changes. Shared entry edits use last-write-wins. Ideas reuse the entry model and statuses; kanban, project tasks, attachments, history, and notifications are future work.

## MCP and ChatGPT

The endpoint implements MCP stateless Streamable HTTP with JSON responses. Supported protocol versions: `2025-03-26`, `2025-06-18`, `2025-11-25`. POST supports initialize, initialized notifications, ping, tools/list and tools/call. GET/SSE listening and session deletion are unsupported (405); sessions are not stored. Clients must accept both `application/json` and `text/event-stream`, and send `Content-Type: application/json`.

Tools:

| Tool              | Required arguments                  | Optional arguments                                    |
| ----------------- | ----------------------------------- | ----------------------------------------------------- |
| `add_ai_tool`     | `workspace_id`, `title`, `category` | description, source_url, tags, notes, status, section |
| `list_ai_tools`   | `workspace_id`                      | status, category, section, limit, offset              |
| `search_ai_tools` | `workspace_id`, `query`             | limit, offset                                         |
| `update_ai_tool`  | `workspace_id`, `id`                | any editable entry field                              |

Get the workspace UUID from Workspace settings. `limit` defaults to 30, maximum 100; offset maximum 10,000. Add defaults: To Try, library, empty description/tags/shared notes. Updates preserve omitted fields. There is no permanent deletion tool. MCP does not expose private feedback or comments. Entry shared `notes` are distinct from personal notes.

### Authentication

Every POST requires an **individual Supabase user access token**, verified server-side with `auth.getUser`. The Supabase client uses the same bearer token for database operations; membership and RLS apply. Tokens are never stored/logged by this endpoint. Expired/revoked tokens receive 401. Foreign Origins are rejected; missing backend settings produce 503. JSON bodies are capped at 64 KiB. Database errors are sanitized. No shared administrator token or service-role client is used.

For persistent ChatGPT connections, configure **Supabase OAuth 2.1 Server** rather than copying a short-lived access JWT into a connector:

1. After infrastructure approval, enable the OAuth server in the Supabase project. Set its authorization/consent UI path to `/oauth/consent` on this application's configured Site URL. The app includes the consent screen, login, approve, and deny flow using Supabase's OAuth APIs.
2. Register a client for ChatGPT with its **exact callback URL shown by ChatGPT**, authorization-code flow, PKCE S256, and the provider-supported scopes `openid email profile`. Configure client authentication according to the ChatGPT/provider settings; keep confidential client secrets in the connector's secure configuration, never this repository. Do not enable open client registration unless that is an intended policy.
3. Confirm the provider's discovery document at `https://PROJECT.supabase.co/auth/v1/.well-known/oauth-authorization-server` works. The app's `/.well-known/oauth-protected-resource` advertises the Supabase authorization server and canonical MCP resource. An app-level `/.well-known/oauth-authorization-server` forwards authoritative provider metadata for clients requesting root discovery. OAuth availability depends on your Supabase project/configuration; the app does not implement its own token issuer.
4. In ChatGPT's connector/developer settings, add your approved HTTPS URL `https://YOUR-APP/mcp`, choose OAuth, and configure the registered client ID/secret if prompted. Use provider metadata for authorization/token endpoints. Sign in as an invited workspace user and review the consent screen.
5. Ask ChatGPT to call `list_ai_tools` with your workspace UUID, then add, search and update a disposable entry. Revoke connector grants through Supabase Auth when no longer needed.

The deployed OAuth flow has not been exercised against a real Supabase project or ChatGPT account in this workspace. Exact client registration features and UI names depend on your provider and ChatGPT plan. A successful local protocol test does not establish that external authorization is configured.

For a temporary developer smoke test only, use a valid user access token securely supplied in your local shell (do not paste secrets into chat or commit them):

```sh
curl "$APP_URL/mcp" \
  -H "Authorization: Bearer $SUPABASE_USER_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-06-18' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Verification

```sh
npm test                 # Input validation, MCP, migration + PostgreSQL RLS tests
npm run typecheck
npm run build
npm run dev              # In another terminal for the browser suite
npm run test:browser
npm run test:mcp-client  # Official MCP SDK interoperability (local HTTP server)
```

Database tests run the migration in PGlite (real embedded PostgreSQL), with mocked `auth.users`/`auth.uid()` and separate anon/authenticated roles. They exercise cross-workspace access, author spoofing, private notes, comments, invitation limits, and membership revocation. These tests do not replace testing hosted Supabase Auth or live project configuration.

Browser tests use `playwright-core` with `/usr/bin/chromium`; set `CHROMIUM_PATH` for another Chromium installation and `TEST_URL` for an alternate local origin. They exercise the **unconfigured demo** and expect `/mcp` to fail closed with 503. Screenshots are written to `/tmp/ai-hub-artifacts`. No Supabase/MCP test existed in the original repository.

Next.js uses webpack here because the cloud sandbox restricts Turbopack's compiler port binding. Some cloud machines also require approved execution permissions for compiler subprocesses and browser/server sockets. Unit tests use in-process test isolation so all individual test assertions execute under those restrictions.

## Deploy to Vercel — only after approval

1. Review the code, migration and environment settings. Test a separate Supabase development project first. No production deployment or existing infrastructure modification has been performed.
2. Import this repository into Vercel, framework **Next.js**, Node.js **24.x**, install `npm ci`, build `npm run build`. Set the three variables from `.env.example`. Use the preview's own canonical `APP_URL` for preview builds; build-time public variables must match that environment's Supabase project.
3. After approval, apply the migration to the intended Supabase project. Configure Auth Site URL/allowed redirects and OAuth consent/client registration for the final HTTPS origin.
4. Deploy only after approval. Validate invited-user sign-in, workspace creation/invitations, all entry flows, independent personal notes, shared comments, and the actual ChatGPT OAuth connection. Confirm anonymous and unrelated accounts cannot access workspace data.
5. Add Vercel/edge rate limiting for `/mcp` appropriate to your usage, configure monitoring/backups and Supabase email limits before wider use. The app performs authorization per call but does not include a distributed rate limiter.

`.env.local`, generated build output, and dependencies are ignored by Git. Commit `package-lock.json` for reproducible installation. The repository stores no secrets.
