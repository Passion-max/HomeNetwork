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

The hosted reader serves the same UI but reads the Supabase mirror instead of the
local router. Two supported approaches:

**A. Browser-direct (simplest, recommended).** The Vercel app uses Supabase Auth for
login and the **anon** key in the browser; Row-Level Security (already in the schema)
restricts each user to their own `home_id`. No server secrets in the frontend. This
is a small frontend variant (swap the `/api/*` fetches for `supabase-js` queries) —
wire it at deploy time.

**B. Server-side reader.** Run the Node reader with `STORE=cloud` (uses
`src/store/cloud.mjs`, which imports no SQLite) behind the existing API, and point the
unchanged frontend at it. Good for a VPS/container; on Vercel it means thin API routes
(a non-static build). The `service_role` key stays server-side only.

Either way, set `AUTH_SECURE_COOKIE=1` (approach B) or rely on Supabase Auth
(approach A) since the hosted site is HTTPS.

## Notes / limits (current scaffold)
- Per-device history sparklines aren't mirrored (high-frequency samples stay local);
  `getDeviceHistory` returns empty on the cloud reader.
- `home_id` is single-home via env for the server-side reader; the browser-direct
  path is already multi-home via RLS.
- The mirror is eventually consistent (default every 30s, `SYNC_INTERVAL_MS`).
