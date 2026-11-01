// Run against a local dev server configured with the fixture URL below. All Supabase traffic is intercepted.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const origin = process.env.TEST_URL || "http://localhost:3001";
const wid = "20000000-0000-4000-8000-000000000001",
  otherWid = "20000000-0000-4000-8000-000000000002";
const alice = "30000000-0000-4000-8000-000000000001",
  bob = "30000000-0000-4000-8000-000000000002";
const entry = {
  id: "10000000-0000-4000-8000-000000000001",
  workspace_id: wid,
  title: "Research tool",
  description: "A shared discovery",
  category: "Tool",
  section: "library",
  status: "To Try",
  source_url: null,
  tags: [],
  notes: "",
  author_id: alice,
  created_at: "2026-10-30T09:00:00Z",
};
const messages = Array.from({ length: 55 }, (_, i) => ({
  id: randomUUID(),
  workspace_id: wid,
  author_id: bob,
  author_name: "bob@test.com",
  body: `Earlier thought ${i + 1}`,
  created_at: new Date(Date.UTC(2026, 9, 30, 9, i)).toISOString(),
  reply_to: null,
  shared_entry_id: null,
  reactions: [],
  reply: null,
  shared_entry: null,
}));
let readAt = null,
  authorized = true,
  failNext = false,
  posts = 0;
let entryDeleted = false,
  denyDelete = true;
const sockets = new Set();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
function emit(table, type, row) {
  for (const socket of sockets) {
    if (!socket.topic) continue;
    const ids = socket.bindings
      .filter(
        (b) =>
          b.table === table &&
          b.event === type &&
          b.filter === `workspace_id=eq.${row.workspace_id}`,
      )
      .map((b) => b.id);
    socket.ws.send(
      JSON.stringify([
        socket.joinRef,
        null,
        socket.topic,
        "postgres_changes",
        {
          ids,
          data: {
            schema: "public",
            table,
            type,
            commit_timestamp: new Date().toISOString(),
            columns: [],
            record: row,
            old_record: {},
            errors: [],
          },
        },
      ]),
    );
  }
}
await page.routeWebSocket("wss://chat-fixture.supabase.co/**", (ws) => {
  const socket = { ws, topic: null, joinRef: null, bindings: [] };
  sockets.add(socket);
  ws.onMessage((raw) => {
    const [joinRef, ref, topic, event, payload] = JSON.parse(String(raw));
    if (event === "phx_join") {
      socket.topic = topic;
      socket.joinRef = joinRef;
      socket.bindings = payload.config.postgres_changes.map((b, i) => ({
        ...b,
        id: i + 1,
      }));
      assert.ok(
        socket.bindings.every((b) => b.event !== "*" && b.event !== "DELETE"),
      );
      ws.send(
        JSON.stringify([
          joinRef,
          ref,
          topic,
          "phx_reply",
          { status: "ok", response: { postgres_changes: socket.bindings } },
        ]),
      );
    } else if (event === "phx_leave") {
      socket.topic = null;
      ws.send(
        JSON.stringify([
          joinRef,
          ref,
          topic,
          "phx_reply",
          { status: "ok", response: {} },
        ]),
      );
    } else if (event === "heartbeat") {
      ws.send(
        JSON.stringify([
          joinRef,
          ref,
          topic,
          "phx_reply",
          { status: "ok", response: {} },
        ]),
      );
    }
  });
  ws.onClose(() => sockets.delete(socket));
});
await page.route("https://chat-fixture.supabase.co/**", async (route) => {
  const request = route.request(),
    url = new URL(request.url()),
    table = url.pathname.split("/").at(-1);
  const json = async (data) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  if (table === "accept_invites") return json(null);
  if (table === "workspaces")
    return json([
      { id: wid, name: "Research room", owner_id: alice },
      { id: otherWid, name: "Second room", owner_id: alice },
    ]);
  if (table === "workspace_members")
    return json(
      authorized
        ? [
            { user_id: alice, email: "alice@test.com" },
            { user_id: bob, email: "bob@test.com" },
          ].filter(
            (m) =>
              !url.searchParams.has("user_id") ||
              url.searchParams.get("user_id") === `eq.${m.user_id}`,
          )
        : [],
    );
  if (table === "entries") {
    if (request.method() === "PATCH")
      Object.assign(entry, request.postDataJSON());
    if (request.method() === "DELETE") {
      assert.equal(url.searchParams.get("workspace_id"), `eq.${wid}`);
      assert.equal(url.searchParams.get("id"), `eq.${entry.id}`);
      assert.equal(url.searchParams.get("status"), "eq.Trash");
      if (denyDelete) {
        denyDelete = false;
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ code: "42501", message: "Permission denied" }),
        });
      }
      assert.equal(entry.status, "Trash");
      entryDeleted = true;
      for (const message of messages) {
        if (message.shared_entry_id === entry.id) {
          message.shared_entry_id = null;
          message.shared_entry = null;
          message.shared_entry_deleted = true;
          emit("chat_messages", "UPDATE", message);
        }
      }
      return json(
        request.headers().accept?.includes("object")
          ? { id: entry.id }
          : [{ id: entry.id }],
      );
    }
    return json(
      entryDeleted
        ? []
        : request.headers().accept?.includes("object")
          ? entry
          : [entry],
    );
  }
  if (table === "entry_feedback" || table === "comments") return json([]);
  if (table === "workspace_invites") return json([]);
  if (table === "chat_reads")
    return json(
      readAt && url.searchParams.get("workspace_id") === `eq.${wid}`
        ? [{ read_at: readAt }]
        : [],
    );
  if (table === "mark_chat_read") {
    const data = request.postDataJSON(),
      message = messages.find((m) => m.id === data.last_message_id);
    if (message && (!readAt || message.created_at > readAt))
      readAt = message.created_at;
    return json(null);
  }
  if (table === "chat_reactions") {
    const data = request.postDataJSON(),
      m = messages.find((m) => m.id === data.message_id);
    m.reactions = [
      ...m.reactions.filter(
        (r) => r.user_id !== data.user_id || r.emoji !== data.emoji,
      ),
      data,
    ];
    emit("chat_reactions", "UPDATE", data);
    return json(null);
  }
  if (table === "chat_messages") {
    if (url.searchParams.get("select")?.includes("reply:chat_messages!")) {
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          code: "PGRST200",
          message: "Composite self-reference cannot be embedded",
        }),
      });
    }
    if (request.method() === "POST") {
      posts++;
      if (failNext) {
        failNext = false;
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "Simulated unavailable backend" }),
        });
      }
      const data = request.postDataJSON();
      const row = {
        ...data,
        author_name: "alice@test.com",
        created_at: new Date().toISOString(),
        reactions: [],
        reply: messages.find((m) => m.id === data.reply_to) || null,
        shared_entry: data.shared_entry_id ? entry : null,
      };
      messages.push(row);
      emit("chat_messages", "INSERT", row);
      return json(row);
    }
    let rows =
      authorized && url.searchParams.get("workspace_id") !== `eq.${otherWid}`
        ? [...messages]
        : [];
    if (url.searchParams.has("id")) {
      const filter = url.searchParams.get("id");
      rows = rows.filter((m) =>
        filter.startsWith("in.(")
          ? filter.slice(4, -1).split(",").includes(m.id)
          : filter === `eq.${m.id}`,
      );
    }
    if (request.method() === "HEAD") {
      rows = rows.filter(
        (m) =>
          m.author_id !== alice &&
          (!url.searchParams.has("created_at") ||
            m.created_at > url.searchParams.get("created_at").slice(3)),
      );
      return route.fulfill({
        status: 200,
        headers: {
          "content-range": `0-0/${rows.length}`,
          "access-control-expose-headers": "content-range",
        },
        body: "",
      });
    }
    const before = url.searchParams
      .get("or")
      ?.match(/created_at\.lt\.([^,]+)/)?.[1];
    if (before) rows = rows.filter((m) => m.created_at < before);
    rows.sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
    );
    return json(rows.slice(0, Number(url.searchParams.get("limit") || 50)));
  }
  throw new Error(
    `Unexpected fixture request: ${request.method()} ${url.pathname}`,
  );
});
const encode = (data) =>
  Buffer.from(JSON.stringify(data)).toString("base64url");
const jwt = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: alice, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.fixture`;
await page.addInitScript(
  ({ alice, jwt }) =>
    localStorage.setItem(
      "sb-chat-fixture-auth-token",
      JSON.stringify({
        access_token: jwt,
        refresh_token: "fixture-refresh",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user: {
          id: alice,
          email: "alice@test.com",
          aud: "authenticated",
          role: "authenticated",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-10-30T09:00:00Z",
        },
      }),
    ),
  { alice, jwt },
);
try {
  await page.goto(origin);
  await page.getByLabel("Open team chat", { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelector(".chat-unread")?.textContent === "55",
  );
  await page.getByLabel("Open team chat", { exact: true }).click();
  await page.getByText("Live · workspace members", { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".chat-unread"));
  assert.equal(await page.locator(".chat-message").count(), 50);
  await page
    .getByRole("button", { name: "Load older messages", exact: true })
    .click();
  await page.getByText("Earlier thought 1", { exact: true }).waitFor();
  assert.equal(await page.locator(".chat-message").count(), 55);
  await page.getByLabel("Close team chat", { exact: true }).click();
  const incoming = {
    ...messages[0],
    id: randomUUID(),
    body: "A live message from Bob",
    created_at: new Date().toISOString(),
  };
  messages.push(incoming);
  emit("chat_messages", "INSERT", incoming);
  await page.getByLabel("1 unread messages").waitFor({ timeout: 7000 });
  await page.getByLabel("Open team chat", { exact: true }).click();
  await page.getByText("A live message from Bob", { exact: true }).waitFor();
  await page.getByRole("button", { name: /Jump to latest/ }).click();
  await page.waitForFunction(() => !document.querySelector(".chat-unread"));
  const last = page.locator(".chat-message").last();
  await last.getByRole("button", { name: "Reply", exact: true }).click();
  await page.getByLabel("Share a library tool").selectOption(entry.id);
  await page.getByLabel("Message your team").fill("Try this shared tool");
  failNext = true;
  await page
    .locator(".chat-composer")
    .getByRole("button", { name: /Send/ })
    .click();
  await page.locator(".chat-error").waitFor();
  assert.equal(
    await page.getByLabel("Message your team").inputValue(),
    "Try this shared tool",
  );
  await page
    .locator(".chat-composer")
    .getByRole("button", { name: /Send/ })
    .click();
  await page.getByText("Try this shared tool", { exact: true }).waitFor();
  const sent = page.locator(".chat-message").last();
  assert.match(
    await sent.locator("blockquote").innerText(),
    /live message from Bob/,
  );
  await sent
    .getByLabel("React 🚀 to message from You", { exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(
          '.chat-message:last-child [aria-label="React 🚀 to message from You"]',
        )
        ?.getAttribute("aria-pressed") === "true",
  );
  assert.equal(posts, 2);
  console.log(
    "PASS authenticated chat: history pagination, Realtime inserts/reactions, unread counts, read cursors, reply/share payload and draft preservation after a send failure",
  );
  await sent.getByRole("button", { name: /Research tool/ }).click();
  const details = page.getByRole("dialog", {
    name: "Research tool",
    exact: true,
  });
  await details.getByLabel("Entry status").selectOption("Trash");
  await details
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  const confirm = page.getByRole("dialog", {
    name: "Delete permanently?",
    exact: true,
  });
  await confirm
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await confirm.getByRole("alert").waitFor();
  assert.equal(entryDeleted, false);
  assert.equal(await confirm.isVisible(), true);
  await confirm
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await page.waitForFunction(() => !document.querySelector(".modal-backdrop"));
  await page
    .getByText("Library entry permanently deleted", { exact: true })
    .waitFor();
  assert.equal(entryDeleted, true);
  assert.equal(await page.locator(".entry-card").count(), 0);
  console.log(
    "PASS authenticated deletion sends Trash/workspace/id filters, preserves confirmation on permission failure, and refreshes chat tombstones through Realtime UPDATE",
  );
  await page.getByLabel("Switch workspace").selectOption(otherWid);
  await page.waitForFunction(
    () => document.querySelectorAll(".chat-message").length === 0,
  );
  assert.equal(await page.getByLabel("Message your team").inputValue(), "");
  assert.ok(
    [...sockets]
      .filter((s) => s.topic)
      .every((s) => s.topic.includes(otherWid)),
  );
  await page.getByLabel("Switch workspace").selectOption(wid);
  await page.getByText("Try this shared tool", { exact: true }).waitFor();
  authorized = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page
    .getByText("Your workspace membership is no longer available.", {
      exact: false,
    })
    .waitFor();
  assert.equal(await page.locator(".chat-message").count(), 0);
  assert.equal(await page.getByLabel("Message your team").isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log(
    "PASS workspace switch discards old channel/draft/history; membership revocation clears cached chat and disables sending",
  );
} catch (error) {
  console.error((await page.locator("body").innerText()).slice(-2500));
  console.error(
    (await page.locator("#team-chat").textContent())?.slice(0, 1500),
  );
  console.error(
    "Active fixture channels:",
    [...sockets].map((s) => ({ topic: s.topic, bindings: s.bindings })),
  );
  throw error;
} finally {
  await browser.close();
}
