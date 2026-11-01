import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const alice = "30000000-0000-4000-8000-000000000001",
  outsider = "30000000-0000-4000-8000-000000000002";
test("broadened sharing preserves history, author protection, membership and workspace boundaries", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
      insert into auth.users values('${alice}','alice@test.com',now()),('${outsider}','outsider@test.com',now());`);
    const migrate = async (name: string) =>
      db.exec(
        await readFile(
          new URL(`../supabase/migrations/${name}`, import.meta.url),
          "utf8",
        ),
      );
    for (const name of [
      "202610310001_initial.sql",
      "202611010001_team_chat.sql",
      "202611010002_trash_delete.sql",
    ])
      await migrate(name);
    const asUser = async (id: string) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id,
      ]);
      await db.exec("set role authenticated");
    };
    await asUser(alice);
    const wid = (
      await db.query<{ id: string }>(
        "select public.create_workspace('Team') as id",
      )
    ).rows[0].id;
    const other = (
      await db.query<{ id: string }>(
        "select public.create_workspace('Another team') as id",
      )
    ).rows[0].id;
    const library = (
      await db.query<{ id: string }>(
        "insert into public.entries(workspace_id,title,category) values($1,'Existing tool','Tool') returning id",
        [wid],
      )
    ).rows[0].id;
    const idea = (
      await db.query<{ id: string }>(
        "insert into public.entries(workspace_id,title,category,section) values($1,'New project','Workflow','ideas') returning id",
        [wid],
      )
    ).rows[0].id;
    const foreign = (
      await db.query<{ id: string }>(
        "insert into public.entries(workspace_id,title,category,section) values($1,'Foreign idea','Agent','ideas') returning id",
        [other],
      )
    ).rows[0].id;
    const old = (
      await db.query<{ id: string }>(
        "insert into public.chat_messages(workspace_id,shared_entry_id) values($1,$2) returning id",
        [wid, library],
      )
    ).rows[0].id;
    await assert.rejects(
      db.query(
        "insert into public.chat_messages(workspace_id,shared_entry_id) values($1,$2)",
        [wid, idea],
      ),
      /accessible AI Library/i,
    );
    await db.exec("reset role");
    await migrate("202611010003_chat_share_all_sections.sql");
    await asUser(alice);
    await t.test(
      "old library cards and history stay intact; both sections can be shared",
      async () => {
        assert.equal(
          (
            await db.query<{ shared_entry_id: string }>(
              "select shared_entry_id from public.chat_messages where id=$1",
              [old],
            )
          ).rows[0].shared_entry_id,
          library,
        );
        for (const entry of [library, idea])
          await db.query(
            "insert into public.chat_messages(workspace_id,shared_entry_id,reply_to) values($1,$2,$3)",
            [wid, entry, old],
          );
        assert.equal(
          (await db.query("select * from public.chat_messages")).rows.length,
          3,
        );
      },
    );
    await t.test(
      "members of two workspaces still cannot share entries across them",
      async () => {
        await assert.rejects(
          db.query(
            "insert into public.chat_messages(workspace_id,shared_entry_id) values($1,$2)",
            [wid, foreign],
          ),
          /accessible Idea Hub/i,
        );
        await assert.rejects(
          db.query(
            "insert into public.chat_messages(workspace_id,body,shared_entry_id) values($1,'Missing',$2)",
            [wid, crypto.randomUUID()],
          ),
          /accessible Idea Hub/i,
        );
      },
    );
    await t.test(
      "timestamp, author labels and author id cannot be forged; blank messages remain invalid",
      async () => {
        const row = (
          await db.query<{ author_name: string; created_at: Date }>(
            "insert into public.chat_messages(workspace_id,body,author_name,created_at) values($1,'hello','Forged','2099-01-01') returning *",
            [wid],
          )
        ).rows[0];
        assert.equal(row.author_name, "alice@test.com");
        assert.ok(new Date(row.created_at).getFullYear() < 2099);
        await assert.rejects(
          db.query(
            "insert into public.chat_messages(workspace_id,body,author_id) values($1,'Forged',$2)",
            [wid, outsider],
          ),
          /row-level/i,
        );
        await assert.rejects(
          db.query(
            "insert into public.chat_messages(workspace_id,body) values($1,E' \n\t ')",
            [wid],
          ),
          /blank/i,
        );
      },
    );
    await t.test(
      "outsiders and anonymous callers cannot share or read messages",
      async () => {
        await asUser(outsider);
        await assert.rejects(
          db.query(
            "insert into public.chat_messages(workspace_id,shared_entry_id) values($1,$2)",
            [wid, idea],
          ),
          /accessible|row-level/i,
        );
        assert.equal(
          (await db.query("select * from public.chat_messages")).rows.length,
          0,
        );
        await db.exec("reset role;set role anon");
        await assert.rejects(
          db.query("select * from public.chat_messages"),
          /permission denied/i,
        );
      },
    );
  } finally {
    await db.close();
  }
});
