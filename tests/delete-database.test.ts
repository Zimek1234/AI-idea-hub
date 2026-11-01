import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const alice = "30000000-0000-4000-8000-000000000001",
  bob = "30000000-0000-4000-8000-000000000002",
  outsider = "30000000-0000-4000-8000-000000000003";
test("permanent deletion requires current workspace membership and Trash, and preserves chat", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
      insert into auth.users values('${alice}','alice@test.com',now()),('${bob}','bob@test.com',now()),('${outsider}','outsider@test.com',now());`);
    for (const name of [
      "202610310001_initial.sql",
      "202611010001_team_chat.sql",
      "202611010002_trash_delete.sql",
    ])
      await db.exec(
        await readFile(
          new URL(`../supabase/migrations/${name}`, import.meta.url),
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
    const entry = (
      await db.query<{ id: string }>(
        "insert into public.entries(workspace_id,title,category) values($1,'A shared tool','Tool') returning id",
        [wid],
      )
    ).rows[0].id;
    await db.query("select public.invite_member($1,'bob@test.com')", [wid]);
    await asUser(bob);
    await db.query("select public.accept_invites()");
    await db.query(
      "insert into public.entry_feedback(entry_id,notes,rating) values($1,'Private notes',5)",
      [entry],
    );
    await db.query(
      "insert into public.comments(entry_id,body) values($1,'Shared comment')",
      [entry],
    );
    const message = (
      await db.query<{ id: string }>(
        "insert into public.chat_messages(workspace_id,shared_entry_id) values($1,$2) returning id",
        [wid, entry],
      )
    ).rows[0].id;
    await db.query(
      "insert into public.chat_messages(workspace_id,body,shared_entry_id,reply_to) values($1,'Keep this conversation',$2,$3)",
      [wid, entry, message],
    );
    await db.query(
      "insert into public.chat_reactions(workspace_id,message_id,emoji) values($1,$2,'👍')",
      [wid, message],
    );
    await t.test(
      "active entries cannot be deleted, including after a restore",
      async () => {
        for (const state of ["To Try", "Trash", "Using"]) {
          await db.query("update public.entries set status=$1 where id=$2", [
            state,
            entry,
          ]);
          if (state !== "Trash")
            assert.equal(
              (
                await db.query(
                  "delete from public.entries where id=$1 returning id",
                  [entry],
                )
              ).rows.length,
              0,
            );
        }
        await db.query("update public.entries set status='Trash' where id=$1", [
          entry,
        ]);
      },
    );
    await t.test(
      "an outsider cannot delete a trashed entry by guessing its id",
      async () => {
        await asUser(outsider);
        assert.equal(
          (
            await db.query(
              "delete from public.entries where id=$1 returning id",
              [entry],
            )
          ).rows.length,
          0,
        );
      },
    );
    await t.test(
      "a removed member cannot delete or manipulate chat tombstones",
      async () => {
        await asUser(alice);
        await db.query("select public.remove_member($1,$2)", [wid, bob]);
        await asUser(bob);
        assert.equal(
          (
            await db.query(
              "delete from public.entries where id=$1 returning id",
              [entry],
            )
          ).rows.length,
          0,
        );
        await assert.rejects(
          db.query("update public.chat_messages set shared_entry_deleted=true"),
          /permission denied/i,
        );
      },
    );
    await t.test(
      "another current member can delete a trashed shared entry with cascades and tombstones",
      async () => {
        await asUser(alice);
        assert.equal(
          (
            await db.query(
              "delete from public.entries where id=$1 returning id",
              [entry],
            )
          ).rows.length,
          1,
        );
        const rows = (
          await db.query<{
            workspace_id: string;
            body: string;
            shared_entry_id: string | null;
            shared_entry_deleted: boolean;
          }>("select * from public.chat_messages order by created_at")
        ).rows;
        assert.equal(rows.length, 2);
        assert.ok(
          rows.every(
            (r) =>
              r.workspace_id === wid &&
              r.shared_entry_id === null &&
              r.shared_entry_deleted,
          ),
        );
        assert.equal(rows[0].body, "");
        assert.equal(rows[1].body, "Keep this conversation");
        assert.equal(
          (await db.query("select * from public.chat_reactions")).rows.length,
          1,
        );
        await db.exec("reset role");
        assert.equal(
          (await db.query("select * from public.entry_feedback")).rows.length,
          0,
        );
        assert.equal(
          (await db.query("select * from public.comments")).rows.length,
          0,
        );
      },
    );
    await t.test(
      "clients cannot forge empty tombstones or share a deleted id",
      async () => {
        await asUser(alice);
        await assert.rejects(
          db.query(
            "insert into public.chat_messages(workspace_id,body,shared_entry_deleted) values($1,'',true)",
            [wid],
          ),
          /blank/i,
        );
        await assert.rejects(
          db.query(
            "insert into public.chat_messages(workspace_id,shared_entry_id) values($1,$2)",
            [wid, entry],
          ),
          /accessible/i,
        );
        const row = (
          await db.query<{ shared_entry_deleted: boolean }>(
            "insert into public.chat_messages(workspace_id,body,shared_entry_deleted) values($1,'Hello',true) returning *",
            [wid],
          )
        ).rows[0];
        assert.equal(row.shared_entry_deleted, false);
      },
    );
    await t.test("anonymous callers cannot delete entries", async () => {
      await db.exec("reset role; set role anon");
      await assert.rejects(
        db.query("delete from public.entries"),
        /permission denied/i,
      );
    });
  } finally {
    await db.close();
  }
});
