// Navigate a section, auto-discover its data tags, fetch + parse each.
// Usage: node --env-file=.env src/discover.mjs <menuId>   (default: localNetStatus)
import { RouterClient, parseXml } from "./router/client.mjs";

const menuId = process.argv[2] || "localNetStatus";
const c = new RouterClient();
await c.login();
console.log(`Logged in. Navigating to "${menuId}" ...\n`);

// menuView returns the page HTML; each data object declares its endpoint in
// <span class="form-action">/?_type=menuData&_tag=XXX</span>
const viewHtml = await c.navigate(menuId);
const tags = [...viewHtml.matchAll(/form-action">[^<]*?_tag=([a-zA-Z0-9_.]+)/g)].map((m) => m[1]);
const uniqueTags = [...new Set(tags)];
console.log("Data tags found on this page:", uniqueTags.join(", ") || "(none)", "\n");

for (const tag of uniqueTags) {
  const xml = await c.fetchPage(tag); // already navigated; just fetch data
  const parsed = parseXml(xml);
  console.log(`===== ${tag} =====`);
  console.log("Objects:", Object.keys(parsed).join(", ") || "(none)");
  console.dir(parsed, { depth: null });
  console.log("");
}
