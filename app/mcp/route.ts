import { createClient } from "@supabase/supabase-js";
import { handleRpc, type Store } from "../../lib/mcp.ts";
import { type Entry } from "../../lib/validation.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function origin() {
  return process.env.APP_URL?.replace(/\/$/, "");
}
function unauthorized() {
  const resource = `${origin()}/.well-known/oauth-protected-resource`;
  return Response.json(
    { error: "A valid individual Supabase access token is required." },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${resource}", scope="openid email profile"`,
        "Cache-Control": "no-store",
      },
    },
  );
}
export async function POST(request: Request) {
  const canonical = origin(),
    url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!canonical || !url || !key)
    return Response.json({ error: "MCP is not configured." }, { status: 503 });
  const source = request.headers.get("origin");
  if (source && source !== canonical)
    return Response.json({ error: "Origin is not allowed." }, { status: 403 });
  // User tokens only. Never authenticate with a shared service key or accept client-supplied user IDs.
  const bearer = request.headers.get("authorization");
  if (!bearer || !/^Bearer [^\s]+$/i.test(bearer)) return unauthorized();
  const token = bearer.slice(7);
  const db = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return unauthorized();
  async function membership(wid: string) {
    const r = await db
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", wid)
      .eq("user_id", data.user!.id)
      .maybeSingle();
    if (r.error || !r.data)
      throw new Error("Workspace not found or access denied.");
  }
  function result<T>(r: {
    data: T | null;
    error: { code?: string } | null;
  }): T {
    if (r.error)
      throw new Error(
        r.error.code === "23505"
          ? "A discovery with this title or URL already exists."
          : "Operation denied or invalid data.",
      );
    if (r.data === null) throw new Error("Entry not found or access denied.");
    return r.data;
  }
  const store: Store = {
    async list(wid, filters) {
      await membership(wid);
      let q = db
        .from("entries")
        .select("*")
        .eq("workspace_id", wid)
        .order("created_at", { ascending: false })
        .order("id");
      for (const k of ["status", "category", "section"])
        if (filters[k] !== undefined) q = q.eq(k, filters[k]);
      return result(
        await q.range(
          Number(filters.offset),
          Number(filters.offset) + Number(filters.limit) - 1,
        ),
      ) as Entry[];
    },
    async search(wid, query, limit, offset) {
      await membership(wid);
      return result(
        await db
          .rpc("search_entries", { wid, query_text: query })
          .order("created_at", { ascending: false })
          .order("id")
          .range(offset, offset + limit - 1),
      ) as Entry[];
    },
    async get(wid, id) {
      await membership(wid);
      return result(
        await db
          .from("entries")
          .select("*")
          .eq("workspace_id", wid)
          .eq("id", id)
          .single(),
      ) as Entry;
    },
    async add(wid, value) {
      await membership(wid);
      return result(
        await db
          .from("entries")
          .insert({ ...value, workspace_id: wid, author_id: data.user!.id })
          .select()
          .single(),
      ) as Entry;
    },
    async update(wid, id, value) {
      await membership(wid);
      return result(
        await db
          .from("entries")
          .update(value)
          .eq("workspace_id", wid)
          .eq("id", id)
          .select()
          .single(),
      ) as Entry;
    },
  };
  return handleRpc(request, store);
}
export function GET() {
  return Response.json(
    {
      error:
        "This stateless MCP server supports POST JSON responses; SSE listening is not supported.",
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}
export function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
