"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import {
  categories,
  statuses,
  validateEntry,
  filterEntries,
  findDuplicate,
  type Entry,
  type EntryInput,
  type Status,
} from "@/lib/validation";
import { demoEntries, marks } from "@/lib/demo";
import Icon from "./icon";
const db = getSupabase();
type Workspace = { id: string; name: string; owner_id: string };
type Member = { user_id: string; email: string };
type Comment = {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
};
type Invite = { id: string; email: string; expires_at: string };
const blank: EntryInput = {
  title: "",
  description: "",
  source_url: "",
  category: "Tool",
  tags: [],
  notes: "",
  status: "To Try",
  section: "library",
};
const statusClass = (s: string) => s.toLowerCase().replace(" ", "-");
function friendly(error: unknown): string {
  const e = error as { message?: string; code?: string };
  return e.code === "23505"
    ? "This title or URL is already in your workspace."
    : e.message || "Something went wrong. Please try again.";
}
export default function Hub() {
  const [demo, setDemo] = useState(!db),
    [user, setUser] = useState<User | null>(null),
    [authReady, setAuthReady] = useState(!db);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [wid, setWid] = useState(""),
    [entries, setEntries] = useState<Entry[]>(!db ? demoEntries : []),
    [members, setMembers] = useState<Member[]>([]);
  const [section, setSection] = useState<"library" | "ideas">("library"),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState("All"),
    [status, setStatus] = useState("All"),
    [view, setView] = useState<"grid" | "list">("grid");
  const [editor, setEditor] = useState<Entry | null | undefined>(undefined),
    [selected, setSelected] = useState<Entry | null>(null),
    [team, setTeam] = useState(false),
    [mobile, setMobile] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [authEmail, setAuthEmail] = useState(""),
    [password, setPassword] = useState(""),
    [authBusy, setAuthBusy] = useState(false),
    [workspaceName, setWorkspaceName] = useState("Our AI workspace");
  const generation = useRef(0);
  const notify = (s: string) => {
    setNotice(s);
  };
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!db) return;
    let alive = true;
    db.auth.getSession().then(({ data }) => {
      if (alive) {
        setUser(data.session?.user ?? null);
        setAuthReady(true);
      }
    });
    const { data } = db.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  const loadWorkspaces = useCallback(async () => {
    if (!db || !user || demo) return;
    const accepted = await db.rpc("accept_invites");
    if (accepted.error) throw accepted.error;
    const result = await db.from("workspaces").select("*").order("created_at");
    if (result.error) throw result.error;
    setWorkspaces(result.data);
    setWid((old) =>
      result.data.some((w) => w.id === old) ? old : result.data[0]?.id || "",
    );
  }, [user, demo]);
  useEffect(() => {
    setEntries(demo ? demoEntries : []);
    setMembers([]);
    setWid("");
    setWorkspaces([]);
    setSelected(null);
    setEditor(undefined);
    setTeam(false);
    generation.current++;
    loadWorkspaces().catch((e) => setError(friendly(e)));
  }, [loadWorkspaces, demo]);
  const reload = useCallback(async () => {
    if (!db || !wid || demo) return;
    const g = ++generation.current;
    setLoading(true);
    try {
      const [items, people] = await Promise.all([
        db
          .from("entries")
          .select("*")
          .eq("workspace_id", wid)
          .order("created_at", { ascending: false }),
        db
          .from("workspace_members")
          .select("user_id,email")
          .eq("workspace_id", wid),
      ]);
      if (g !== generation.current) return;
      if (items.error) throw items.error;
      if (people.error) throw people.error;
      setEntries(items.data);
      setMembers(people.data);
    } catch (e) {
      if (g === generation.current) setError(friendly(e));
    } finally {
      if (g === generation.current) setLoading(false);
    }
  }, [wid, demo]);
  useEffect(() => {
    setEntries(demo ? demoEntries : []);
    setSelected(null);
    setEditor(undefined);
    setTeam(false);
    reload();
    return () => {
      generation.current++;
    };
  }, [reload, demo]);
  const workspace = workspaces.find((w) => w.id === wid);
  const author = (id: string) =>
    demo
      ? "Alex Morgan"
      : members.find((m) => m.user_id === id)?.email || "Former member";
  const subset = entries.filter((e) => e.section === section);
  const visible = filterEntries(subset, search, category, status);
  async function save(input: EntryInput) {
    const clean = validateEntry(input);
    const duplicate = findDuplicate(entries, clean, editor?.id);
    if (duplicate)
      throw new Error(
        `Already saved: “${duplicate.title}”. Open the existing entry instead.`,
      );
    if (demo) {
      setEntries((old) =>
        editor
          ? old.map((e) => (e.id === editor.id ? { ...e, ...clean } : e))
          : [
              {
                ...clean,
                id: crypto.randomUUID(),
                workspace_id: "demo",
                author_id: "demo",
                created_at: new Date().toISOString(),
              },
              ...old,
            ],
      );
    } else {
      if (!db || !user || !wid)
        throw new Error("Sign in and select a workspace.");
      const result = editor
        ? await db
            .from("entries")
            .update(clean)
            .eq("id", editor.id)
            .eq("workspace_id", wid)
            .select()
            .single()
        : await db
            .from("entries")
            .insert({ ...clean, workspace_id: wid, author_id: user.id })
            .select()
            .single();
      if (result.error) throw result.error;
      await reload();
    }
    setEditor(undefined);
    setSelected(null);
    notify(
      demo ? "Saved in this demo session." : "Entry saved to your workspace.",
    );
  }
  async function changeStatus(entry: Entry, next: Status) {
    try {
      if (demo)
        setEntries((old) =>
          old.map((e) => (e.id === entry.id ? { ...e, status: next } : e)),
        );
      else {
        const r = await db!
          .from("entries")
          .update({ status: next })
          .eq("id", entry.id)
          .select()
          .single();
        if (r.error) throw r.error;
        await reload();
      }
      setSelected((s) => (s?.id === entry.id ? { ...s, status: next } : s));
    } catch (e) {
      setError(friendly(e));
    }
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setAuthBusy(true);
    setError("");
    try {
      const r = await db!.auth.signInWithPassword({
        email: authEmail,
        password,
      });
      if (r.error) throw r.error;
      setDemo(false);
      setPassword("");
    } catch (e) {
      setError(friendly(e));
    } finally {
      setAuthBusy(false);
    }
  }
  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault();
    try {
      const name = workspaceName.trim();
      if (!name || name.length > 80)
        throw new Error("Use a workspace name of 1–80 characters.");
      const r = await db!.rpc("create_workspace", { workspace_name: name });
      if (r.error) throw r.error;
      await loadWorkspaces();
    } catch (e) {
      setError(friendly(e));
    }
  }
  if (!authReady)
    return (
      <div className="loading-screen">
        <Icon name="spark" size={32} />
        Opening your workspace…
      </div>
    );
  if (db && !demo && !user)
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div className="brand-symbol">
            <Icon name="spark" size={27} />
          </div>
          <span className="eyebrow">A SMALL SPACE FOR BIG POSSIBILITIES</span>
          <h1>
            Good ideas deserve
            <br />a place to grow.
          </h1>
          <p>
            Your team’s private collection of AI tools, experiments, and what
            comes next.
          </p>
          <form onSubmit={login}>
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary" disabled={authBusy}>
              {authBusy ? "Signing in…" : "Sign in to your workspace"}
              <Icon name="arrow" />
            </button>
          </form>
          <button
            className="text-button"
            disabled={authBusy}
            onClick={async () => {
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail)) {
                setError("Enter your email above first.");
                return;
              }
              setAuthBusy(true);
              const r = await db!.auth.signInWithOtp({
                email: authEmail,
                options: {
                  shouldCreateUser: false,
                  emailRedirectTo: window.location.origin,
                },
              });
              setAuthBusy(false);
              setError(
                r.error
                  ? r.error.message
                  : "If your account exists, a sign-in link has been sent.",
              );
            }}
          >
            Email me a sign-in link
          </button>
          <p className="small">
            Invite only. Ask your workspace owner for access.
          </p>
          <button
            className="text-button"
            onClick={() => {
              setDemo(true);
              setError("");
            }}
          >
            Explore the interactive demo →
          </button>
        </div>
      </main>
    );
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <a className="brand" href="/" aria-label="AI Idea Hub home">
          <span className="brand-symbol">
            <Icon name="spark" size={23} />
          </span>
          <span>
            idea<span className="brand-light">hub</span>
            <span className="brand-dot">.</span>
          </span>
        </a>
        <button className="workspace-switch" onClick={() => setTeam(true)}>
          <span className="workspace-avatar">
            {(workspace?.name || "Our workspace").slice(0, 1)}
          </span>
          <span>
            <strong>{workspace?.name || "Our workspace"}</strong>
            <small>
              Private workspace <Icon name="lock" size={10} />
            </small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
        {workspaces.length > 1 && (
          <select
            aria-label="Switch workspace"
            value={wid}
            onChange={(e) => setWid(e.target.value)}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        <div className="nav-label">WORKSPACE</div>
        <nav>
          <button
            className={section === "library" ? "nav-item active" : "nav-item"}
            onClick={() => {
              setSection("library");
              setStatus("All");
              setCategory("All");
              setMobile(false);
            }}
          >
            <Icon name="grid" />
            <span>AI Library</span>
            <span className="nav-count">
              {entries.filter((e) => e.section === "library").length}
            </span>
          </button>
          <button
            className={section === "ideas" ? "nav-item active" : "nav-item"}
            onClick={() => {
              setSection("ideas");
              setStatus("All");
              setCategory("All");
              setMobile(false);
            }}
          >
            <Icon name="bulb" />
            <span>Ideas & Projects</span>
          </button>
        </nav>
        <div className="nav-label collections-label">COLLECTIONS</div>
        <nav>
          {[
            ["All", "grid", "Everything"],
            ["Using", "check", "In our toolkit"],
            ["Testing", "spark", "On the workbench"],
            ["To Try", "clock", "Up next"],
            ["Trash", "trash", "Trash"],
          ].map(([s, i, label]) => (
            <button
              key={s}
              className={`nav-item collection ${status === s ? "chosen" : ""}`}
              onClick={() => {
                setStatus(s);
                setMobile(false);
              }}
            >
              <Icon name={i} size={17} />
              <span>{label}</span>
              <small>
                {s === "All"
                  ? subset.length
                  : subset.filter((e) => e.status === s).length}
              </small>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="capture-tip">
            <span className="tip-icon">
              <Icon name="code" size={18} />
            </span>
            <strong>Ideas don’t wait.</strong>
            <p>
              Save discoveries directly from ChatGPT with our MCP connection.
            </p>
            <button onClick={() => setTeam(true)}>
              Connect your tools <span>↗</span>
            </button>
          </div>
          <button className="nav-item" onClick={() => setTeam(true)}>
            <Icon name="settings" />
            <span>Workspace settings</span>
          </button>
          <div className="user-row">
            <span className="avatar">
              {demo ? "AM" : user?.email?.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>
                {demo ? "Alex Morgan" : user?.email?.split("@")[0]}
              </strong>
              <small>{demo ? "Demo workspace" : "Workspace member"}</small>
            </span>
            <button
              aria-label={demo ? "Leave demo" : "Sign out"}
              className="icon-button"
              onClick={async () => {
                if (demo && db) {
                  setDemo(false);
                  return;
                }
                if (demo) {
                  notify("Connect Supabase to sign in with your own account.");
                  return;
                }
                await db!.auth.signOut();
              }}
            >
              <Icon name="logout" size={17} />
            </button>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Icon name="menu" />
            </button>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>
              {section === "library" ? "AI Library" : "Ideas & Projects"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="private-label">
              <Icon name="lock" size={13} />
              Private
            </span>
            <div className="avatar-stack">
              {(demo
                ? ["AM", "JL", "SK"]
                : members.map((m) => m.email.slice(0, 2).toUpperCase())
              )
                .slice(0, 5)
                .map((m, i) => (
                  <span
                    key={i}
                    className={`avatar avatar-${i}`}
                    title={demo ? "Demo member" : members[i]?.email}
                  >
                    {m}
                  </span>
                ))}
            </div>
            <button className="invite-button" onClick={() => setTeam(true)}>
              <Icon name="team" size={16} /> Invite
            </button>
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <span>
              <span className="live-dot" /> Interactive demo · Changes stay in
              this session.
            </span>
            <button onClick={() => (db ? setDemo(false) : setTeam(true))}>
              {db ? "Sign in" : "Connect Supabase"} <span>↗</span>
            </button>
          </div>
        )}
        <main className="content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">YOUR COLLECTIVE ADVANTAGE</span>
              <h1>
                {section === "library"
                  ? "A little curiosity. Endless possibility."
                  : "Where “what if” becomes what’s next."}
              </h1>
              <p>
                {section === "library"
                  ? "The tools, prompts, and workflows worth keeping. All in one place."
                  : "A shared space for your next experiment, side project, or big idea."}
              </p>
            </div>
            <button
              className="primary add-button"
              disabled={!demo && !wid}
              onClick={() => setEditor(null)}
            >
              <Icon name="plus" size={18} />
              {section === "library" ? "Add to library" : "New idea"}
            </button>
          </div>
          {!demo && !wid && !loading ? (
            <section className="empty-state">
              <Icon name="team" size={34} />
              <h2>Make room for your next idea.</h2>
              <p>
                Create a private workspace, or ask an owner to invite your email
                address.
              </p>
              <form onSubmit={createWorkspace} className="inline-form">
                <input
                  aria-label="Workspace name"
                  maxLength={80}
                  required
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                />
                <button className="primary">Create workspace</button>
              </form>
              <button
                className="text-button"
                onClick={() =>
                  loadWorkspaces().catch((e) => setError(friendly(e)))
                }
              >
                Check for invitations
              </button>
            </section>
          ) : (
            <>
              <section className="stats" aria-label="Library overview">
                {[
                  [
                    "grid",
                    "Everything",
                    subset.length,
                    "saved discoveries",
                    "violet",
                  ],
                  [
                    "clock",
                    "To try",
                    subset.filter((e) => e.status === "To Try").length,
                    "a little potential",
                    "amber",
                  ],
                  [
                    "spark",
                    "Testing",
                    subset.filter((e) => e.status === "Testing").length,
                    "experiments in motion",
                    "blue",
                  ],
                  [
                    "check",
                    "Using",
                    subset.filter((e) => e.status === "Using").length,
                    "part of our everyday",
                    "green",
                  ],
                ].map(([icon, label, count, caption, color]) => (
                  <button
                    key={label}
                    className="stat"
                    onClick={() =>
                      setStatus(
                        label === "Everything"
                          ? "All"
                          : label === "To try"
                            ? "To Try"
                            : String(label),
                      )
                    }
                  >
                    <div className="stat-top">
                      <span className={`stat-icon ${color}`}>
                        <Icon name={String(icon)} size={16} />
                      </span>
                      <span>{label}</span>
                      <Icon name="arrow" size={14} />
                    </div>
                    <div className="stat-value">
                      {count}
                      <span>{caption}</span>
                    </div>
                  </button>
                ))}
              </section>
              <div className="library-heading">
                <h2>
                  {section === "library" ? "Your library" : "Your ideas"}
                  <span>{subset.length}</span>
                </h2>
                <span>A shared brain. A better starting point.</span>
              </div>
              <div className="toolbar">
                <div className="search-box">
                  <Icon name="search" size={18} />
                  <input
                    aria-label="Search your library"
                    placeholder="Search tools, tags, or a spark of an idea…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button
                      className="icon-button"
                      aria-label="Clear search"
                      onClick={() => setSearch("")}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </div>
                <select
                  aria-label="Filter by category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="All">All categories</option>
                  {categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter by status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="All">All statuses</option>
                  {statuses.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <div className="view-switch">
                  <button
                    aria-label="Grid view"
                    aria-pressed={view === "grid"}
                    className={view === "grid" ? "selected" : ""}
                    onClick={() => setView("grid")}
                  >
                    <Icon name="grid" size={17} />
                  </button>
                  <button
                    aria-label="List view"
                    aria-pressed={view === "list"}
                    className={view === "list" ? "selected" : ""}
                    onClick={() => setView("list")}
                  >
                    <Icon name="list" size={18} />
                  </button>
                </div>
              </div>
              <div className="filter-chips">
                {["All", ...categories].map((c) => (
                  <button
                    key={c}
                    className={category === c ? "selected" : ""}
                    onClick={() => setCategory(c)}
                  >
                    {c === "All" ? "Everything" : `${c}s`}
                  </button>
                ))}
                <span>
                  {visible.length} {visible.length === 1 ? "entry" : "entries"}
                  <span className="sort-label"> · Newest first</span>
                </span>
              </div>
              {loading ? (
                <div className="empty-state" role="status">
                  Loading your discoveries…
                </div>
              ) : visible.length === 0 ? (
                <section className="empty-state">
                  <Icon name="search" size={32} />
                  <h2>
                    {subset.length
                      ? "Nothing here just yet."
                      : "Your next discovery starts here."}
                  </h2>
                  <p>
                    {subset.length
                      ? "Try a different search or clear your filters."
                      : "Save a tool, prompt, workflow, or idea for your team."}
                  </p>
                  <button
                    className="secondary"
                    onClick={() => {
                      setSearch("");
                      setCategory("All");
                      setStatus("All");
                      if (!subset.length) setEditor(null);
                    }}
                  >
                    {subset.length ? "Clear filters" : "Add your first entry"}
                  </button>
                </section>
              ) : (
                <div
                  className={`entry-grid ${view === "list" ? "list-view" : ""}`}
                >
                  {visible.map((entry) => (
                    <article className="entry-card" key={entry.id}>
                      <div className="card-top">
                        <span
                          className={`entry-mark ${marks[entry.title]?.[1] || "purple"}`}
                        >
                          {marks[entry.title]?.[0] ||
                            entry.title.slice(0, 1).toUpperCase()}
                        </span>
                        <span
                          className={`status-pill ${statusClass(entry.status)}`}
                        >
                          <span />
                          {entry.status}
                        </span>
                      </div>
                      <button
                        className="card-main"
                        onClick={() => setSelected(entry)}
                      >
                        <h3>
                          {entry.title}
                          <Icon name="arrow" size={16} />
                        </h3>
                        <p>
                          {entry.description ||
                            "An idea waiting to take shape. Add a description to share the possibility."}
                        </p>
                      </button>
                      <div className="tags">
                        <span className="category-tag">{entry.category}</span>
                        {entry.tags.slice(0, 2).map((t) => (
                          <button key={t} onClick={() => setSearch(t)}>
                            #{t}
                          </button>
                        ))}
                      </div>
                      <div className="card-footer">
                        <span
                          className="card-author"
                          title={author(entry.author_id)}
                        >
                          <span className="tiny-avatar">
                            {author(entry.author_id).slice(0, 1).toUpperCase()}
                          </span>
                          {author(entry.author_id).split("@")[0].split(" ")[0]}
                        </span>
                        <time dateTime={entry.created_at}>
                          {new Date(entry.created_at).toLocaleDateString("en", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            timeZone: "UTC",
                          })}
                        </time>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              <footer className="content-footer">
                <span>
                  <Icon name="lock" size={12} /> A private corner of the
                  internet. A shared world of ideas.
                </span>
                <span>
                  Stay curious <span className="footer-star">✳</span>
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      {error && (
        <div role="alert" className="toast error">
          {error}
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="toast">
          <Icon name="check" size={17} />
          {notice}
        </div>
      )}
      {editor !== undefined && (
        <Editor
          key={editor?.id || "new"}
          entry={editor}
          section={section}
          onClose={() => setEditor(undefined)}
          onSave={save}
        />
      )}
      {selected && (
        <Detail
          key={selected.id}
          entry={selected}
          demo={demo}
          userId={user?.id || "demo"}
          author={author}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setEditor(selected);
            setSelected(null);
          }}
          onStatus={(s) => changeStatus(selected, s)}
        />
      )}
      {team && (
        <Team
          demo={demo}
          workspace={workspace}
          userId={user?.id}
          members={members}
          onClose={() => setTeam(false)}
          refresh={reload}
          notify={notify}
        />
      )}
    </div>
  );
}
function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    box.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const items = box.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select,textarea,a[href],[tabindex="0"]',
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === box.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === box.current)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""}`}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Editor({
  entry,
  section,
  onClose,
  onSave,
}: {
  entry: Entry | null;
  section: "library" | "ideas";
  onClose: () => void;
  onSave: (v: EntryInput) => Promise<void>;
}) {
  const [v, setV] = useState<EntryInput>(entry || { ...blank, section }),
    [tags, setTags] = useState(entry?.tags.join(", ") || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const field = (key: keyof EntryInput, value: string) =>
    setV((old) => ({ ...old, [key]: value }));
  return (
    <Modal
      title={
        entry
          ? "Edit discovery"
          : section === "ideas"
            ? "A new possibility"
            : "Save a discovery"
      }
      onClose={onClose}
    >
      <p className="modal-description">
        Give your team a useful starting point. You can always refine it later.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSave({
              ...v,
              tags: tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            });
          } catch (e) {
            setError(friendly(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Title <span>*</span>
          <input
            autoFocus
            required
            maxLength={160}
            placeholder="What caught your attention?"
            value={v.title}
            onChange={(e) => field("title", e.target.value)}
          />
        </label>
        <label>
          Description
          <textarea
            maxLength={3000}
            rows={3}
            placeholder="What does it do? Why is it worth a look?"
            value={v.description}
            onChange={(e) => field("description", e.target.value)}
          />
        </label>
        <label>
          Source URL
          <input
            type="url"
            maxLength={2000}
            placeholder="https://…"
            value={v.source_url || ""}
            onChange={(e) => field("source_url", e.target.value)}
          />
        </label>
        <div className="form-row">
          <label>
            Category
            <select
              value={v.category}
              onChange={(e) => field("category", e.target.value)}
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={v.status}
              onChange={(e) => field("status", e.target.value)}
            >
              {statuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Tags <small>Separate with commas · up to 12</small>
          <input
            value={tags}
            maxLength={450}
            placeholder="research, writing, productivity"
            onChange={(e) => setTags(e.target.value)}
          />
        </label>
        <label>
          Shared notes
          <textarea
            maxLength={10000}
            rows={3}
            placeholder="Useful context, a prompt, or something to remember…"
            value={v.notes}
            onChange={(e) => field("notes", e.target.value)}
          />
        </label>
        <label>
          Save to
          <select
            value={v.section}
            onChange={(e) => field("section", e.target.value)}
          >
            <option value="library">AI Library</option>
            <option value="ideas">Ideas & Projects</option>
          </select>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : entry ? "Save changes" : "Save discovery"}
            <Icon name="plus" size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Detail({
  entry,
  demo,
  userId,
  author,
  onClose,
  onEdit,
  onStatus,
}: {
  entry: Entry;
  demo: boolean;
  userId: string;
  author: (id: string) => string;
  onClose: () => void;
  onEdit: () => void;
  onStatus: (s: Status) => void;
}) {
  const [tab, setTab] = useState("Overview"),
    [rating, setRating] = useState(0),
    [notes, setNotes] = useState(""),
    [comments, setComments] = useState<Comment[]>([]),
    [body, setBody] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(demo),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    if (demo) return;
    let active = true;
    (async () => {
      const [f, c] = await Promise.all([
        db!
          .from("entry_feedback")
          .select("*")
          .eq("entry_id", entry.id)
          .eq("user_id", userId)
          .maybeSingle(),
        db!
          .from("comments")
          .select("*")
          .eq("entry_id", entry.id)
          .order("created_at"),
      ]);
      if (!active) return;
      if (f.error || c.error) {
        setError(friendly(f.error || c.error));
        return;
      }
      setRating(f.data?.rating || 0);
      setNotes(f.data?.notes || "");
      setComments(c.data || []);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [entry.id, userId, demo]);
  async function saveFeedback() {
    setBusy(true);
    setSaved(false);
    try {
      if (!demo) {
        const r = await db!
          .from("entry_feedback")
          .upsert(
            {
              entry_id: entry.id,
              user_id: userId,
              rating: rating || null,
              notes,
            },
            { onConflict: "entry_id,user_id" },
          )
          .select()
          .single();
        if (r.error) throw r.error;
      }
      setSaved(true);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }
  async function comment(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (!body.trim()) throw new Error("Write a comment first.");
      if (demo)
        setComments((c) => [
          ...c,
          {
            id: crypto.randomUUID(),
            body: body.trim(),
            author_id: userId,
            created_at: new Date().toISOString(),
          },
        ]);
      else {
        const r = await db!
          .from("comments")
          .insert({ entry_id: entry.id, author_id: userId, body: body.trim() })
          .select()
          .single();
        if (r.error) throw r.error;
        setComments((c) => [...c, r.data]);
      }
      setBody("");
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={entry.title} onClose={onClose} wide>
      <div className="detail-meta">
        <span className="category-tag">{entry.category}</span>
        <select
          aria-label="Entry status"
          value={entry.status}
          onChange={(e) => onStatus(e.target.value as Status)}
        >
          {statuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <button className="secondary" onClick={onEdit}>
          Edit entry
        </button>
      </div>
      <div className="detail-tabs">
        {["Overview", "My notes", "Comments"].map((t) => (
          <button
            key={t}
            className={tab === t ? "selected" : ""}
            onClick={() => setTab(t)}
          >
            {t}
            {t === "Comments" ? ` (${comments.length})` : ""}
          </button>
        ))}
      </div>
      {tab === "Overview" && (
        <div className="detail-content">
          <p className="description">
            {entry.description || "No description yet."}
          </p>
          {entry.source_url && (
            <a
              className="source-link"
              href={entry.source_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Visit source <Icon name="arrow" size={16} />
            </a>
          )}
          <div className="tags">
            {entry.tags.map((t) => (
              <span className="category-tag" key={t}>
                #{t}
              </span>
            ))}
          </div>
          <h3>Shared notes</h3>
          <p className="preserve-text">
            {entry.notes ||
              "A blank canvas. Add context, instructions, or a useful discovery."}
          </p>
          <div className="detail-credit">
            Added by {author(entry.author_id)}
            <br />
            {new Date(entry.created_at).toLocaleString()}
          </div>
        </div>
      )}
      {tab === "My notes" && (
        <div className="detail-content">
          <p className="muted">
            Only you can see your rating and personal notes.
            {demo ? " Demo notes reset when you close this dialog." : ""}
          </p>
          <label>Your rating</label>
          <div className="stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                aria-label={`Rate ${n} out of 5`}
                aria-pressed={rating === n}
                className={n <= rating ? "filled" : ""}
                onClick={() => {
                  setRating(n);
                  setSaved(false);
                }}
              >
                <Icon name="star" size={27} />
              </button>
            ))}
            <button className="text-button" onClick={() => setRating(0)}>
              Clear
            </button>
          </div>
          <label>
            Personal notes
            <textarea
              rows={7}
              maxLength={10000}
              disabled={!ready}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setSaved(false);
              }}
              placeholder="What worked for you? What would you try next?"
            />
          </label>
          <button
            className="primary"
            disabled={busy || !ready}
            onClick={saveFeedback}
          >
            {busy ? "Saving…" : saved ? "Saved ✓" : "Save my notes"}
          </button>
        </div>
      )}
      {tab === "Comments" && (
        <div className="detail-content">
          {!ready ? (
            <p>Loading conversation…</p>
          ) : comments.length ? (
            comments.map((c) => (
              <div className="comment" key={c.id}>
                <strong>{author(c.author_id)}</strong>
                <time>{new Date(c.created_at).toLocaleDateString()}</time>
                <p className="preserve-text">{c.body}</p>
                {c.author_id === userId && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        if (!demo) {
                          const r = await db!
                            .from("comments")
                            .delete()
                            .eq("id", c.id)
                            .select()
                            .single();
                          if (r.error) throw r.error;
                        }
                        setComments((cs) => cs.filter((x) => x.id !== c.id));
                      } catch (e) {
                        setError(friendly(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            ))
          ) : (
            <p className="muted">
              Good conversations start with a little curiosity. Leave the first
              comment.
            </p>
          )}
          <form onSubmit={comment}>
            <label>
              Add a comment
              <textarea
                required
                maxLength={3000}
                rows={3}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Share a thought with your team…"
              />
            </label>
            <button className="primary" disabled={busy || !ready}>
              {busy ? "Posting…" : "Post comment"}
            </button>
          </form>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
function Team({
  demo,
  workspace,
  userId,
  members,
  onClose,
  refresh,
  notify,
}: {
  demo: boolean;
  workspace: Workspace | undefined;
  userId: string | undefined;
  members: Member[];
  onClose: () => void;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [email, setEmail] = useState(""),
    [invites, setInvites] = useState<Invite[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const owner = workspace?.owner_id === userId;
  const load = useCallback(async () => {
    if (demo || !owner || !workspace) return;
    const r = await db!
      .from("workspace_invites")
      .select("*")
      .eq("workspace_id", workspace.id);
    if (r.error) throw r.error;
    setInvites(r.data);
  }, [demo, owner, workspace]);
  useEffect(() => {
    load().catch((e) => setError(friendly(e)));
  }, [load]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      await refresh();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="A small team. A shared advantage." onClose={onClose} wide>
      <p className="modal-description">
        A private workspace for up to 5 curious people.
      </p>
      {demo ? (
        <div className="setup-callout">
          <Icon name="lock" />
          <div>
            <h3>Make this space yours</h3>
            <p>
              This is a local demo. To save real entries and invite your team,
              configure Supabase using the project README. No data is sent from
              the demo.
            </p>
          </div>
        </div>
      ) : (
        <>
          <h3>Workspace members</h3>
          {members.map((m) => (
            <div className="member" key={m.user_id}>
              <span className="avatar">
                {m.email.slice(0, 2).toUpperCase()}
              </span>
              <span>
                {m.email}
                <small>
                  {m.user_id === workspace?.owner_id ? "Owner" : "Member"}
                </small>
              </span>
              {owner && m.user_id !== userId && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const r = await db!.rpc("remove_member", {
                        wid: workspace!.id,
                        member_id: m.user_id,
                      });
                      if (r.error) throw r.error;
                    })
                  }
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {owner ? (
            <>
              <form
                className="invite-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(async () => {
                    const r = await db!.rpc("invite_member", {
                      wid: workspace!.id,
                      invite_email: email,
                    });
                    if (r.error) throw r.error;
                    setEmail("");
                    notify(
                      "Workspace invitation created. Ask your admin to send their Supabase Auth invitation.",
                    );
                  });
                }}
              >
                <label>
                  Invite by email
                  <input
                    required
                    type="email"
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="curious@yourteam.com"
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Create invitation
                </button>
              </form>
              <p className="small">
                Invitations expire in 7 days. This grants workspace access; it
                does not send an email. An administrator must invite new
                accounts through Supabase Auth.
              </p>
              {invites.map((i) => (
                <div className="member" key={i.id}>
                  <span>
                    {i.email}
                    <small>
                      {new Date(i.expires_at) < new Date()
                        ? "Expired"
                        : "Pending"}{" "}
                      · {new Date(i.expires_at).toLocaleDateString()}
                    </small>
                  </span>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        const r = await db!.rpc("revoke_invite", {
                          invite_id: i.id,
                        });
                        if (r.error) throw r.error;
                      })
                    }
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </>
          ) : (
            <p className="small">
              Ask your workspace owner to manage invitations.
            </p>
          )}
        </>
      )}
      {workspace && (
        <p className="small">
          Workspace ID: <code className="workspace-id">{workspace.id}</code>
        </p>
      )}
      <div className="mcp-callout">
        <div className="section-icon">
          <Icon name="code" />
        </div>
        <h3>A shortcut from conversation to collection.</h3>
        <p>
          Connect ChatGPT to <code>/mcp</code> using your individual Supabase
          OAuth account. Every tool call follows the same workspace permissions.
        </p>
        <div className="tool-names">
          add_ai_tool · list_ai_tools
          <br />
          search_ai_tools · update_ai_tool
        </div>
        <p className="small">
          See README.md for OAuth setup, deployment, and connection
          instructions.
        </p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
