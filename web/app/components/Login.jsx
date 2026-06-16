"use client";
import { useState } from "react";

export default function Login({ onSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (r.ok) return onSuccess();
      const j = await r.json().catch(() => ({}));
      setErr(r.status === 429 ? "Too many attempts — wait a few minutes." : j.error || "Invalid credentials");
    } catch {
      setErr("Can't reach the dashboard server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <span className="wordmark login-wm">
          <span className="wm-mtn">MTN</span>
          <span className="wm-fibre">FIBRE</span>
          <span className="wm-x">X</span>
        </span>
        <p className="login-sub">Sign in to your network</p>
        <input
          className="login-in"
          placeholder="Username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="login-in"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {err && <div className="login-err">{err}</div>}
        <button className="login-btn" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
