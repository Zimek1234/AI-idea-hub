import { test } from "node:test";
import assert from "node:assert/strict";
import {
  demoConversation,
  mergeChatMessages,
  validateChatMessage,
  validateReaction,
} from "../lib/chat.ts";

test("chat validation trims text, allows tool-only shares and rejects blank, oversized or forged references", () => {
  assert.equal(
    validateChatMessage({ body: "  Hello team!  " }).body,
    "Hello team!",
  );
  const id = "10000000-0000-4000-8000-000000000001";
  assert.equal(
    validateChatMessage({ body: "", shared_entry_id: id }).shared_entry_id,
    id,
  );
  assert.equal(
    validateChatMessage({ body: "😀".repeat(3000) }).body.length,
    6000,
  );
  for (const body of ["", " \n\t ", "a".repeat(3001), "😀".repeat(3001)])
    assert.throws(() => validateChatMessage({ body }));
  assert.throws(() => validateChatMessage({ body: "reply", reply_to: "bad" }));
  assert.throws(() =>
    validateChatMessage({ body: "share", shared_entry_id: "javascript:bad" }),
  );
  assert.throws(() => validateChatMessage({ body: null as unknown as string }));
  assert.equal(validateReaction("❤️"), "❤️");
  assert.throws(() => validateReaction("<script>"));
});
test("chat reconciliation deduplicates refreshes, preserves history and replaces updated reactions", () => {
  const messages = demoConversation(null);
  const changed = { ...messages[1], reactions: [] };
  const merged = mergeChatMessages(messages, [changed, messages[0]]);
  assert.equal(merged.length, 3);
  assert.deepEqual(
    merged.map((m) => m.id),
    messages.map((m) => m.id),
  );
  assert.equal(merged[1].reactions.length, 0);
  assert.equal(messages[1].reactions.length, 1);
});
test("each demo conversation gets independent memory", () => {
  const first = demoConversation(null),
    second = demoConversation(null);
  first[0].body = "private experiment";
  first[1].reactions[0].active = false;
  assert.notEqual(second[0].body, first[0].body);
  assert.equal(second[1].reactions[0].active, true);
});
