# Deployment handoff

The local `feature/team-chat` branch extends `deploy/mvp` with shared workspace chat. Do not push, merge, deploy, or apply `202611010001_team_chat.sql` until explicitly authorized. The already deployed MVP is unaffected by local code and test runs. See README's shared chat section for the migration order, Realtime publication setup, and multi-user verification. The export bundle/source archive described below contains the original MVP; it is not a backup of this new feature commit.

No production infrastructure has been modified by this feature. Publishing Git commits and deploying Vercel are separate actions. Check the current feature commit with `git rev-parse HEAD`.

## Preserve and publish the code

The handoff includes a portable Git bundle and source archive under `/workspace/deployment-export` (outside the checkout). Download these before discarding the Codex environment. The bundle preserves committed source and Git history; the source archive includes all committed dotfiles. Neither includes dependencies, build output, `.env.local`, or other ignored local files. Those files are not required to reproduce the application. Store any real secrets separately in your secure environment settings.

Only after explicit authorization to publish this feature, push its own branch:

```sh
cd /workspace/AI-idea-hub
git status --short
git log -1 --oneline
git push origin feature/team-chat:refs/heads/feature/team-chat
```

This command has not been executed. A branch push may trigger existing repository automation or Vercel preview deployments; review integrations before running it. The first `deploy/mvp` pull request is still unmerged, so any later chat pull request should use `deploy/mvp` as its base unless the MVP has since been merged. Do not merge until explicitly authorized.

The existing `AI-idea-hub.bundle`, `AI-idea-hub-source.tar.gz`, and `SHA256SUMS` in `/workspace/deployment-export` recover only the original MVP (`012130b`), not team chat. To inspect that recovery copy on another computer:

```sh
# Run in the directory containing the downloaded files.
sha256sum -c SHA256SUMS
# On macOS, use: shasum -a 256 -c SHA256SUMS
git clone AI-idea-hub.bundle AI-idea-hub
cd AI-idea-hub
git bundle verify ../AI-idea-hub.bundle
git remote set-url origin https://github.com/Zimek1234/AI-idea-hub.git
git status --short
git log -1 --oneline
git log -1 --oneline # Expected original MVP commit: 012130b
```

The source archive is an additional recovery copy; prefer the bundle because it retains history. Preserve this feature branch separately before discarding the environment. Do not force-push or replace `deploy/mvp` with feature work.

## Demo deployment on Vercel (after deployment approval)

1. Publish the feature branch and review the pull request. Choose the desired source branch according to your approved release process.
2. Import `Zimek1234/AI-idea-hub` into Vercel as **Next.js**. Repository root: `.`. Node.js: **24.x**. Install: `npm ci`. Build: `npm run build`. Output directory: framework default. Do not use a static export; `/mcp` and metadata routes are server routes.
3. For the demo, leave **both** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` entirely unset. `APP_URL` is not required for the demo. Do not copy placeholder values from `.env.example` into Vercel. No Supabase project, database migration, service key, or external AI API key is needed.
4. Deploy only after approval. Prefer a preview deployment first. The public demo displays synthetic sample entries; edits exist in the visitor's browser memory and reset on reload. Personal demo notes/comments also reset when their dialog closes.
5. Verify the demo banner, sample entries, search/filter/edit flows, mobile navigation, and anonymous `POST /mcp` returning **503**. GET `/mcp` returns **405**. A successful demo deployment does not establish live Supabase or ChatGPT OAuth readiness.

## Real deployment environment variables

| Variable                        | Value                                                                                  | Exposure                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL, e.g. `https://PROJECT.supabase.co`                               | Public; included in the browser build                                    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable key or legacy anon key                                            | Public; RLS is mandatory                                                 |
| `APP_URL`                       | Exact canonical app origin, e.g. `https://ideas.example.com`, without a trailing slash | Server configuration; used for MCP OAuth discovery and Origin validation |

These are the only application environment variables required. Configure them for the appropriate Vercel environment before building. Changes to `NEXT_PUBLIC_*` require a new build/deployment. Match `APP_URL` to the actual origin used for MCP calls; a different browser Origin is rejected.

**Do not add a Supabase service-role/secret key.** No `OPENAI_API_KEY`, model-provider key, or Vercel API token is needed at runtime. Supabase SMTP credentials belong in Supabase settings. An OAuth client secret, if your ChatGPT registration requires one, belongs in the connector's secure configuration, not the app's public environment.

After explicit infrastructure approval, follow README.md to apply the migration, disable public signup, invite Auth users, configure workspace invitations, and enable/register Supabase OAuth with `/oauth/consent`. Set Auth Site URL and allowed redirects to the correct environment. Test two invited users and an outsider before production. Live Supabase Auth and ChatGPT OAuth have not been verified against a real project.

## Security expectations

- Demo data is synthetic and contains no workspace/customer records. With no Supabase variables, the browser does not create a Supabase client or contact a database.
- Demo edits update React memory, not a shared backend. They do not grant permission to write through MCP.
- `/mcp` fails closed with 503 when backend settings are missing. When configured, missing/invalid/expired individual bearer tokens return 401, foreign Origins return 403, and workspace membership plus RLS protects database operations.
- Demo mode is intentionally accessible without signing in; it is not a private live workspace. Private collaboration requires Supabase configuration and invitations.
- `.env.local`, dependencies, build outputs, and generated `next-env.d.ts` are intentionally ignored by Git. `.env.example`, the lockfile, source, migrations, tests, and instructions are committed.
