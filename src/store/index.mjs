// Unified data-access seam. The API (server.mjs) talks to `store.*` and does not
// care whether reads come from local SQLite (default) or a cloud mirror.
//
// Phase 4 will add a cloud reader (Supabase) selected via env, e.g.:
//   export const store = process.env.STORE === "cloud" ? cloudStore : localStore;
// For now the home collector always reads/writes locally.
import { localStore } from "./local.mjs";

export const store = localStore;
