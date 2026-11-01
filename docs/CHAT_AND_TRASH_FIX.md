# Chat query repair and permanent deletion

These changes are local on `feature/trash-delete-chat-fix`, based on `main` at `636d54c`. Nothing has been pushed or deployed, and the live Supabase project has not been changed.

## Confirmed chat query defect

The previous frontend requested this embedded self-reference on every history fetch and on message inserts returning a row:

```text
reply:chat_messages!chat_messages_workspace_id_reply_to_fkey(id,body,author_id,author_name)
```

With both original SQL migrations applied, real local PostgreSQL 17/PostgREST 14.1 rejects that query with HTTP 400 and **PGRST200**. The same failure was reproduced on PostgREST 12.2.3. The composite self-referencing FK exists in PostgreSQL, but PostgREST does not resolve it through that embed hint. The error occurs even with empty history or no replies. The old catch block discarded the API error and blamed connection/migration setup for every failure.

Plain history, reaction embeds, and library-card embeds succeed with the same schema and member JWT. This isolates a frontend query defect; no RLS relaxation or extra chat grants are needed. Earlier browser fixtures fabricated nested replies and did not validate PostgREST relationship resolution.

The fixed client omits the self-embed, batches parent lookups with explicit workspace and message-id filters under the caller's RLS, then combines the results. Both history and insert/returning projections are fixed. Errors identify the operation and API code, with distinct guidance for schema, permission, session, or network failures. Raw backend constraint details, message bodies, and bearer tokens are not logged/displayed. Realtime status is reported separately.

**No SQL change is required for this chat query repair.** Reloading the API schema cache alone will not repair the old self-embed. The frontend fix must eventually be released after approval. The live project's HTTP response/configuration was not inspected; if its error code differs, use the checks below to identify any additional issue.

## Separate SQL migration for permanent deletion

File: `supabase/migrations/202611010002_trash_delete.sql`.

After approval, test in a separate development Supabase project with the first two migrations already applied. Apply the new migration **once** through your migration workflow/SQL editor. Do not rerun or edit the two previously applied migrations on the live project. Do not apply this migration to production without explicit approval and the normal backup/release process.

The migration grants authenticated DELETE on entries, with RLS restricting it to current workspace members and entries still in `Trash`. Restore and existing update policies remain intact. The client also filters by workspace/id/Trash; an entry restored concurrently cannot be deleted by a stale confirmation.

Existing comments and personal ratings/notes cascade on deletion. Chat history is preserved: the shared-entry FK clears only `shared_entry_id`, retaining `workspace_id` and messages/replies/reactions. A database-controlled `shared_entry_deleted` marker allows tool-only messages to remain valid and gives the client a deleted-entry label. Clients cannot forge empty tombstones or update chat history. The client listens for message UPDATE events to refresh these database-generated changes. The migration also notifies PostgREST to reload the changed FK metadata; it does not disable RLS or alter the Realtime publication.

Column-specific `ON DELETE SET NULL (shared_entry_id)` requires PostgreSQL 15+. Check your development project's version first. Without the migration, deletion fails visibly rather than reporting false success.

After migration/frontend releases are approved, verify with two members and an outsider: cancel/confirm deletion, restore a trashed entry, attempt active/foreign/restored-entry deletion, delete a shared tool-only card, verify notes/comments disappear, and confirm messages/replies/reactions survive.

## Additional configuration checks (read only)

`supabase/diagnostics/team_chat.sql` reads metadata: table existence, grants, RLS/policies, FK definitions, RPC execution privileges, and Realtime publication membership. It makes no changes and reads no customer messages. Run it in the intended project's SQL editor if needed. Do not share keys, Authorization headers, access tokens, or customer messages.

Inspect failed `/rest/v1/chat_messages` requests in browser developer tools. Record only HTTP status, JSON `code`, and operation. The fixed UI exposes operation/code too.

| Evidence                                             | Meaning / next check                                                                                                                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PGRST200` / `PGRST201`                              | Relationship resolution. Verify the deployed query no longer includes the self-embed. Check API cache state after actual schema changes.                                                                                                    |
| `42P01`, `42703`, `PGRST202`, `PGRST204`, `PGRST205` | Missing table/column/function or stale cache. Confirm the deployed public Supabase URL points to the project where migrations ran. Inspect schema before changing grants.                                                                   |
| `42501`                                              | Permissions/RLS. Check table grants, `is_workspace_member`, and membership. Never use a service-role key in the browser or disable RLS.                                                                                                     |
| `PGRST301` / HTTP 401                                | Invalid/expired session or wrong-project JWT. Sign in again and verify project settings.                                                                                                                                                    |
| HTTP 200 with empty history                          | No messages or no visible rows. RLS SELECT usually filters rows rather than raising an error.                                                                                                                                               |
| History works but Realtime fails                     | Inspect publication membership for all three chat tables and WebSocket handshake/JWT/project availability. CSP permits `wss://*.supabase.co`; custom domains need an explicit origin. This does not explain an HTTP 400 self-embed failure. |
| Fetch/connection error                               | Check network/CSP, public URL/key, API availability, and the request status. Never log/share Authorization headers.                                                                                                                         |

The original migration adds the three chat tables only if `supabase_realtime` exists. If metadata shows missing publication tables, an administrator can enable the specific tables through Supabase replication settings **after approval**. This is separate from the frontend fix. No publication/permission changes were needed in the local reproduction. Avoid blind migration reapplication or blanket grants.

## Local verification

Run `npm test`, `npm run typecheck`, and `npm run build`. With the unconfigured demo running on localhost:3000, run `npm run test:delete`, `npm run test:chat`, `npm run test:browser`, and `npm run test:mcp-client`. The authenticated HTTP/WebSocket browser fixture remains documented in README; it now rejects the old self-embed and handles explicit parent queries.

For a real API regression test, use a local Docker daemon:

```sh
docker pull postgres:17-alpine
docker pull postgrest/postgrest:v14.1
npm run test:chat-postgrest
```

This test creates disposable PostgreSQL/PostgREST containers on a private Docker network, binds only a loopback HTTP port, and removes its containers/network afterward. It never connects to Supabase or reads real credentials. It first reproduces the old request failure with both original migrations, then verifies fixed history/reply/card queries and RLS. Only afterward does it apply the deletion migration to its disposable DB and verify Trash-only deletion, member/outsider permissions, cascades, and retained chat. PostgreSQL/RLS tests also cover restoration, membership removal, and forged tombstones. Browser tests cover confirmation, Cancel/Escape, restoration, deletion, deleted-card labels, and demo reset behavior.
