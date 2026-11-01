import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/mcp/route.ts";
const wid = "20000000-0000-4000-8000-000000000001",
  uid = "30000000-0000-4000-8000-000000000001";
test("MCP route verifies user identity, rejects foreign origins, and forwards only caller credentials", async (t) => {
  const keys = [
    "APP_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const originalFetch = globalThis.fetch;
  const calls: { url: string; auth: string | null; body: string }[] = [];
  const req = (
    headers: Record<string, string> = {},
    tool = "list_ai_tools",
    args: unknown = { workspace_id: wid },
  ) =>
    new Request("https://hub.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
    });
  try {
    delete process.env.APP_URL;
    assert.equal((await POST(req())).status, 503);
    process.env.APP_URL = "https://hub.test";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fixture-public-key";
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("authorization");
      calls.push({ url, auth, body: String(init?.body || "") });
      if (url.includes("/auth/v1/user"))
        return auth === "Bearer valid-user"
          ? Response.json({
              id: uid,
              email: "alice@test.com",
              aud: "authenticated",
              role: "authenticated",
              app_metadata: {},
              user_metadata: {},
              created_at: new Date().toISOString(),
            })
          : Response.json(
              { msg: "Token expired", error_code: "bad_jwt" },
              { status: 401 },
            );
      if (url.includes("/rest/v1/workspace_members")) {
        const q = new URL(url);
        return Response.json(
          q.searchParams.get("workspace_id") === `eq.${wid}`
            ? [{ user_id: uid }]
            : [],
        );
      }
      if (url.includes("/rest/v1/entries"))
        return Response.json(
          init?.method === "POST"
            ? {
                ...JSON.parse(String(init.body)),
                id: crypto.randomUUID(),
                created_at: new Date().toISOString(),
              }
            : [],
        );
      throw new Error("Unexpected backend request");
    };
    await t.test(
      "foreign Origin is rejected before authentication",
      async () => {
        assert.equal(
          (
            await POST(
              req({
                origin: "https://evil.test",
                authorization: "Bearer valid-user",
              }),
            )
          ).status,
          403,
        );
        assert.equal(calls.length, 0);
      },
    );
    await t.test(
      "missing, malformed, and expired bearer tokens return a resource challenge",
      async () => {
        for (const auth of ["", "Basic bad", "Bearer expired"]) {
          const r = await POST(req(auth ? { authorization: auth } : {}));
          assert.equal(r.status, 401);
          assert.match(
            r.headers.get("www-authenticate") || "",
            /oauth-protected-resource/,
          );
        }
      },
    );
    await t.test(
      "a verified user can list only their workspace, with their own JWT forwarded",
      async () => {
        const r = await POST(req({ authorization: "Bearer valid-user" }));
        assert.equal((await r.json()).result.isError, false);
        const rows = calls.filter((c) => c.url.includes("/rest/v1/"));
        assert.ok(rows.length >= 2);
        assert.ok(rows.every((c) => c.auth === "Bearer valid-user"));
        assert.ok(rows.find((c) => c.url.includes(`user_id=eq.${uid}`)));
      },
    );
    await t.test(
      "workspace membership failures prevent entry access",
      async () => {
        const before = calls.filter((c) =>
          c.url.includes("/rest/v1/entries"),
        ).length;
        const r = await POST(
          req({ authorization: "Bearer valid-user" }, "list_ai_tools", {
            workspace_id: "20000000-0000-4000-8000-000000000002",
          }),
        );
        assert.equal((await r.json()).result.isError, true);
        assert.equal(
          calls.filter((c) => c.url.includes("/rest/v1/entries")).length,
          before,
        );
      },
    );
    await t.test(
      "new entries are attributed to the verified identity, never a caller-supplied author",
      async () => {
        const r = await POST(
          req({ authorization: "Bearer valid-user" }, "add_ai_tool", {
            workspace_id: wid,
            title: "User discovery",
            category: "Tool",
          }),
        );
        assert.equal((await r.json()).result.isError, false);
        assert.equal(JSON.parse(calls.at(-1)!.body).author_id, uid);
        const spoof = await POST(
          req({ authorization: "Bearer valid-user" }, "add_ai_tool", {
            workspace_id: wid,
            title: "Spoofed",
            category: "Tool",
            author_id: "attacker",
          }),
        );
        assert.equal((await spoof.json()).result.isError, true);
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const k of keys) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
});
