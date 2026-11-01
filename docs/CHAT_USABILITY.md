# Chat usability update

Local branch `feature/chat-usability` starts from `main` at `605ed3a` and preserves the existing chat query repair and permanent deletion functionality. No pushes, deployments, live database changes, or merges are included.

## Composer keyboard behavior

Enter submits through the same form and validation as the Send button. Shift + Enter inserts a line break. Empty/whitespace-only text with no shared entry cannot be sent. Entry-only shares remain valid, matching existing Send behavior. Modified Enter (Ctrl/Alt/Meta) does not send, and held/repeated Enter does not create extra messages.

Composition start/end state, the native `isComposing` flag, and the legacy IME key code 229 prevent sending while an IME confirms a candidate. The tests exercise these events; native IME interaction should also be checked on your target browsers/devices before release. The Send button and validation/error handling remain available.

## Sharing from both sections

**Share from Idea Hub** opens a searchable picker grouped into **AI Library** and **Ideas & Projects**. It searches titles, descriptions, categories, and tags among the current workspace's loaded entries, excluding Trash. Arrow keys and Tab navigate choices; Enter selects a focused choice. Enter in the search field does not submit the message draft. Escape closes the picker, and clicking/focusing outside dismisses it. Selected entries can be removed before sending.

Cards show their source section. Opening a card fetches the entry with an explicit workspace filter under RLS, switches to its current section, clears unrelated library filters, and opens its details. This uses the entry's current section in case it was moved after sharing. Existing library cards, reply lookups, deleted-entry labels, and history are preserved. Demo interactions stay in memory.

### Required migration before release

`supabase/migrations/202611010003_chat_share_all_sections.sql` is **required** for Ideas & Projects sharing. The existing `prepare_chat_message` trigger explicitly checks `section='library'`; this migration replaces only that function to accept an accessible entry from either section in the message's workspace.

Apply this migration once **after explicit approval**, following the existing three migrations, first in a separate development database. Do not rerun/edit the already applied migrations. The function keeps server-owned timestamps/author labels, blank-message checks, and its empty search path. Existing grants, message RLS, and the composite `(workspace_id, shared_entry_id)` FK remain unchanged, including the deletion behavior from `202611010002_trash_delete.sql`. The migration does not rewrite messages, change publication membership, or require new environment variables. No migration has been applied to the live project by this work.

Before approval/release, verify with two workspace members and an outsider: share a library entry and an idea; click each card; confirm a member of two workspaces still cannot attach a foreign workspace's entry; confirm existing cards/replies/reactions still load. Without the migration, library sharing still works but idea inserts are rejected by the old trigger and the client retains the draft.

## Compact reactions

Each message has a compact **Add reaction** control. It opens the six available emoji in a small popover. Existing active reactions appear as badges with counts and an `aria-pressed` state for the current user. Clicking a badge toggles that user's reaction; others' reactions remain intact.

The popover closes after choosing, clicking/focusing outside, or Escape. Buttons support Tab, arrows, Home/End, and Enter/Space; Escape returns focus to the trigger without closing chat. Popovers are positioned within the visible viewport, including mobile keyboard/viewport changes, and retain the dark chat design. No database changes are needed for reactions or keyboard shortcuts.

## Verification

```sh
npm test
npm run format:check
npm run typecheck
npm run build
# With the unconfigured demo running on localhost:3000:
npm run test:chat-usability
npm run test:chat
npm run test:delete
npm run test:browser
node tests/deployment-security.mjs
npm run test:mcp-client
```

The authenticated HTTP/WebSocket fixture uses the local server setup in README and `npm run test:chat-realtime`. `npm run test:chat-postgrest` uses disposable local PostgreSQL 17/PostgREST 14.1 Docker containers: it now also verifies that idea sharing fails under the old trigger, succeeds after the new migration, and remains inaccessible to outsiders. PostgreSQL/RLS tests cover both sections, cross-workspace references, history preservation, author spoofing, and whitespace validation. Browser tests cover IME events, multiline/blank messages, searchable selection, original-section navigation, keyboard focus/dismissal, counts/toggling, and mobile bounds.
