import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateEntry,
  normalizeUrl,
  filterEntries,
  findDuplicate,
  uuid,
  type Entry,
} from "../lib/validation.ts";
const input = {
  title: " Claude ",
  description: " Research partner ",
  source_url: "https://CLAUDE.ai/?utm_source=chat#top",
  category: "Tool",
  tags: ["AI", "ai"],
  notes: "",
  status: "To Try",
  section: "library",
};
test("validates, trims, deduplicates tags and canonicalizes source URLs", () => {
  const v = validateEntry(input);
  assert.equal(v.title, "Claude");
  assert.deepEqual(v.tags, ["ai"]);
  assert.equal(v.source_url, "https://claude.ai");
});
test("rejects script URLs, credentials, invalid categories, lengths, status and tag counts", () => {
  for (const patch of [
    { source_url: "javascript:alert(1)" },
    { source_url: "https://user:pass@site.com" },
    { category: "Other" },
    { title: " " },
    { title: "x".repeat(161) },
    { notes: "x".repeat(10001) },
    { status: "Deleted" },
    { tags: Array(13).fill("tag") },
    { tags: [null] },
    { section: "anything" },
  ])
    assert.throws(() => validateEntry({ ...input, ...patch }));
});
test("URL normalization preserves meaningful query strings and allows empty URLs", () => {
  assert.equal(
    normalizeUrl("https://example.com/?b=2&a=1&gclid=123"),
    "https://example.com/?a=1&b=2",
  );
  assert.equal(normalizeUrl(""), null);
  assert.throws(() => normalizeUrl("not a URL"));
});
const entry = {
  ...validateEntry(input),
  id: "10000000-0000-4000-8000-000000000001",
  author_id: "author",
  workspace_id: "workspace",
  created_at: new Date().toISOString(),
} satisfies Entry;
test("searches title, description, URL and tags with combined category/status filters", () => {
  for (const q of ["claude", "research", "ai"])
    assert.equal(filterEntries([entry], q, "Tool", "To Try").length, 1);
  assert.equal(filterEntries([entry], "claude", "Agent", "All").length, 0);
  assert.equal(filterEntries([entry], "claude", "All", "Trash").length, 0);
});
test("duplicate detection checks canonical URL and title, excluding the edited entry", () => {
  assert.ok(
    findDuplicate([entry], validateEntry({ ...input, title: "Other" })),
  );
  assert.ok(
    findDuplicate([entry], validateEntry({ ...input, source_url: null })),
  );
  assert.equal(
    findDuplicate([entry], validateEntry(input), entry.id),
    undefined,
  );
});
test("IDs must be valid UUIDs", () => {
  assert.equal(uuid(entry.id), entry.id);
  for (const id of ["other", null, {}, "id),workspace_id.eq.other"])
    assert.throws(() => uuid(id));
});
