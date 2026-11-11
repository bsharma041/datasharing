// TadaBoo visit count. Loaded by every page: <script src="/visit.js" data-hit="<order inbox>/hit" defer>.
// One visit per browser session, flagged new on this device's first visit, with two plain labels:
// where the visitor came from (google, instagram, whatsapp, ... or direct) and which kind of page
// they landed on. No address, name, cookie or exact link is sent or stored.
// text/plain keeps it a simple request (no CORS preflight). The labels must match SRC and LAND in
// orders-worker/worker.js; anything else is counted as "unknown".
(() => {
  try {
    const el = document.currentScript, url = el && el.dataset.hit;
    if (!url || navigator.webdriver || sessionStorage.getItem("tb_visit")) return;
    sessionStorage.setItem("tb_visit", "1");
    let fresh = false;
    try { fresh = !localStorage.getItem("tb_seen"); localStorage.setItem("tb_seen", "1"); } catch {}
    const q = new URLSearchParams(location.search), tag = (q.get("utm_source") || q.get("s") || "").toLowerCase().slice(0, 30);
    let host = ""; try { host = new URL(document.referrer).hostname.toLowerCase(); } catch {}
    const KNOWN = [["instagram", /instagram|^ig$/], ["whatsapp", /whatsapp|^wa$|wa\.me/], ["facebook", /facebook|^fb$|fb\.me|fb\.com/], ["google", /^google$|(^|\.)google\./],
      ["youtube", /youtube|youtu\.be/], ["ai", /chatgpt|openai|perplexity|claude\.ai|gemini|copilot/], ["search", /bing\.|duckduckgo|yahoo\.|ecosia|search\.brave/]];
    const match = (s) => (KNOWN.find(([, re]) => re.test(s)) || [])[0];
    const own = !host || /(^|\.)tadaboo\.com$|\.pages\.dev$|^localhost$/.test(host), ua = navigator.userAgent || "";
    // Links opened inside the Instagram or Facebook app often carry no referrer; the app names itself instead.
    const src = tag ? (tag === "share" ? "share" : match(tag) || "campaign")
      : !own ? (match(host) || "other")
      : /Instagram/.test(ua) ? "instagram" : /FBAN|FBAV/.test(ua) ? "facebook" : "direct";
    const p = location.pathname, land = p === "/" || p === "/index.html" ? "home" : p.startsWith("/p/") ? "product" : p.startsWith("/bag/") ? "bag" : p.startsWith("/guides") ? "guide" : "other";
    fetch(url, { method: "POST", keepalive: true, headers: { "content-type": "text/plain" }, body: JSON.stringify({ new: fresh, src, land }) }).catch(() => {});
  } catch {}
})();
