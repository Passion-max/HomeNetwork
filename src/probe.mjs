// Demo: clean API + save the logged-in index for page-tag discovery.
import { writeFileSync } from "node:fs";
import { RouterClient } from "./router/client.mjs";

const c = new RouterClient();
console.log(`Logging in to ${c.base} as "${c.username}" ...`);
await c.login();
console.log("Login OK.\n");

// Clean one-liner now that navigate->data is baked in:
const info = await c.fetchData("devmgr_statusmgr_lua.lua", "statusMgr");
console.log("Device info (decoded):");
console.dir(info, { depth: null });

// Save the logged-in index so we can map every page tag offline.
const root = await fetch(`${c.base}/`, { headers: { Cookie: c.cookie, Referer: `${c.base}/` } });
const html = await root.text();
writeFileSync("_probe_index_loggedin.html", html);
console.log(`\nSaved logged-in index: ${html.length} bytes -> _probe_index_loggedin.html`);
