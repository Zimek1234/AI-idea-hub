// Real local PostgreSQL + PostgREST regression test. Never connects to Supabase.
// Requires Docker and postgres:17-alpine / postgrest/postgrest:v14.1 images.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHmac, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { CHAT_MESSAGE_SELECT, loadChatReplies } from "../lib/chat-api.ts";
const env = { ...process.env };
for (const key of [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete env[key];
const docker = (...args) =>
  execFileSync("docker", ["--host=unix:///var/run/docker.sock", ...args], {
    env,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const prefix = `hub-chat-test-${randomUUID().slice(0, 8)}`,
  dbName = `${prefix}-db`,
  apiName = `${prefix}-api`;
const jwtSecret = "local-fixture-jwt-secret-at-least-32-characters";
const alice = "30000000-0000-4000-8000-000000000001",
  bob = "30000000-0000-4000-8000-000000000002",
  outsider = "30000000-0000-4000-8000-000000000003";
const wid = "20000000-0000-4000-8000-000000000001",
  entryId = "10000000-0000-4000-8000-000000000001",
  messageId = "40000000-0000-4000-8000-000000000001";
const sql = (input) =>
  execFileSync(
    "docker",
    [
      "--host=unix:///var/run/docker.sock",
      "exec",
      "-i",
      dbName,
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { env, encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] },
  );
const token = (sub) => {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role: "authenticated", sub, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${unsigned}.${createHmac("sha256", jwtSecret).update(unsigned).digest("base64url")}`;
};
const waitFor = async (action) => {
  for (let i = 0; i < 60; i++) {
    try {
      if (await action()) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Local database/API did not become ready");
};
try {
  docker("info", "--format", "{{.ServerVersion}}");
  docker("network", "create", prefix);
  docker(
    "run",
    "-d",
    "--name",
    dbName,
    "--network",
    prefix,
    "-e",
    "POSTGRES_PASSWORD=local-fixture-only",
    "postgres:17-alpine",
    "-c",
    "wal_level=logical",
  );
  // initdb briefly starts a socket-only temporary server, then restarts it.
  // Wait for TCP so migrations never race that temporary server's shutdown.
  await waitFor(() =>
    docker("exec", dbName, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"),
  );
  sql(`create role anon; create role authenticated; create role authenticator login password 'local-fixture-only' noinherit; grant anon,authenticated to authenticator; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
    grant usage on schema public,auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    create publication supabase_realtime;`);
  for (const name of ["202610310001_initial.sql", "202611010001_team_chat.sql"])
    sql(
      await readFile(
        new URL(`../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  sql(`insert into auth.users values('${alice}','alice@test.com',now()),('${bob}','bob@test.com',now()),('${outsider}','outsider@test.com',now());
    insert into public.workspaces(id,name,owner_id) values('${wid}','Local test room','${alice}');
    insert into public.workspace_members values('${wid}','${alice}','alice@test.com'),('${wid}','${bob}','bob@test.com');
    select set_config('request.jwt.claims','{"sub":"${alice}"}',false); set role authenticated;
    insert into public.entries(id,workspace_id,title,category) values('${entryId}','${wid}','Shared research tool','Tool');
    insert into public.entry_feedback(entry_id,notes) values('${entryId}','Private notes');
    insert into public.comments(entry_id,body) values('${entryId}','A comment');
    insert into public.chat_messages(id,workspace_id,shared_entry_id) values('${messageId}','${wid}','${entryId}');
    insert into public.chat_messages(workspace_id,body,reply_to) values('${wid}','A real reply','${messageId}');`);
  docker(
    "run",
    "-d",
    "--name",
    apiName,
    "--network",
    prefix,
    "-p",
    "127.0.0.1::3000",
    "-e",
    `PGRST_DB_URI=postgres://authenticator:local-fixture-only@${dbName}:5432/postgres`,
    "-e",
    "PGRST_DB_ANON_ROLE=anon",
    "-e",
    `PGRST_JWT_SECRET=${jwtSecret}`,
    process.env.POSTGREST_IMAGE || "postgrest/postgrest:v14.1",
  );
  const port = docker("port", apiName, "3000/tcp").split(":").at(-1),
    origin = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(origin)).ok);
  const client = (user) =>
    createClient(origin, "local-fixture-public-key", {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: { Authorization: `Bearer ${token(user)}` },
        fetch: (input, init) => {
          const url = new URL(input);
          url.pathname = url.pathname.replace(/^\/rest\/v1/, "");
          return fetch(url, init);
        },
      },
    });
  const member = client(alice),
    peer = client(bob),
    foreign = client(outsider);
  const original = await member
    .from("chat_messages")
    .select(
      `${CHAT_MESSAGE_SELECT},reply:chat_messages!chat_messages_workspace_id_reply_to_fkey(id,body,author_id,author_name)`,
    )
    .eq("workspace_id", wid);
  assert.equal(original.status, 400);
  assert.equal(original.error.code, "PGRST200");
  console.log(
    "PASS reproduced original self-embed failure: HTTP 400 / PGRST200 with both original migrations applied",
  );
  const history = await member
    .from("chat_messages")
    .select(CHAT_MESSAGE_SELECT)
    .eq("workspace_id", wid)
    .order("created_at");
  assert.ifError(history.error);
  assert.equal(history.data.length, 2);
  const hydrated = await loadChatReplies(member, wid, history.data);
  assert.equal(hydrated[1].reply.id, messageId);
  assert.equal(hydrated[0].shared_entry.title, "Shared research tool");
  const hidden = await foreign
    .from("chat_messages")
    .select(CHAT_MESSAGE_SELECT)
    .eq("workspace_id", wid);
  assert.ifError(hidden.error);
  assert.deepEqual(hidden.data, []);
  const guessed = await loadChatReplies(foreign, wid, [{ ...history.data[1] }]);
  assert.equal(guessed[0].reply, null);
  console.log(
    "PASS fixed history/reply/card queries work through real PostgREST under member and outsider JWTs",
  );
  // The frontend fix works before the deletion migration. Apply it only to this disposable DB.
  sql(
    await readFile(
      new URL(
        "../supabase/migrations/202611010002_trash_delete.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await waitFor(
    async () =>
      !(await member.from("chat_messages").select("shared_entry_deleted"))
        .error,
  );
  let deletion = await member
    .from("entries")
    .delete()
    .eq("id", entryId)
    .select("id");
  assert.ifError(deletion.error);
  assert.deepEqual(deletion.data, []);
  assert.ifError(
    (await member.from("entries").update({ status: "Trash" }).eq("id", entryId))
      .error,
  );
  deletion = await foreign
    .from("entries")
    .delete()
    .eq("id", entryId)
    .select("id");
  assert.ifError(deletion.error);
  assert.deepEqual(deletion.data, []);
  deletion = await peer
    .from("entries")
    .delete()
    .eq("id", entryId)
    .eq("status", "Trash")
    .select("id")
    .maybeSingle();
  assert.ifError(deletion.error);
  assert.equal(deletion.data.id, entryId);
  const after = await member
    .from("chat_messages")
    .select(CHAT_MESSAGE_SELECT)
    .eq("workspace_id", wid)
    .order("created_at");
  assert.ifError(after.error);
  assert.equal(after.data.length, 2);
  assert.equal(after.data[0].shared_entry_id, null);
  assert.equal(after.data[0].shared_entry_deleted, true);
  assert.equal(after.data[0].workspace_id, wid);
  for (const table of ["comments", "entry_feedback"]) {
    const r = await member.from(table).select("*");
    assert.ifError(r.error);
    assert.deepEqual(r.data, []);
  }
  const created = await peer
    .from("chat_messages")
    .insert({ workspace_id: wid, body: "Still works", reply_to: messageId })
    .select(CHAT_MESSAGE_SELECT)
    .single();
  assert.ifError(created.error);
  assert.equal(
    (await loadChatReplies(peer, wid, [created.data]))[0].reply.id,
    messageId,
  );
  console.log(
    "PASS real PostgREST deletion: active/foreign rows protected, member deletes Trash, notes/comments cascade, chat history and replies survive",
  );
  const idea = await member
    .from("entries")
    .insert({
      workspace_id: wid,
      title: "Research project",
      category: "Workflow",
      section: "ideas",
    })
    .select("id")
    .single();
  assert.ifError(idea.error);
  const beforeMigration = await peer
    .from("chat_messages")
    .insert({ workspace_id: wid, shared_entry_id: idea.data.id });
  assert.ok(beforeMigration.error);
  sql(
    await readFile(
      new URL(
        "../supabase/migrations/202611010003_chat_share_all_sections.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const sharedIdea = await peer
    .from("chat_messages")
    .insert({ workspace_id: wid, shared_entry_id: idea.data.id })
    .select(CHAT_MESSAGE_SELECT)
    .single();
  assert.ifError(sharedIdea.error);
  assert.equal(sharedIdea.data.shared_entry.section, "ideas");
  assert.equal(sharedIdea.data.shared_entry.title, "Research project");
  const forbidden = await foreign
    .from("chat_messages")
    .insert({ workspace_id: wid, shared_entry_id: idea.data.id });
  assert.ok(forbidden.error);
  console.log(
    "PASS real PostgREST idea sharing works after the new trigger migration; section metadata and membership protection are preserved",
  );
} finally {
  for (const name of [apiName, dbName]) {
    try {
      docker("rm", "-f", name);
    } catch {}
  }
  try {
    docker("network", "rm", prefix);
  } catch {}
}
