"use client";
import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entry } from "../lib/validation";
import {
  chatEmojis,
  CHAT_LIMIT,
  demoConversation,
  mergeChatMessages,
  validateChatMessage,
  validateReaction,
  type ChatMessage,
} from "../lib/chat";
import Icon from "./icon";
import {
  CHAT_MESSAGE_SELECT,
  ChatRequestError,
  describeChatError,
  loadChatReplies,
} from "../lib/chat-api";

const PAGE_SIZE = 50;
export default function TeamChat({
  db,
  demo,
  workspaceId,
  userId,
  entries,
  author,
  open,
  onToggle,
  onOpenEntry,
}: {
  db: SupabaseClient | null;
  demo: boolean;
  workspaceId: string;
  userId: string;
  entries: Entry[];
  author: (id: string) => string;
  open: boolean;
  onToggle: () => void;
  onOpenEntry: (id: string) => Promise<void>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    demo
      ? demoConversation(entries.find((e) => e.section === "library") || null)
      : [],
  );
  const [unread, setUnread] = useState(demo ? 3 : 0);
  const [body, setBody] = useState("");
  const [share, setShare] = useState("");
  const [reply, setReply] = useState<ChatMessage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!demo);
  const [sending, setSending] = useState(false);
  const [reacting, setReacting] = useState<string | null>(null);
  const [pages, setPages] = useState(1);
  const [hasOlder, setHasOlder] = useState(false);
  const [authorized, setAuthorized] = useState(demo);
  const [connection, setConnection] = useState(
    demo ? "Demo · only you" : "Connecting…",
  );
  const [atBottom, setAtBottom] = useState(true);
  const [visible, setVisible] = useState(true);
  const [mobile, setMobile] = useState(false);
  const [clientReady, setClientReady] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const readRef = useRef("");
  // Keep one id across uncertain retries so a delivered POST cannot create a duplicate.
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const newest = messages.at(-1);
  const name = (id: string) =>
    id === userId
      ? "You"
      : demo
        ? { "demo-jamie": "Jamie Lee", "demo-sam": "Sam Kim" }[id] ||
          "Alex Morgan"
        : author(id);
  const messageAuthor = (m: { author_id: string; author_name?: string }) =>
    m.author_id === userId ? "You" : m.author_name || name(m.author_id);

  useEffect(() => {
    setClientReady(true);
    const media = window.matchMedia("(max-width: 850px)");
    const update = () => setMobile(media.matches);
    const visibility = () => setVisible(document.visibilityState === "visible");
    update();
    visibility();
    media.addEventListener("change", update);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      media.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    if (!demo) return;
    setMessages((old) =>
      old.map((message) => {
        if (!message.shared_entry_id) return message;
        const entry = entries.find((e) => e.id === message.shared_entry_id);
        return entry
          ? { ...message, shared_entry: entry }
          : {
              ...message,
              shared_entry_id: null,
              shared_entry: null,
              shared_entry_deleted: true,
            };
      }),
    );
    setShare((id) => (entries.some((e) => e.id === id) ? id : ""));
  }, [demo, entries]);

  useEffect(() => {
    if (demo || !db) return;
    let alive = true,
      running = false,
      again = false;
    async function refresh() {
      if (!alive) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      do {
        again = false;
        try {
          const membership = await db!
            .from("workspace_members")
            .select("user_id")
            .eq("workspace_id", workspaceId)
            .eq("user_id", userId)
            .maybeSingle();
          if (membership.error)
            throw new ChatRequestError("membership check", membership.error);
          if (!alive) break;
          if (!membership.data) {
            setAuthorized(false);
            setMessages([]);
            setUnread(0);
            setReply(null);
            setShare("");
            setBody("");
            setError("Your workspace membership is no longer available.");
            break;
          }
          const all: ChatMessage[] = [];
          // Range in small pages keeps history available beyond Supabase's per-request row cap.
          for (let page = 0; page < pages; page++) {
            let query = db!
              .from("chat_messages")
              .select(CHAT_MESSAGE_SELECT)
              .eq("workspace_id", workspaceId)
              .order("created_at", { ascending: false })
              .order("id", { ascending: false })
              .limit(PAGE_SIZE);
            const before = all.at(-1);
            if (before)
              query = query.or(
                `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`,
              );
            const r = await query;
            if (r.error) throw new ChatRequestError("history query", r.error);
            if (!alive) break;
            all.push(...(r.data as unknown as ChatMessage[]));
            if (r.data.length < PAGE_SIZE) break;
          }
          const hydrated = await loadChatReplies(db!, workspaceId, all);
          const cursor = await db!
            .from("chat_reads")
            .select("read_at")
            .eq("workspace_id", workspaceId)
            .eq("user_id", userId)
            .maybeSingle();
          if (cursor.error)
            throw new ChatRequestError("read cursor query", cursor.error);
          let count = db!
            .from("chat_messages")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", workspaceId)
            .neq("author_id", userId);
          if (cursor.data) count = count.gt("created_at", cursor.data.read_at);
          const result = await count;
          if (result.error)
            throw new ChatRequestError("unread count", result.error);
          if (!alive) break;
          // Recheck after fetching so a removal during the requests clears cached messages.
          const check = await db!
            .from("workspace_members")
            .select("user_id")
            .eq("workspace_id", workspaceId)
            .eq("user_id", userId)
            .maybeSingle();
          if (check.error)
            throw new ChatRequestError("membership recheck", check.error);
          if (!alive) break;
          if (!check.data) {
            again = true;
            continue;
          }
          setMessages(mergeChatMessages([], hydrated));
          setUnread(result.count || 0);
          setHasOlder(all.length === pages * PAGE_SIZE);
          setAuthorized(true);
          setError("");
        } catch (error) {
          if (alive) setError(describeChatError(error));
        } finally {
          if (alive) setLoading(false);
        }
      } while (alive && again);
      running = false;
    }
    refreshRef.current = refresh;
    let channel = db.channel(`team-chat:${workspaceId}:${userId}`).on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        filter: `workspace_id=eq.${workspaceId}`,
      },
      () => void refresh(),
    );
    channel = channel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "chat_messages",
        filter: `workspace_id=eq.${workspaceId}`,
      },
      () => void refresh(),
    );
    for (const table of ["chat_reactions", "chat_reads"]) {
      for (const event of ["INSERT", "UPDATE"] as const) {
        channel = channel.on(
          "postgres_changes",
          {
            event,
            schema: "public",
            table,
            filter: `workspace_id=eq.${workspaceId}`,
          },
          () => void refresh(),
        );
      }
    }
    channel.subscribe((status) => {
      if (!alive) return;
      setConnection(
        status === "SUBSCRIBED"
          ? "Live · workspace members"
          : `Realtime ${status} · history refreshes every 15s`,
      );
      if (status === "SUBSCRIBED") void refresh();
    });
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      alive = false;
      refreshRef.current = async () => {};
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      void db.removeChannel(channel);
    };
  }, [db, demo, workspaceId, userId, pages]);

  useEffect(() => {
    if (open && atBottom && listRef.current)
      listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open, atBottom]);

  useEffect(() => {
    if (!open || !visible || !atBottom || !newest || !authorized) return;
    if (demo) {
      setUnread(0);
      return;
    }
    if (!db || readRef.current === newest.id) return;
    let alive = true;
    void db
      .rpc("mark_chat_read", { wid: workspaceId, last_message_id: newest.id })
      .then((r) => {
        if (!alive) return;
        if (r.error)
          setError(
            describeChatError(
              new ChatRequestError("read cursor update", r.error),
            ),
          );
        else {
          readRef.current = newest.id;
          void refreshRef.current();
        }
      });
    return () => {
      alive = false;
    };
  }, [open, visible, atBottom, newest, authorized, db, demo, workspaceId]);

  useEffect(() => {
    if (!open) return;
    composerRef.current?.focus();
    const previous = document.body.style.overflow;
    if (mobile) document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => {
      // Existing entry dialogs keep their own keyboard handling above the chat.
      if (document.querySelector(".modal-backdrop")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onToggle();
        toggleRef.current?.focus();
      }
      if (mobile && e.key === "Tab") {
        const targets = Array.from(
          panelRef.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]",
          ) || [],
        ).filter((e) => e.getClientRects().length);
        const first = targets[0],
          last = targets.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            !panelRef.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (mobile) document.body.style.overflow = previous;
    };
  }, [open, mobile, onToggle]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (sending || !authorized) return;
    setError("");
    try {
      const clean = validateChatMessage({
        body,
        reply_to: reply?.id,
        shared_entry_id: share || null,
      });
      setSending(true);
      if (demo) {
        const entry = entries.find((e) => e.id === share);
        const message: ChatMessage = {
          ...clean,
          id: crypto.randomUUID(),
          workspace_id: workspaceId,
          author_id: userId,
          created_at: new Date().toISOString(),
          reactions: [],
          reply: reply || null,
          shared_entry: entry || null,
        };
        setMessages((old) => mergeChatMessages(old, [message]));
      } else {
        const fingerprint = JSON.stringify(clean);
        if (pending.current?.fingerprint !== fingerprint)
          pending.current = { fingerprint, id: crypto.randomUUID() };
        const r = await db!
          .from("chat_messages")
          .insert({
            ...clean,
            id: pending.current.id,
            workspace_id: workspaceId,
            author_id: userId,
          })
          .select(CHAT_MESSAGE_SELECT)
          .single();
        if (r.error && r.error.code !== "23505")
          throw new ChatRequestError("message insert", r.error);
        if (r.error) {
          const delivered = await db!
            .from("chat_messages")
            .select("id")
            .eq("id", pending.current.id)
            .eq("author_id", userId)
            .single();
          if (delivered.error)
            throw new ChatRequestError("delivery check", delivered.error);
        } else
          setMessages((old) =>
            mergeChatMessages(old, [
              { ...(r.data as unknown as ChatMessage), reply },
            ]),
          );
        pending.current = null;
        void refreshRef.current();
      }
      setBody("");
      setShare("");
      setReply(null);
      setAtBottom(true);
      composerRef.current?.focus();
    } catch (e) {
      setError(
        e instanceof ChatRequestError
          ? `${describeChatError(e)} Your draft is still here; try again.`
          : e instanceof Error
            ? e.message
            : "Couldn’t send your message. Your draft is still here; try again.",
      );
    } finally {
      setSending(false);
    }
  }
  async function react(message: ChatMessage, emoji: string) {
    if (reacting || !authorized) return;
    setReacting(message.id);
    setError("");
    try {
      validateReaction(emoji);
      const active = !message.reactions.some(
        (r) => r.user_id === userId && r.emoji === emoji && r.active,
      );
      const row = {
        message_id: message.id,
        workspace_id: workspaceId,
        user_id: userId,
        emoji,
        active,
      };
      if (!demo) {
        const r = await db!
          .from("chat_reactions")
          .upsert(row, { onConflict: "message_id,user_id,emoji" });
        if (r.error) throw new ChatRequestError("reaction update", r.error);
      }
      setMessages((old) =>
        old.map((m) =>
          m.id === message.id
            ? {
                ...m,
                reactions: [
                  ...m.reactions.filter(
                    (r) => r.user_id !== userId || r.emoji !== emoji,
                  ),
                  row,
                ],
              }
            : m,
        ),
      );
      if (!demo) void refreshRef.current();
    } catch (error) {
      setError(describeChatError(error, "reaction update"));
    } finally {
      setReacting(null);
    }
  }
  const close = () => {
    onToggle();
    toggleRef.current?.focus();
  };
  return (
    <>
      <button
        ref={toggleRef}
        className="chat-toggle"
        aria-label={open ? "Collapse team chat" : "Open team chat"}
        aria-expanded={open}
        aria-controls="team-chat"
        onClick={onToggle}
      >
        <Icon name="comment" size={18} /> Team chat{" "}
        {unread > 0 && (
          <span
            className="chat-unread"
            aria-label={`${unread} unread messages`}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      <aside
        ref={panelRef}
        id="team-chat"
        className="team-chat"
        hidden={!open}
        role={mobile ? "dialog" : "region"}
        aria-modal={mobile && open ? true : undefined}
        aria-labelledby="team-chat-title"
      >
        <header className="chat-heading">
          <div>
            <span className="eyebrow">OUR SHARED SPACE</span>
            <h2 id="team-chat-title">
              Team chat <span>✳</span>
            </h2>
            <small>{connection}</small>
          </div>
          <button
            className="icon-button"
            aria-label="Close team chat"
            onClick={close}
          >
            <Icon name="close" />
          </button>
        </header>
        {demo && (
          <div className="chat-demo">
            Sample conversation · Your messages stay in memory and reset on
            reload.
          </div>
        )}
        {error && (
          <div className="chat-error" role="alert">
            {error}{" "}
            {!demo && (
              <button
                onClick={() => {
                  readRef.current = "";
                  void refreshRef.current();
                }}
              >
                Refresh chat
              </button>
            )}
          </div>
        )}
        <div
          className="chat-history"
          ref={listRef}
          aria-label="Chat messages"
          onScroll={(e) => {
            const el = e.currentTarget;
            setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
          }}
        >
          {hasOlder && (
            <button
              className="chat-older"
              disabled={loading}
              onClick={() => {
                setAtBottom(false);
                setLoading(true);
                setPages((n) => n + 1);
              }}
            >
              Load older messages
            </button>
          )}
          {loading && <p role="status">Loading conversation…</p>}
          {!loading && authorized && messages.length === 0 && (
            <p className="chat-empty">
              A new room for good ideas.
              <br />
              Say hello to your team.
            </p>
          )}
          {messages.map((m) => (
            <article
              key={m.id}
              className={`chat-message ${m.author_id === userId ? "is-mine" : ""}`}
              aria-label={`Message from ${messageAuthor(m)}`}
            >
              <div className="chat-byline">
                <span className="chat-avatar" aria-hidden="true">
                  {messageAuthor(m).slice(0, 1)}
                </span>
                <strong>{messageAuthor(m)}</strong>
                <time
                  dateTime={m.created_at}
                  title={
                    clientReady
                      ? new Date(m.created_at).toLocaleString()
                      : undefined
                  }
                >
                  {clientReady
                    ? new Date(m.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : m.created_at.slice(0, 16).replace("T", " ")}
                </time>
              </div>
              {m.reply_to && (
                <blockquote>
                  <strong>
                    ↳ {m.reply ? messageAuthor(m.reply) : "Earlier message"}
                  </strong>
                  <span>
                    {m.reply?.body.slice(0, 160) || "Shared a library tool"}
                  </span>
                </blockquote>
              )}
              {m.body && <p>{m.body}</p>}
              {(m.shared_entry_id || m.shared_entry_deleted) &&
                (m.shared_entry ? (
                  <button
                    className="chat-tool-card"
                    onClick={async () => {
                      try {
                        await onOpenEntry(m.shared_entry_id!);
                      } catch {
                        setError("That library entry is no longer available.");
                      }
                    }}
                  >
                    <span>{m.shared_entry.category} · AI Library ↗</span>
                    <strong>{m.shared_entry.title}</strong>
                    <small>{m.shared_entry.description.slice(0, 140)}</small>
                  </button>
                ) : (
                  <small>
                    {m.shared_entry_deleted
                      ? "Library entry permanently deleted"
                      : "Library entry unavailable"}
                  </small>
                ))}
              <div className="chat-actions">
                <button
                  onClick={() => {
                    setReply(m);
                    composerRef.current?.focus();
                  }}
                  disabled={!authorized}
                >
                  Reply
                </button>
                <div className="chat-reactions" aria-label="Emoji reactions">
                  {chatEmojis.map((emoji) => {
                    const rows = m.reactions.filter(
                      (r) => r.emoji === emoji && r.active,
                    );
                    const mine = rows.some((r) => r.user_id === userId);
                    return (
                      <button
                        key={emoji}
                        aria-label={`React ${emoji} to message from ${messageAuthor(m)}`}
                        aria-pressed={mine}
                        title={
                          rows.map((r) => name(r.user_id)).join(", ") ||
                          `React ${emoji}`
                        }
                        disabled={!authorized || reacting !== null}
                        onClick={() => void react(m, emoji)}
                      >
                        {emoji}
                        {rows.length > 0 && <span>{rows.length}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </article>
          ))}
        </div>
        {!atBottom && (
          <button className="chat-jump" onClick={() => setAtBottom(true)}>
            Jump to latest {unread ? `· ${unread} unread` : ""} ↓
          </button>
        )}
        <form className="chat-composer" onSubmit={send}>
          {reply && (
            <div className="chat-reply-draft">
              <span>
                Replying to {messageAuthor(reply)}
                <small>
                  {reply.body.slice(0, 90) || "Shared a library tool"}
                </small>
              </span>
              <button
                type="button"
                aria-label="Cancel reply"
                onClick={() => setReply(null)}
              >
                ×
              </button>
            </div>
          )}
          <label className="sr-only" htmlFor="chat-share">
            Share a library tool
          </label>
          <select
            id="chat-share"
            value={share}
            onChange={(e) => setShare(e.target.value)}
            disabled={!authorized || sending}
          >
            <option value="">＋ Share a library tool</option>
            {entries
              .filter((e) => e.section === "library" && e.status !== "Trash")
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
          </select>
          <label className="sr-only" htmlFor="chat-body">
            Message your team
          </label>
          <textarea
            id="chat-body"
            ref={composerRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={CHAT_LIMIT}
            rows={3}
            placeholder={
              authorized
                ? "A thought, a question, a little spark…"
                : "Select an accessible workspace to chat"
            }
            disabled={!authorized || sending}
          />
          <div className="chat-send-row">
            <small>
              {[...body].length}/{CHAT_LIMIT} ·{" "}
              {demo ? "Only this demo session" : "Visible to workspace members"}
            </small>
            <button
              className="primary"
              disabled={!authorized || sending || (!body.trim() && !share)}
            >
              {sending ? "Sending…" : "Send"} <span aria-hidden="true">↑</span>
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
