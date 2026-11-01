import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_MESSAGE_SELECT,
  ChatRequestError,
  describeChatError,
  loadChatReplies,
} from "../lib/chat-api.ts";
import { demoConversation } from "../lib/chat.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
test("chat query omits the unsupported self-embed and retrieves parents scoped to the workspace", async () => {
  assert.doesNotMatch(CHAT_MESSAGE_SELECT, /reply:chat_messages/);
  const messages = demoConversation(null);
  const calls: unknown[] = [];
  const db = {
    from: (table: string) => ({
      select: (select: string) => ({
        eq: (field: string, value: string) => ({
          in: async (column: string, ids: string[]) => {
            calls.push({ table, select, field, value, column, ids });
            return {
              data: [
                {
                  id: messages[0].id,
                  body: "Original parent",
                  author_id: messages[0].author_id,
                },
              ],
              error: null,
            };
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  const rows = await loadChatReplies(db, "workspace-a", messages);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    table: "chat_messages",
    select: "id,body,author_id,author_name",
    field: "workspace_id",
    value: "workspace-a",
    column: "id",
    ids: [messages[0].id],
  });
  assert.equal(rows[2].reply?.body, "Original parent");
  assert.equal(rows[0].reply, null);
  const missing = {
    from: () => ({
      select: () => ({
        eq: () => ({ in: async () => ({ data: [], error: null }) }),
      }),
    }),
  } as unknown as SupabaseClient;
  assert.equal(
    (await loadChatReplies(missing, "workspace-a", messages))[2].reply,
    null,
  );
  assert.equal((await loadChatReplies(db, "workspace-a", [])).length, 0);
});
test("chat diagnostics distinguish query, permissions, schema, session and transport failures without exposing raw details", () => {
  for (const [code, match] of [
    ["PGRST200", /query relationship/],
    ["42501", /permissions/],
    ["42P01", /missing a required/],
    ["PGRST301", /session/],
    ["NETWORK", /network/],
  ] as const) {
    const error = new ChatRequestError("history query", { code });
    assert.match(describeChatError(error), match);
    assert.match(describeChatError(error), new RegExp(code));
    assert.match(describeChatError(error), /history query/);
  }
  assert.doesNotMatch(
    describeChatError({
      code: "23514",
      details: "private message body and bearer token",
    }),
    /private message|bearer/,
  );
});
