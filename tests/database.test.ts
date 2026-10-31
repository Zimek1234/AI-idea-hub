import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const alice = "30000000-0000-4000-8000-000000000001",
  bob = "30000000-0000-4000-8000-000000000002",
  outsider = "30000000-0000-4000-8000-000000000003";
test("PostgreSQL migration and real RLS permission boundaries", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 insert into auth.users values('${alice}','alice@test.com',now()),('${bob}','bob@test.com',now()),('${outsider}','outsider@test.com',now());`);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202610310001_initial.sql",
          import.meta.url,
        ),
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
    const workspace = (
      await db.query<{ id: string }>(
        "select public.create_workspace('Research room') as id",
      )
    ).rows[0].id;
    let entry = "";
    await t.test(
      "owner creates workspace and membership, can insert an entry",
      async () => {
        assert.equal(
          (await db.query("select * from public.workspace_members")).rows
            .length,
          1,
        );
        entry = (
          await db.query<{ id: string }>(
            "insert into public.entries(workspace_id,title,category,source_url) values($1,'Claude','Tool','https://claude.ai') returning id",
            [workspace],
          )
        ).rows[0].id;
      },
    );
    await t.test(
      "constraints reject duplicate titles, script URLs and invalid tags",
      async () => {
        await assert.rejects(
          db.query(
            "insert into public.entries(workspace_id,title,category) values($1,'claude','Tool')",
            [workspace],
          ),
          /unique/i,
        );
        await assert.rejects(
          db.query(
            "insert into public.entries(workspace_id,title,category,source_url) values($1,'Unsafe','Tool','javascript:alert(1)')",
            [workspace],
          ),
          /check/i,
        );
        await assert.rejects(
          db.query("update public.entries set tags=array[''] where id=$1", [
            entry,
          ]),
          /Invalid tag/,
        );
      },
    );
    await t.test(
      "unrelated users cannot read or mutate workspace data",
      async () => {
        await asUser(outsider);
        assert.equal(
          (await db.query("select * from public.entries")).rows.length,
          0,
        );
        assert.equal(
          (await db.query("select * from public.workspace_members")).rows
            .length,
          0,
        );
        await assert.rejects(
          db.query(
            "insert into public.entries(workspace_id,title,category) values($1,'Attack','Tool')",
            [workspace],
          ),
          /row-level/i,
        );
        assert.equal(
          (
            await db.query(
              "update public.entries set title='Attack' where id=$1 returning id",
              [entry],
            )
          ).rows.length,
          0,
        );
        await assert.rejects(
          db.query("select public.invite_member($1,'evil@test.com')", [
            workspace,
          ]),
          /owner/i,
        );
      },
    );
    await t.test(
      "an invitation is accepted only by the matching verified email",
      async () => {
        await asUser(alice);
        await db.query("select public.invite_member($1,'bob@test.com')", [
          workspace,
        ]);
        await asUser(outsider);
        await db.query("select public.accept_invites()");
        assert.equal(
          (await db.query("select * from public.workspaces")).rows.length,
          0,
        );
        await asUser(bob);
        await db.query("select public.accept_invites()");
        assert.equal(
          (await db.query("select * from public.entries")).rows.length,
          1,
        );
        assert.equal(
          (await db.query("select * from public.workspace_members")).rows
            .length,
          2,
        );
      },
    );
    await t.test(
      "members collaborate but cannot change identity or invite others",
      async () => {
        await db.query("update public.entries set status='Using' where id=$1", [
          entry,
        ]);
        await assert.rejects(
          db.query("update public.entries set author_id=$1 where id=$2", [
            bob,
            entry,
          ]),
          /immutable/i,
        );
        await assert.rejects(
          db.query("select public.invite_member($1,'extra@test.com')", [
            workspace,
          ]),
          /owner/i,
        );
        await assert.rejects(
          db.query(
            "insert into public.entries(workspace_id,title,category,author_id) values($1,'Spoof','Tool',$2)",
            [workspace, alice],
          ),
          /row-level/i,
        );
      },
    );
    await t.test(
      "personal feedback stays private; comments are shared and author-owned",
      async () => {
        await asUser(alice);
        await db.query(
          "insert into public.entry_feedback(entry_id,rating,notes) values($1,5,'private')",
          [entry],
        );
        await db.query(
          "insert into public.comments(entry_id,body) values($1,'shared')",
          [entry],
        );
        await asUser(bob);
        assert.equal(
          (await db.query("select * from public.entry_feedback")).rows.length,
          0,
        );
        assert.equal(
          (await db.query("select * from public.comments")).rows.length,
          1,
        );
        assert.equal(
          (await db.query("delete from public.comments returning id")).rows
            .length,
          0,
        );
        await assert.rejects(
          db.query(
            "insert into public.entry_feedback(entry_id,user_id,rating) values($1,$2,1)",
            [entry, alice],
          ),
          /row-level/i,
        );
      },
    );
    await t.test(
      "search runs as the caller and never leaks another workspace",
      async () => {
        assert.equal(
          (
            await db.query("select * from public.search_entries($1,'Claude')", [
              workspace,
            ])
          ).rows.length,
          1,
        );
        await asUser(outsider);
        assert.equal(
          (
            await db.query("select * from public.search_entries($1,'Claude')", [
              workspace,
            ])
          ).rows.length,
          0,
        );
      },
    );
    await t.test(
      "pending invitations reserve seats and enforce the five-person limit",
      async () => {
        await asUser(alice);
        for (let i = 1; i <= 3; i++)
          await db.query("select public.invite_member($1,$2)", [
            workspace,
            `seat${i}@test.com`,
          ]);
        await assert.rejects(
          db.query("select public.invite_member($1,'overflow@test.com')", [
            workspace,
          ]),
          /5 people/i,
        );
      },
    );
    await t.test(
      "revoking membership immediately removes access to entries, comments and feedback",
      async () => {
        await db.query("select public.remove_member($1,$2)", [workspace, bob]);
        await asUser(bob);
        assert.equal(
          (await db.query("select * from public.entries")).rows.length,
          0,
        );
        assert.equal(
          (await db.query("select * from public.comments")).rows.length,
          0,
        );
        assert.equal(
          (await db.query("select * from public.entry_feedback")).rows.length,
          0,
        );
        await asUser(alice);
        await assert.rejects(
          db.query("select public.remove_member($1,$2)", [workspace, alice]),
          /owner/i,
        );
      },
    );
    await t.test(
      "anonymous users cannot read tables or invoke privileged functions",
      async () => {
        await db.exec("reset role;set role anon");
        await assert.rejects(
          db.query("select * from public.entries"),
          /permission denied/i,
        );
        await assert.rejects(
          db.query("select public.create_workspace('bad')"),
          /permission denied/i,
        );
      },
    );
  } finally {
    await db.close();
  }
});
