// Runtime configuration for the router connection. Lets the first-run setup
// wizard save credentials without anyone editing files — stored in
// data/config.json (git-ignored). Falls back to environment variables, so the
// existing .env workflow still works unchanged.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const CONFIG_PATH = process.env.CONFIG_PATH ?? "data/config.json";

function load() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}
let cache = load();

/** Current router credentials: saved config first, then env, then defaults. */
export function getRouter() {
  const c = cache.router ?? {};
  return {
    host: c.host || process.env.ROUTER_HOST || "192.168.1.1",
    username: c.username || process.env.ROUTER_USERNAME || "user",
    password: c.password || process.env.ROUTER_PASSWORD || null,
  };
}

/** True once we have a router password from somewhere (config or env). */
export function routerConfigured() {
  return !!getRouter().password;
}

/** Persist router credentials (from the setup wizard) to data/config.json. */
export function saveRouter({ host, username, password }) {
  cache.router = {
    host: (host || "192.168.1.1").trim(),
    username: (username || "user").trim(),
    password,
  };
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cache, null, 2));
  return getRouter();
}
