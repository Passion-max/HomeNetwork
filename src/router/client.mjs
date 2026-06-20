// Minimal client for the ZTE F670L GPON ONT web UI (firmware V9.0.11P5N17).
// Replicates the browser's login handshake and reads the XML "menuData" pages.
//
// Login flow (verified from the router's own login JS):
//   1. GET  /?_type=loginData&_tag=login_entry   -> JSON { sess_token }   (initial CSRF token)
//   2. GET  /?_type=loginData&_tag=login_token   -> <root>TOKEN</root>     (one-time login token)
//   3. Password = sha256( plainPassword + token )                          (lowercase hex)
//   4. POST /?_type=loginData&_tag=login_entry   { action, Username, Password, _sessionTOKEN }
//   5. Response sets the session cookie; we reuse it for every data request.

import { createHash } from "node:crypto";
import { getRouter } from "../config.mjs";

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// Abort any router request that hangs, so one stuck socket can't freeze a poll
// cycle indefinitely (a dead/unreachable router used to wedge the collector).
const FETCH_TIMEOUT_MS = Number(process.env.ROUTER_TIMEOUT_MS ?? 8000);
const timeout = () => AbortSignal.timeout(FETCH_TIMEOUT_MS);

export class RouterClient {
  // Pass explicit creds to test a candidate (the setup wizard does this);
  // otherwise credentials are read live from config (data/config.json or env),
  // so saving them via the wizard takes effect without a restart.
  constructor(override = null) {
    this.override = override;
    this.cookie = "";       // session cookie (SID=...) captured at login
    this.sessToken = "";    // CSRF token, rotates with each response
  }

  get creds() {
    return this.override ?? getRouter();
  }
  get host() {
    return this.creds.host;
  }
  get base() {
    return `http://${this.creds.host}`;
  }

  // --- low-level request helpers --------------------------------------------

  #headers(extra = {}) {
    const h = {
      Referer: `${this.base}/`,
      "X-Requested-With": "XMLHttpRequest",
      ...extra,
    };
    if (this.cookie) h.Cookie = this.cookie;
    return h;
  }

  #captureCookie(res) {
    const sc = res.headers.get("set-cookie");
    if (sc) {
      if (process.env.DEBUG) console.error("[set-cookie]", sc);
      // A single header may carry several SID= values (old + freshly issued).
      // The authenticated one is the LAST issued, so keep that.
      const sids = [...sc.matchAll(/(SID=[^;,]+)/gi)];
      if (sids.length) this.cookie = sids[sids.length - 1][1];
    }
  }

  async #get(tag, type = "menuData", extraQuery = "") {
    const url = `${this.base}/?_type=${type}&_tag=${tag}${extraQuery}&_=${Date.now()}`;
    const res = await fetch(url, { headers: this.#headers(), redirect: "manual", signal: timeout() });
    this.#captureCookie(res);
    return res.text();
  }

  // --- login -----------------------------------------------------------------

  async login() {
    const { username, password } = this.creds;
    if (!password) throw new Error("Router not configured yet.");

    // Step 1: initial session token
    const entryRes = await fetch(`${this.base}/?_type=loginData&_tag=login_entry&_=${Date.now()}`, {
      headers: this.#headers(),
      signal: timeout(),
    });
    this.#captureCookie(entryRes);
    const entryJson = await entryRes.json().catch(() => ({}));
    this.sessToken = entryJson.sess_token ?? "";

    // Step 2: one-time login token
    const tokenXml = await this.#get("login_token", "loginData");
    const token = (tokenXml.match(/>([^<]+)</) || [])[1]?.trim();
    if (!token) throw new Error(`Could not read login token (got: ${tokenXml.slice(0, 80)})`);

    // Step 3 + 4: hash and submit
    const body = new URLSearchParams({
      action: "login",
      Username: username,
      Password: sha256(password + token),
      _sessionTOKEN: this.sessToken,
    });
    const loginRes = await fetch(`${this.base}/?_type=loginData&_tag=login_entry`, {
      method: "POST",
      headers: this.#headers({ "Content-Type": "application/x-www-form-urlencoded" }),
      body,
      redirect: "manual",
      signal: timeout(),
    });
    this.#captureCookie(loginRes);
    const result = await loginRes.json().catch(() => ({}));
    if (result.sess_token) this.sessToken = result.sess_token;

    // The router signals success by asking the page to refresh.
    const ok = result.login_need_refresh === 1 || result.login_need_refresh === "1" || !!this.cookie;
    if (!ok) {
      throw new Error(`Login failed: ${JSON.stringify(result)}`);
    }

    // CRITICAL (firmware V9.0.11P5N17+): login_need_refresh means the session is
    // only half-activated. The real browser reloads the root page after login,
    // and that GET / is what finalizes the session server-side. Without it every
    // subsequent `menuView` 404s and `menuData` returns SessionTimeout — i.e. the
    // poller logs in "successfully" but can never read any data. Replicate it.
    await fetch(`${this.base}/`, { headers: this.#headers(), signal: timeout() }).catch(() => {});

    return result;
  }

  // --- data --------------------------------------------------------------------

  get loggedIn() {
    return !!this.cookie;
  }

  /** Log in only if we don't already hold a session. */
  async ensureLogin() {
    if (!this.loggedIn) await this.login();
  }

  /** Navigate to a page view (sets server-side page context). */
  async navigate(menuTag, menu3Location = 0) {
    return this.#get(menuTag, "menuView", `&Menu3Location=${menu3Location}`);
  }

  /** Raw XML for a data tag. Pass menuTag to "navigate" there first (required by most pages). */
  async fetchPage(dataTag, menuTag = null, menu3Location = 0) {
    if (menuTag) await this.navigate(menuTag, menu3Location);
    return this.#get(dataTag);
  }

  /** Navigate + fetch + parse, auto re-logging in once if the session expired. */
  async fetchData(dataTag, menuTag = null, menu3Location = 0) {
    await this.ensureLogin();
    let xml = await this.fetchPage(dataTag, menuTag, menu3Location);
    if (xml.includes("SessionTimeout")) {
      this.cookie = "";
      await this.login();
      xml = await this.fetchPage(dataTag, menuTag, menu3Location);
    }
    return parseXml(xml);
  }
}

// --- XML parsing --------------------------------------------------------------
// The pages return <ajax_response_xml_root> with one or more OBJ_* blocks,
// each holding <Instance> rows of <ParaName>/<ParaValue> pairs.

/** Decode the numeric HTML entities the router uses (e.g. &#32; -> space). */
export function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

/** Parse every object block (any tag containing <Instance>) into { NAME: [ {para:value} ] }. */
export function parseXml(xml) {
  const out = {};
  // Strip the outer wrapper first, otherwise its non-greedy match swallows the
  // whole document. Object names vary (OBJ_*_ID, ID_WAN_COMFIG, ...).
  const body = xml.replace(/<\/?ajax_response_xml_root>/g, "");
  const objRe = /<([A-Za-z][A-Za-z0-9_]*)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = objRe.exec(body))) {
    const [, objName, objBody] = m;
    if (!objBody.includes("<Instance>")) continue;
    const instances = [];
    const instRe = /<Instance>([\s\S]*?)<\/Instance>/g;
    let inst;
    while ((inst = instRe.exec(objBody))) {
      const row = {};
      const paraRe = /<ParaName>([\s\S]*?)<\/ParaName>\s*<ParaValue>([\s\S]*?)<\/ParaValue>/g;
      let p;
      while ((p = paraRe.exec(inst[1]))) row[p[1].trim()] = decodeEntities(p[2].trim());
      instances.push(row);
    }
    out[objName] = instances;
  }
  return out;
}
