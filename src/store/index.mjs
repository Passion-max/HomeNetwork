// Unified data-access seam. The API (server.mjs) talks to `store.*` and does not
// care whether reads come from local SQLite (default) or the Supabase mirror.
//
// Dynamic import so that cloud mode never loads the local store (and thus never
// loads node:sqlite) — important for a serverless/edge hosted reader.
const useCloud = process.env.STORE === "cloud";
export const store = useCloud
  ? (await import("./cloud.mjs")).cloudStore
  : (await import("./local.mjs")).localStore;
