-- MTN FibreX dashboard — Supabase (Postgres) mirror schema.
-- Run this once in the Supabase SQL editor. Multi-home from day one via home_id,
-- so a single project can serve several households. The home collector writes
-- with the SERVICE key (bypasses RLS); browsers read with the ANON key (RLS
-- restricts them to their own home_id).

-- Which auth users may read which home. (For a single household this has one row.)
create table if not exists home_member (
  home_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  role    text not null default 'viewer',          -- 'viewer' | 'admin'
  primary key (home_id, user_id)
);

-- Latest computed live state blob (one row per home). The collector does the
-- heavy lifting; the cloud just serves the last getState() it pushed.
create table if not exists home_state (
  home_id    text primary key,
  ts         bigint,
  state_json jsonb,
  updated_ts bigint
);

-- Authoritative usage ledger, mirrored from SQLite. Idempotent on (home_id,day,scope).
create table if not exists usage_daily (
  home_id    text not null,
  day        text not null,                          -- 'YYYY-MM-DD' (home local tz)
  scope      text not null,                           -- mac | 'DEV.ETH.IFx' | '__unattributed__'
  kind       text,
  down_bytes bigint not null default 0,
  up_bytes   bigint not null default 0,
  updated_ts bigint,
  primary key (home_id, day, scope)
);

-- Devices (names, type, last seen). Idempotent on (home_id, mac).
create table if not exists device (
  home_id     text not null,
  mac         text not null,
  hostname    text,
  custom_name text,
  conn_type   text,
  port        text,
  first_seen  bigint,
  last_seen   bigint,
  primary key (home_id, mac)
);

-- Downsampled throughput points for the history chart. Idempotent on (home_id, ts).
create table if not exists throughput (
  home_id   text not null,
  ts        bigint not null,
  down_kbps integer,
  up_kbps   integer,
  primary key (home_id, ts)
);
create index if not exists idx_throughput_home_ts on throughput (home_id, ts);
create index if not exists idx_usage_home_day on usage_daily (home_id, day);

-- Row-Level Security: a browser (anon/auth) sees only homes it belongs to.
-- The service key used by the collector bypasses RLS automatically.
alter table home_state  enable row level security;
alter table usage_daily enable row level security;
alter table device      enable row level security;
alter table throughput  enable row level security;
alter table home_member enable row level security;

create policy "members read their home_member" on home_member
  for select using (user_id = auth.uid());

-- Helper predicate inlined per table: the row's home_id is one the user belongs to.
create policy "read own home_state" on home_state for select using (
  home_id in (select home_id from home_member where user_id = auth.uid()));
create policy "read own usage_daily" on usage_daily for select using (
  home_id in (select home_id from home_member where user_id = auth.uid()));
create policy "read own device" on device for select using (
  home_id in (select home_id from home_member where user_id = auth.uid()));
create policy "read own throughput" on throughput for select using (
  home_id in (select home_id from home_member where user_id = auth.uid()));

-- After creating your login user in Supabase Auth, grant it access to your home:
--   insert into home_member (home_id, user_id, role)
--   values ('home-1', '<the-auth-user-uuid>', 'admin');
