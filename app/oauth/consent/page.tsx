"use client";
import { useEffect, useState } from "react";
import type { OAuthAuthorizationDetails } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import Icon from "@/components/icon";
const db = getSupabase();
export default function Consent() {
  const [details, setDetails] = useState<OAuthAuthorizationDetails | null>(
      null,
    ),
    [signedIn, setSignedIn] = useState(false),
    [id, setId] = useState(""),
    [error, setError] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const authorization = new URLSearchParams(window.location.search).get(
      "authorization_id",
    );
    if (!authorization || !/^[a-zA-Z0-9_-]{1,200}$/.test(authorization)) {
      setError(
        "Missing or invalid authorization request. Start the connection from ChatGPT again.",
      );
      return;
    }
    setId(authorization);
    if (!db) {
      setError("Supabase is not configured.");
      return;
    }
    db.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data } = db.auth.onAuthStateChange((_e, s) => setSignedIn(!!s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!db || !signedIn || !id) return;
    let active = true;
    db.auth.oauth.getAuthorizationDetails(id).then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setError(error.message);
        return;
      }
      if (data && "redirect_url" in data) {
        window.location.assign(data.redirect_url);
        return;
      }
      setDetails(data);
    });
    return () => {
      active = false;
    };
  }, [signedIn, id]);
  async function decide(approve: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = approve
        ? await db!.auth.oauth.approveAuthorization(id)
        : await db!.auth.oauth.denyAuthorization(id);
      if (r.error) throw r.error;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authorization failed.");
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="brand-symbol">
          <Icon name="lock" size={25} />
        </div>
        <span className="eyebrow">YOUR WORKSPACE. YOUR PERMISSION.</span>
        <h1>
          Connect your
          <br />
          AI Idea Hub.
        </h1>
        {!signedIn ? (
          <>
            <p>Sign in with your invited account to review this connection.</p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!db || !id) return;
                setBusy(true);
                setError("");
                const r = await db.auth.signInWithPassword({ email, password });
                if (r.error) setError(r.error.message);
                setPassword("");
                setBusy(false);
              }}
            >
              <label>
                Email
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy || !db || !id}>
                Sign in to review
              </button>
            </form>
          </>
        ) : details ? (
          <>
            <p>
              <strong>{details.client.name || "This application"}</strong> is
              asking to connect as {details.user.email}.
            </p>
            <div className="setup-callout">
              <p>
                This connection can read, add, and edit discoveries in every
                workspace you belong to, including moving entries to Trash.
                Personal notes and comments are not exposed by the MCP tools.
              </p>
            </div>
            <p className="small">
              Requested scopes: {details.scope}
              <br />
              Registered callback: {details.redirect_uri}
            </p>
            <div className="modal-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => decide(false)}
              >
                Deny
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => decide(true)}
              >
                {busy ? "Connecting…" : "Allow connection"}
              </button>
            </div>
          </>
        ) : (
          <p>Loading authorization request…</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="small">
          Revoke access later in Supabase Auth. Never paste service-role keys
          into a connector.
        </p>
      </div>
    </main>
  );
}
