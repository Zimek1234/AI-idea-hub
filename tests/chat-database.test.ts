import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const alice = "30000000-0000-4000-8000-000000000001",
  bob = "30000000-0000-4000-8000-000000000002",
  outsider = "30000000-0000-4000-8000-000000000003";
test("team chat migration enforces PostgreSQL permissions and workspace isolation", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
      insert into auth.users values('${alice}','alice@test.com',now()),('${bob}','bob@test.com',now()),('${outsider}','outsider@test.com',now());
      create publication supabase_realtime;`);
    for (const file of [
      "202610310001_initial.sql",
      "202611010001_team_chat.sql",
    ])
      await db.exec(
        await readFile(
          new URL(`../supabase/migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
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
    const tool = (
      await db.query<{ id: string }>(
        "insert into public.entries(workspace_id,title,category) values($1,'Research tool','Tool') returning id",
        [wid],
      )
    ).rows[0].id;
    const idea = (
      await db.query<{ id: string }>(
        "insert into public.entries(workspace_id,title,category,section) values($1,'An idea','Prompt','ideas') returning id",
        [wid],
      )
    ).rows[0].id;
    await db.query("select public.invite_member($1,'bob@test.com')", [wid]);
    await asUser(bob);
    await db.query("select public.accept_invites()");
    await asUser(outsider);
    const foreign = (
      await db.query<{ id: string }>(
        "select public.create_workspace('Other team') as id",
      )
    ).rows[0].id;
    const foreignTool = (
      await db.query<{ id: string }>(
        "insert into public.entries(workspace_id,title,category) values($1,'Secret tool','Tool') returning id",
        [foreign],
      )
    ).rows[0].id;
    const foreignMessage = (
      await db.query<{ id: string }>(
        "insert into public.chat_messages(workspace_id,body) values($1,'Secret message') returning id",
        [foreign],
      )
    ).rows[0].id;
    await asUser(alice);
    let message = "",
      reply = "";
    await t.test(
      "members persist messages, replies and tool cards with server timestamps",
      async () => {
        const result = (
          await db.query<{
            id: string;
            body: string;
            created_at: Date;
            author_name: string;
          }>(
            "insert into public.chat_messages(workspace_id,body,created_at,author_name) values($1,'  Hello team  ','2099-01-01','Impersonated display name') returning *",
            [wid],
          )
        ).rows[0];
        message = result.id;
        assert.equal(result.body, "Hello team");
        assert.equal(result.author_name, "alice@test.com");
        assert.ok(new Date(result.created_at).getFullYear() < 2099);
        await asUser(bob);
        reply = (
          await db.query<{ id: string }>(
            "insert into public.chat_messages(workspace_id,body,reply_to,shared_entry_id) values($1,'Try this',$2,$3) returning id",
            [wid, message, tool],
          )
        ).rows[0].id;
        assert.equal(
          (
            await db.query(
              "select * from public.chat_messages where workspace_id=$1",
              [wid],
            )
          ).rows.length,
          2,
        );
        await db.query(
          "insert into public.chat_messages(workspace_id,shared_entry_id) values($1,$2)",
          [wid, tool],
        );
      },
    );
    await t.test(
      "messages reject blank text, oversize input, identity spoofing and invalid references",
      async () => {
        for (const body of ["", " \n\t ", "x".repeat(3001)])
          await assert.rejects(
            db.query(
              "insert into public.chat_messages(workspace_id,body) values($1,$2)",
              [wid, body],
            ),
          );
        await assert.rejects(
          db.query(
            "insert into public.chat_messages(workspace_id,body,author_id) values($1,'Forged',$2)",
            [wid, alice],
          ),
          /row-level/i,
        );
        await assert.rejects(
          db.query(
            "insert into public.chat_messages(workspace_id,body,reply_to) values($1,'Cross room',$2)",
            [wid, foreignMessage],
          ),
          /foreign key/i,
        );
        for (const id of [foreignTool, idea])
          await assert.rejects(
            db.query(
              "insert into public.chat_messages(workspace_id,shared_entry_id) values($1,$2)",
              [wid, id],
            ),
            /accessible AI Library/i,
          );
        await assert.rejects(
          db.query(
            "update public.chat_messages set body='Rewrite' where id=$1",
            [message],
          ),
          /permission denied/i,
        );
        await assert.rejects(
          db.query("delete from public.chat_messages where id=$1", [message]),
          /permission denied/i,
        );
      },
    );
    await t.test(
      "outsiders cannot read, post, react, reply or mark another workspace read",
      async () => {
        await asUser(outsider);
        assert.equal(
          (
            await db.query(
              "select * from public.chat_messages where workspace_id=$1",
              [wid],
            )
          ).rows.length,
          0,
        );
        for (const sql of [
          "select * from public.chat_reactions where workspace_id=$1",
          "select * from public.chat_reads where workspace_id=$1",
        ])
          assert.equal((await db.query(sql, [wid])).rows.length, 0);
        await assert.rejects(
          db.query(
            "insert into public.chat_messages(workspace_id,body) values($1,'Intrusion')",
            [wid],
          ),
          /row-level/i,
        );
        await assert.rejects(
          db.query(
            "insert into public.chat_reactions(workspace_id,message_id,emoji) values($1,$2,'👍')",
            [wid, message],
          ),
          /row-level/i,
        );
        await db.query("select public.mark_chat_read($1,$2)", [wid, message]);
        assert.equal(
          (await db.query("select * from public.chat_reads")).rows.length,
          0,
        );
        await assert.rejects(
          db.query(
            "insert into public.chat_messages(workspace_id,body,reply_to) values($1,'Guessed reference',$2)",
            [foreign, message],
          ),
          /foreign key/i,
        );
      },
    );
    await t.test(
      "reactions are per-user toggles and cannot impersonate or move another reaction",
      async () => {
        await asUser(alice);
        await db.query(
          "insert into public.chat_reactions(workspace_id,message_id,emoji) values($1,$2,'👍')",
          [wid, message],
        );
        await assert.rejects(
          db.query(
            "insert into public.chat_reactions(workspace_id,message_id,emoji) values($1,$2,'fake')",
            [wid, message],
          ),
          /check/i,
        );
        await asUser(bob);
        assert.equal(
          (await db.query("select * from public.chat_reactions")).rows.length,
          1,
        );
        assert.equal(
          (
            await db.query(
              "update public.chat_reactions set active=false returning *",
            )
          ).rows.length,
          0,
        );
        await assert.rejects(
          db.query(
            "insert into public.chat_reactions(workspace_id,message_id,user_id,emoji) values($1,$2,$3,'🚀')",
            [wid, message, alice],
          ),
          /row-level/i,
        );
        await assert.rejects(
          db.query(
            "insert into public.chat_reactions(workspace_id,message_id,emoji) values($1,$2,'🚀')",
            [wid, foreignMessage],
          ),
          /foreign key/i,
        );
        await asUser(alice);
        await assert.rejects(
          db.query("update public.chat_reactions set message_id=$1", [reply]),
          /immutable/i,
        );
        await db.query(
          "insert into public.chat_reactions(workspace_id,message_id,emoji,active) values($1,$2,'👍',false) on conflict(message_id,user_id,emoji) do update set active=excluded.active",
          [wid, message],
        );
        assert.equal(
          (
            await db.query<{ active: boolean }>(
              "select active from public.chat_reactions",
            )
          ).rows[0].active,
          false,
        );
      },
    );
    await t.test(
      "read cursors persist privately, move forward and exclude unread messages accurately",
      async () => {
        await db.query("select public.mark_chat_read($1,$2)", [wid, message]);
        assert.equal(
          (
            await db.query<{ count: number }>(
              "select count(*)::int as count from public.chat_messages where workspace_id=$1 and author_id<>auth.uid() and created_at>(select read_at from public.chat_reads where workspace_id=$1)",
              [wid],
            )
          ).rows[0].count,
          2,
        );
        await db.query("select public.mark_chat_read($1,$2)", [wid, reply]);
        const cursor = (
          await db.query<{ read_at: string }>(
            "select read_at from public.chat_reads",
          )
        ).rows[0].read_at;
        await db.query("select public.mark_chat_read($1,$2)", [wid, message]);
        assert.deepEqual(
          (
            await db.query<{ read_at: string }>(
              "select read_at from public.chat_reads",
            )
          ).rows[0].read_at,
          cursor,
        );
        await assert.rejects(
          db.query("update public.chat_reads set read_at='2099-01-01'"),
          /row-level/i,
        );
        await asUser(bob);
        assert.equal(
          (await db.query("select * from public.chat_reads")).rows.length,
          0,
        );
        await assert.rejects(
          db.query(
            "insert into public.chat_reads(workspace_id,user_id,read_at) values($1,$2,now())",
            [wid, alice],
          ),
          /row-level/i,
        );
      },
    );
    await t.test(
      "membership revocation removes history, reactions and write access",
      async () => {
        await asUser(alice);
        await db.query("select public.remove_member($1,$2)", [wid, bob]);
        await asUser(bob);
        for (const table of ["chat_messages", "chat_reactions", "chat_reads"])
          assert.equal(
            (await db.query(`select * from public.${table}`)).rows.length,
            0,
          );
        await assert.rejects(
          db.query(
            "insert into public.chat_messages(workspace_id,body) values($1,'Removed')",
            [wid],
          ),
          /row-level/i,
        );
        await assert.rejects(
          db.query(
            "insert into public.chat_reactions(workspace_id,message_id,emoji) values($1,$2,'👀')",
            [wid, message],
          ),
          /row-level/i,
        );
      },
    );
    await t.test(
      "anonymous users have no chat access; publication contains all chat tables",
      async () => {
        await db.exec("reset role; set role anon");
        for (const table of ["chat_messages", "chat_reactions", "chat_reads"])
          await assert.rejects(
            db.query(`select * from public.${table}`),
            /permission denied/i,
          );
        await assert.rejects(
          db.query("select public.mark_chat_read($1,$2)", [wid, message]),
          /permission denied/i,
        );
        await db.exec("reset role");
        const tables = (
          await db.query<{ tablename: string }>(
            "select tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename",
          )
        ).rows.map((r) => r.tablename);
        assert.deepEqual(tables, [
          "chat_messages",
          "chat_reactions",
          "chat_reads",
        ]);
      },
    );
  } finally {
    await db.close();
  }
});
