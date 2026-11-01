import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findShareableEntries,
  sectionLabel,
  shouldSendOnEnter,
  validateChatMessage,
} from "../lib/chat.ts";
import { demoEntries } from "../lib/demo.ts";
test("Enter submits only an unmodified, non-composing key; Shift/IME and modifier keys remain native", () => {
  const enter = { key: "Enter", shiftKey: false };
  assert.equal(shouldSendOnEnter(enter, false), true);
  for (const event of [
    { ...enter, shiftKey: true },
    { ...enter, isComposing: true },
    { ...enter, keyCode: 229 },
    { ...enter, ctrlKey: true },
    { ...enter, altKey: true },
    { ...enter, metaKey: true },
    { key: "a", shiftKey: false },
  ])
    assert.equal(shouldSendOnEnter(event, false), false);
  assert.equal(shouldSendOnEnter(enter, true), false);
  assert.throws(() => validateChatMessage({ body: " \n\t " }));
  assert.equal(
    validateChatMessage({ body: "Hello\nteam" }).body,
    "Hello\nteam",
  );
  assert.equal(
    validateChatMessage({ body: "", shared_entry_id: demoEntries[0].id })
      .shared_entry_id,
    demoEntries[0].id,
  );
});
test("sharing search includes both sections, excludes Trash/foreign workspaces, and matches literal terms", () => {
  const library = demoEntries[0],
    idea = {
      ...demoEntries[1],
      section: "ideas" as const,
      title: "Research sprint",
      tags: ["planning"],
    };
  const foreign = { ...idea, id: crypto.randomUUID(), workspace_id: "other" };
  const trash = {
    ...library,
    id: crypto.randomUUID(),
    status: "Trash" as const,
  };
  const entries = [library, idea, foreign, trash];
  assert.deepEqual(
    findShareableEntries(entries, library.workspace_id, false, "").map(
      (e) => e.id,
    ),
    [library.id, idea.id],
  );
  assert.equal(
    findShareableEntries(entries, library.workspace_id, false, " PLANNING ")[0]
      .id,
    idea.id,
  );
  assert.equal(
    findShareableEntries(entries, library.workspace_id, false, "[").length,
    0,
  );
  assert.equal(sectionLabel("ideas"), "Ideas & Projects");
  assert.equal(sectionLabel("library"), "AI Library");
});
