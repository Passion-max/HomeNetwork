# Hosting the dashboard publicly (Supabase + Vercel)

Goal: log in from anywhere, not just the home LAN — while the home collector keeps
working even if the internet drops.

## Architecture (local-first, cloud-mirrored)

```
ZTE router ─▶ home collector ─▶ SQLite (PRIMARY, always)
                                   │
                                   └─▶ Supabase (eventually-consistent MIRROR)
                                            │
                              hosted dashboard (Vercel) reads the mirror
```

- **SQLite stays primary.** The collector never depends on the network; if Supabase
  or the internet is down it keeps polling and just resumes mirroring later
  (watermark-based, idempotent — see `src/sync/supabase.mjs`).
- The mirror holds: `home_state` (latest live snapshot), `usage_daily` (the ledger),
  `device`, and `throughput` (history points) — all keyed by `home_id`.
- The backend stays **dependency-free**: sync and cloud reads use plain `fetch`
  against Supabase's REST (PostgREST) API.

## 1. Create the Supabase project

1. Create a project at supabase.com. Note the **Project URL** and, under
   Settings → API, the **`service_role`** key (secret) and the **`anon`** key.
2. Open the SQL editor and run [`supabase/schema.sql`](../supabase/schema.sql).
3. Create your login user under Authentication → Users (email + password).
4. Grant that user access to your home (SQL editor):
   ```sql
   insert into home_member (home_id, user_id, role)
   values ('home-1', '<the-auth-user-uuid>', 'admin');
   ```

## 2. Turn on mirroring from the home collector

Add to the home `.env` (never commit it), then restart `npm start`:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_KEY=<service_role key>
HOME_ID=home-1
```

Startup should log `cloud sync: ON (mirroring to Supabase)`. Within a minute you'll
see rows in the Supabase tables. The `service_role` key lives **only** on the home
collector — never ship it to the browser.

## 3. Deploy the hosted dashboard on Vercel

The frontend is one codebase, two modes (see `web/app/lib/data.js`): with the
`NEXT_PUBLIC_SUPABASE_*` env vars set it logs in via **Supabase Auth** and reads the
mirror **directly from the browser** with the **anon** key — Row-Level Security
(already in the schema) restricts each user to their own `home_id`. No server secret
ever reaches the browser. Without those vars it uses the local `/api/*` backend, as
the home install does.

1. Create your login user: Supabase → **Authentication → Users → Add user** (email +
   password). Copy its **User UID**.
2. Grant that user your home (SQL editor):
   ```sql
   insert into home_member (home_id, user_id, role)
   values ('home-1', '<the-User-UID>', 'admin');
   ```
3. Get the **anon / publishable** key: Settings → API (the *public* key, NOT
   service_role).
4. On Vercel: **Import** the GitHub repo → set **Root Directory = `web`** → add
   Environment Variables:
   ```
   NEXT_PUBLIC_SUPABASE_URL = https://<project>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY = <anon/publishable key>
   ```
   Deploy. Visiting the URL shows the login screen; sign in with the user from step 1.

To test cloud mode locally, put those two `NEXT_PUBLIC_*` vars in `web/.env.local`
and run `npm run dev` in `web/`.

> Hosted rename + per-device history are read-only/empty by design (renames would be
> overwritten by the home sync; high-frequency samples aren't mirrored).

## Notes / limits (current scaffold)
- Per-device history sparklines aren't mirrored (high-frequency samples stay local);
  `getDeviceHistory` returns empty on the cloud reader.
- `home_id` is single-home via env for the server-side reader; the browser-direct
  path is already multi-home via RLS.
- The mirror is eventually consistent (default every 30s, `SYNC_INTERVAL_MS`).
