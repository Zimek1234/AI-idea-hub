import { createServer } from "node:http";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleRpc } from "../lib/mcp.ts";
const wid = "20000000-0000-4000-8000-000000000001";
const entries = [];
const requireAccess = (w) => {
  if (w !== wid) throw new Error("Workspace not found or access denied.");
};
const store = {
  async list(w) {
    requireAccess(w);
    return entries;
  },
  async search(w, q) {
    requireAccess(w);
    return entries.filter((e) => e.title.includes(q));
  },
  async get(w, id) {
    requireAccess(w);
    const e = entries.find((e) => e.id === id);
    if (!e) throw new Error("Entry not found");
    return e;
  },
  async add(w, v) {
    requireAccess(w);
    const e = {
      ...v,
      workspace_id: w,
      id: crypto.randomUUID(),
      author_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    entries.push(e);
    return e;
  },
  async update(w, id, v) {
    const e = await this.get(w, id);
    Object.assign(e, v);
    return e;
  },
};
const server = createServer(async (req, res) => {
  try {
    if (req.headers.authorization !== "Bearer fixture-user") {
      res.writeHead(401);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" });
      res.end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await handleRpc(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: req.headers,
        body: Buffer.concat(chunks),
      }),
      store,
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch {
    res.writeHead(500);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const client = new Client({ name: "official-sdk-test", version: "1.0.0" });
try {
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
      { requestInit: { headers: { Authorization: "Bearer fixture-user" } } },
    ),
  );
  const advertised = await client.listTools();
  assert.equal(advertised.tools.length, 4);
  const added = await client.callTool({
    name: "add_ai_tool",
    arguments: { workspace_id: wid, title: "SDK discovery", category: "Tool" },
  });
  assert.equal(added.isError, false);
  const entry = JSON.parse(added.content[0].text);
  const listed = await client.callTool({
    name: "list_ai_tools",
    arguments: { workspace_id: wid },
  });
  assert.equal(JSON.parse(listed.content[0].text).length, 1);
  const searched = await client.callTool({
    name: "search_ai_tools",
    arguments: { workspace_id: wid, query: "SDK" },
  });
  assert.equal(JSON.parse(searched.content[0].text).length, 1);
  const updated = await client.callTool({
    name: "update_ai_tool",
    arguments: { workspace_id: wid, id: entry.id, status: "Using" },
  });
  assert.equal(JSON.parse(updated.content[0].text).status, "Using");
  const denied = await client.callTool({
    name: "list_ai_tools",
    arguments: { workspace_id: "20000000-0000-4000-8000-000000000002" },
  });
  assert.equal(denied.isError, true);
  await client.ping();
  console.log(
    "PASS official MCP SDK: initialize, tool discovery, add/list/search/update, access denial and ping",
  );
} finally {
  await client.close();
  await new Promise((resolve) => server.close(resolve));
}
