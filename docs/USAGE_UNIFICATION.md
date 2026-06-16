# Plan: Unified Usage Source of Truth + Supabase (local-redundant)

> Status: **proposed** (awaiting build). Phased; each phase is independently
> shippable. Phase 1 has no cloud and no new dependencies.

## Goals
1. **One** usage number — no "router vs dashboard" split. Both data sources feed
   one ledger.
2. Accurate **Today / Month / All-time** + per-device, derived from the router
   counters **and** the SQLite history together.
3. One **unified uptime** (the router's `PowerOnTime`).
4. **Supabase** as the cloud store, **local SQLite kept active for redundancy**,
   accessed through one **abstracted** layer.

---

## Part A — The unified local ledger

### A1. Why the current numbers are wrong
- `queries.usageSince()` recomputes usage by replaying every raw sample with
  `bdelta()`. On a counter **reset/gap**, `bdelta` adds `Math.max(0, cur)` — the
  *entire* counter value — which dumps phantom GBs into a window.
- No baseline-vs-consumption distinction across the broken→fixed transition, and
  no anchor to the router's true total. Hence the inflated "today" figures
  (e.g. "CodeSummer 10.54 GB").

### A2. New schema (local SQLite)
```sql
-- One authoritative ledger, bucketed by day + scope. THE source of truth.
CREATE TABLE usage_daily (
  day        TEXT,            -- 'YYYY-MM-DD' (local tz)
  scope      TEXT,            -- mac (wifi), 'DEV.ETH.IFx' (port), or '__unattributed__'
  kind       TEXT,            -- 'wifi' | 'port' | 'recon'
  down_bytes INTEGER NOT NULL DEFAULT 0,
  up_bytes   INTEGER NOT NULL DEFAULT 0,
  updated_ts INTEGER,
  PRIMARY KEY (day, scope)
);

-- Tracks each router boot session so all-time survives reboots + calibration.
CREATE TABLE boot_session (
  boot_id        INTEGER PRIMARY KEY,   -- detected boot ordinal
  started_ts     INTEGER,
  last_uptime_s  INTEGER,               -- to detect reboot (uptime drop)
  base_down      INTEGER, base_up       INTEGER,  -- router counter at first sight this session
  last_down      INTEGER, last_up       INTEGER,  -- latest router counter this session
  sealed         INTEGER DEFAULT 0      -- 1 once rolled into all-time
);

-- Outbox for cloud sync (Part B). Local-first; survives offline.
CREATE TABLE sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT, payload TEXT, created_ts INTEGER, synced INTEGER DEFAULT 0
);
```
`device`, `device_sample`, `port_sample`, `snapshot` stay (raw history + live
speed). The **ledger** is new and becomes the read source for consumption.

### A3. Accumulation (every poll, inside `saveSnapshot`, one transaction)
1. Compute per-device (wifi RX/TX) and per-port (in/out) **deltas vs the previous
   stored sample**, reset-aware but **bounded**:
   - Normal: `delta = cur - prev`.
   - `cur < prev` (reset/reboot) → `delta = 0` for that interval (unknowable;
     reconciliation recovers the total). **This kills the inflation.**
   - First-ever reading for a scope → baseline only, `delta = 0`.
   - Gap > N minutes (collector was down) → don't trust per-scope delta; mark the
     interval for reconciliation.
2. Add deltas into `usage_daily` for today's `day` (down = port OutBytes / wifi
   RX; up = port InBytes / wifi TX — keeping the verified direction convention).
3. Update `boot_session.last_*`.

### A4. Reboot handling + calibration (the anchor)
- Detect reboot when `uptime_s` drops or router counter `cur < last`. On reboot:
  **seal** the session (its final counter is now permanent all-time), insert a new
  `boot_session`.
- **Calibration pass** (every poll or every N): compare `Σ usage_daily for current
  session` vs `router since-boot counter`. If the ledger is **short** (collector
  missed traffic), add the difference to today's `__unattributed__` row
  (`kind='recon'`). This makes **all-time = exactly the router's metered total
  across all sessions** — the single source of truth — while per-device detail is
  best-effort on top.

### A5. Reads (`queries.mjs`)
- `getConsumption()` returns **one** object from `usage_daily`:
  - `today` = today's rows; `month` = sum of this month; `all_time` = sum of all
    rows (≡ sealed sessions + current router counter).
  - `by_device` = per-scope totals (mac/port → name).
  - `uptime_s`, `boot_started`, `unattributed_bytes` (shown as "untracked" so the
    math is transparent).
- Delete the `since_boot` vs `windows` duality.

### A6. Migration / backfill
- Create tables; **backfill `usage_daily`** by replaying existing
  `device_sample`/`port_sample` with the **fixed** bounded-delta logic (so history
  is recomputed correctly, inflation removed), bucketed by day. One-time,
  idempotent.
- Seed `boot_session` from the latest snapshot's counters + uptime.

### A7. Frontend
- Replace the two cards with **one** "Total usage": big all-time number, Today /
  This-month / All-time stats, per-device bars, and a small "router uptime · Xd Yh"
  + "untracked: Z GB" footnote. Home hero reads the same unified figures.

---

## Part B — Supabase with local redundancy

### B1. Architecture: local-first, cloud-mirrored
```
ZTE router -> poller -> SQLite (PRIMARY, always) --> sync_queue --> Supabase (MIRROR)
                          |                                            |
                      unified store abstraction <---------------------+
                          |
                   API / dashboard (reads local; cloud for remote/multi-user)
```
- **SQLite stays the primary writer** — the collector never depends on the
  network. If Supabase/internet is down, everything keeps working; the outbox
  drains later. That is the redundancy.
- Supabase is an **eventually-consistent mirror** for durability, remote access,
  and the future multi-user dashboard.

### B2. Supabase schema
- Mirror `usage_daily`, `device`, `snapshot` (downsampled), keyed additionally by
  a **`home_id`** (tenant) so it is multi-home ready from day one.
- Postgres upserts on `(home_id, day, scope)` — **idempotent**, so re-syncing is
  safe.

### B3. Sync module (isolated; keeps core dependency-free)
- New `src/sync/supabase.mjs` — the **only** file allowed a dependency
  (`@supabase/supabase-js`), or just `fetch` against Supabase's REST (PostgREST)
  to stay **zero-dep**. The core poller/db/queries remain Node-built-ins-only.
- Runs on a timer: read unsynced `sync_queue`, push batched upserts, mark synced.
  Backfills historical `usage_daily` on first run.
- Config via `.env`: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (or service key),
  `HOME_ID`. Off automatically if unset (pure-local mode).

### B4. Unified access abstraction
- Introduce a `store` interface (`getConsumption`, `getState`, `getHistory`, ...)
  with a **local** implementation (SQLite, default) and a **cloud** implementation
  (Supabase). The API calls `store.*` — it does not care where data lives. Local
  is the default/fallback; cloud powers a hosted/remote instance later. This is
  the "abstracted and unified" access requirement.

### B5. Security notes
- Supabase keys go in `.env` (never committed). Claude will **not** create the
  Supabase project or enter credentials — it scaffolds the code + schema SQL and
  gives exact steps to paste the project URL/keys.
- Row-Level Security on by tenant `home_id`.

---

## Rollout (phased, each independently shippable)
- **Phase 1 - Local unification** (Part A): schema, accumulator, reset/reboot,
  calibration, backfill, unified `getConsumption`, single UI card. *No cloud, no
  new deps.* Fixes correctness immediately.
- **Phase 2 - Store abstraction** (B4): refactor API reads behind `store`. Pure
  refactor.
- **Phase 3 - Supabase mirror** (B1-B3): outbox + sync module + schema, behind
  `.env`. Local stays primary.
- **Phase 4 - Hosted read / multi-user** (later): hosted dashboard reads Supabase;
  auth.

## Key risks / decisions
- **Direction ambiguity:** keep the proven per-port/per-device direction
  convention; the WiFi *radio* totals stay only for the calibration anchor
  (magnitude), never for per-device.
- **Reconciliation visibility:** unattributed/recon bytes are shown explicitly so
  totals always reconcile and collector-downtime gaps are visible.
- **Backfill:** recomputes history with the fixed logic — current inflated numbers
  will drop to the correct values (expected, not a regression).
