import { test } from "node:test";
import assert from "node:assert/strict";
import { callTool, handleRpc, type Store, tools } from "../lib/mcp.ts";
import { validateEntry, type Entry } from "../lib/validation.ts";
const wid = "20000000-0000-4000-8000-000000000001",
  id = "10000000-0000-4000-8000-000000000001";
function store() {
  const entries: Entry[] = [];
  const api: Store = {
    async add(workspace, v) {
      const e = {
        ...v,
        id,
        workspace_id: workspace,
        author_id: "user",
        created_at: new Date().toISOString(),
      };
      entries.push(e);
      return e;
    },
    async get(workspace, key) {
      const e = entries.find(
        (e) => e.workspace_id === workspace && e.id === key,
      );
      if (!e) throw new Error("Entry not found or access denied.");
      return e;
    },
    async update(workspace, key, v) {
      const e = await api.get(workspace, key);
      Object.assign(e, v);
      return e;
    },
    async list(workspace) {
      return entries.filter((e) => e.workspace_id === workspace);
    },
    async search(workspace, q) {
      return entries.filter(
        (e) => e.workspace_id === workspace && e.title.includes(q),
      );
    },
  };
  return api;
}
const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://hub.test/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
test("all four MCP tools are advertised with closed input schemas", () => {
  assert.deepEqual(
    tools.map((t) => t.name),
    ["add_ai_tool", "list_ai_tools", "search_ai_tools", "update_ai_tool"],
  );
  assert.ok(tools.every((t) => t.inputSchema.additionalProperties === false));
});
test("MCP add, list, search, and partial update preserve existing fields", async () => {
  const s = store();
  const e = (await callTool(
    "add_ai_tool",
    { workspace_id: wid, title: "Claude", category: "Tool" },
    s,
  )) as Entry;
  assert.equal(e.status, "To Try");
  assert.equal(
    ((await callTool("list_ai_tools", { workspace_id: wid }, s)) as Entry[])
      .length,
    1,
  );
  assert.equal(
    (
      (await callTool(
        "search_ai_tools",
        { workspace_id: wid, query: "Claude" },
        s,
      )) as Entry[]
    ).length,
    1,
  );
  const updated = (await callTool(
    "update_ai_tool",
    { workspace_id: wid, id, status: "Using" },
    s,
  )) as Entry;
  assert.equal(updated.title, "Claude");
  assert.equal(updated.status, "Using");
});
test("MCP rejects injected ownership, unknown arguments, malformed IDs and unbounded pagination", async () => {
  const s = store();
  for (const a of [
    { workspace_id: wid, author_id: "attacker" },
    { workspace_id: "not-uuid" },
    { workspace_id: wid, limit: 101 },
    { workspace_id: wid, offset: -1 },
    { workspace_id: wid, status: "other" },
    { workspace_id: wid, limit: NaN },
  ])
    await assert.rejects(callTool("list_ai_tools", a, s));
  await assert.rejects(
    callTool(
      "add_ai_tool",
      {
        workspace_id: wid,
        title: "<script>",
        category: "Tool",
        source_url: "javascript:bad",
      },
      s,
    ),
  );
});
test("workspace mismatch cannot fetch or update another workspace entry", async () => {
  const s = store();
  await callTool(
    "add_ai_tool",
    { workspace_id: wid, title: "Private", category: "Tool" },
    s,
  );
  await assert.rejects(
    callTool(
      "update_ai_tool",
      {
        workspace_id: "20000000-0000-4000-8000-000000000002",
        id,
        title: "Hacked",
      },
      s,
    ),
  );
});
test("initialize negotiates protocol, tools/list and ping return JSON-RPC results", async () => {
  const s = store();
  const init = await (
    await handleRpc(
      request({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          clientInfo: { name: "test", version: "1" },
          capabilities: {},
        },
      }),
      s,
    )
  ).json();
  assert.equal(init.result.protocolVersion, "2025-06-18");
  const list = await (
    await handleRpc(request({ jsonrpc: "2.0", id: 2, method: "tools/list" }), s)
  ).json();
  assert.equal(list.result.tools.length, 4);
  const ping = await (
    await handleRpc(request({ jsonrpc: "2.0", id: 3, method: "ping" }), s)
  ).json();
  assert.deepEqual(ping.result, {});
});
test("tools/call returns protocol tool errors without exposing stack traces", async () => {
  const r = await handleRpc(
    request({
      jsonrpc: "2.0",
      id: "call",
      method: "tools/call",
      params: {
        name: "add_ai_tool",
        arguments: { workspace_id: wid, title: "", category: "Tool" },
      },
    }),
    store(),
  );
  const b = await r.json();
  assert.equal(b.result.isError, true);
  assert.equal(b.id, "call");
  assert.match(b.result.content[0].text, /Title/);
});
test("malformed requests, unsupported versions, media types, and oversized bodies are rejected", async () => {
  const s = store();
  assert.equal((await handleRpc(request([]), s)).status, 400);
  assert.equal(
    (
      await handleRpc(
        request(
          { jsonrpc: "2.0", id: 1, method: "ping" },
          { "mcp-protocol-version": "bad" },
        ),
        s,
      )
    ).status,
    400,
  );
  assert.equal(
    (await handleRpc(request({}, { "content-type": "text/plain" }), s)).status,
    415,
  );
  assert.equal(
    (await handleRpc(request({}, { accept: "application/json" }), s)).status,
    406,
  );
  assert.equal(
    (await handleRpc(request({ large: "x".repeat(66000) }), s)).status,
    413,
  );
  const bad = new Request("https://hub.test/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: "{",
  });
  assert.equal((await (await handleRpc(bad, s)).json()).error.code, -32700);
});
test("initialized notifications return 202; unknown request methods return -32601", async () => {
  const s = store();
  assert.equal(
    (
      await handleRpc(
        request({ jsonrpc: "2.0", method: "notifications/initialized" }),
        s,
      )
    ).status,
    202,
  );
  const b = await (
    await handleRpc(request({ jsonrpc: "2.0", id: 9, method: "evil" }), s)
  ).json();
  assert.equal(b.error.code, -32601);
});
