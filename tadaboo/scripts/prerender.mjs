#!/usr/bin/env node
// Write the shop's names, prices and photos into index.html as plain HTML, so crawlers that do not
// run JavaScript (search and AI bots, link previews) can read them. Shoppers see no change: the page
// script replaces the gift bag and shop grid regions the moment it loads.
//
//   node tadaboo/scripts/prerender.mjs            rewrite the PRERENDER regions of website/index.html
//   node tadaboo/scripts/prerender.mjs --check    exit 1 if the committed HTML is stale (changes nothing)
//
// Run it after sync_stock.py (stock.json), after editing catalog.js, and after changing the card
// markup in index.html. Regions look like  <!-- PRERENDER:bags --> ... <!-- /PRERENDER:bags -->.
//   bags     the 12 gift bag cards (same markup the page script builds on first load)
//   grid     the first page of the shop grid (12 of 50), same markup
//   catalog  all 50 products as a plain list inside <noscript> (never shown to shoppers with JavaScript)
//   jsonld   schema.org ItemList of the gift bags (price, INR, availability from stock.json)
// Prices come from stock.json when present, else catalog.js: the same rule as applyStock() in index.html
// (set-priced products, fixedPrice, keep the catalogue price). Sale and offer data is never written here.
// No dependencies; Node 18+.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "website");
const SITE_URL = "https://www.tadaboo.com/";
const PER = 12; // products per shop page; keep equal to PER in index.html

const read = (f) => fs.readFileSync(path.join(site, f), "utf8");
const ctx = { window: {} };
vm.runInNewContext(read("catalog.js"), ctx);
const T = ctx.window.TADABOO;
let STOCK = null;
try {
  const s = JSON.parse(read("stock.json"));
  if (s && typeof s === "object" && s.items && s.bags) STOCK = s;
} catch {}

// ---- Prices: stock.json first, else catalog.js (applyStock in index.html) ----
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const pr = (STOCK && STOCK.prices) || {}, bp = (STOCK && STOCK.bagPrices) || {};
for (const p of T.products) { const v = pr[p.sid]; if (!p.fixedPrice && (p.units || 1) === 1 && isNum(v) && v > 0) p.price = v; }
for (const b of T.bags) { const v = bp["cat-" + b.id]; if (isNum(v) && v > 0) b.price = v; }
const P = Object.fromEntries(T.products.map((p) => [p.id, p]));

// ---- Same helpers as the page script ----
const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const img = (id) => `img/${id}.webp`;
const thumb = (id) => `img/sm/${id}.webp`;
const pic = (src, alt = "") => `<img src="${src}" alt="${esc(alt)}" loading="lazy" decoding="async" width="416" height="520" class="fade">`;
const cover = (b) => img(b.cover || b.items[0]);
const heart = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-9.3-9.2C1.5 7.6 3.6 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.4 0 5.5 3.1 4.3 6.3C19.5 15.4 12 20 12 20z"/></svg>`;
const plusIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;
const favBtn = (k, name) => `<button class="fav " data-fav="${k}" aria-pressed="false" aria-label="Save ${esc(name)} to favourites">${heart}</button>`;
const priceTag = (x) => `<span class="price">${inr(x.price)}</span>`;

function bagCard(b) {
  const chips = b.items.filter((id) => id !== (b.cover || b.items[0])).map((id) => pic(thumb(id))).join("");
  const act = `<button class="plus" data-bagplus="${b.id}" aria-label="Add ${esc(b.name)} to bag">${plusIcon}</button>`;
  return `<div class="bagcard" style="--pc:var(--${["sky", "mint", "butter", "blush"].includes(b.tint) ? b.tint : "sky"})">${favBtn("b:" + b.id, b.name)}<button class="bagopen" data-openbag="${b.id}" aria-haspopup="dialog">
      <span class="ph"><span class="cv">${pic(cover(b), b.name)}</span><span class="chips" aria-hidden="true">${chips}</span></span>
      <span class="row"><span class="nm">${esc(b.name)}</span>${priceTag(b)}</span>
    </button>
      <div class="bfoot"><span class="ct">${b.items.length} items</span><div class="act">${act}</div></div>
    </div>`;
}
function productCard(p, i) {
  return `<article class="card" style="--i:${i}">
      <div class="ph"><button class="phbtn" data-prod="${p.id}" aria-haspopup="dialog" aria-label="View ${esc(p.name)}">${pic(img(p.id), p.name)}</button>
        ${favBtn("p:" + p.id, p.name)}<div class="act"><button class="plus" data-add="${p.id}" aria-label="Add ${esc(p.name)} to bag">${plusIcon}</button></div></div>
      <span class="nm">${esc(p.name)}</span>${priceTag(p)}
    </article>`;
}
function gridFirstPage() {
  const list = T.products, pages = Math.max(1, Math.ceil(list.length / PER)), shown = list.slice(0, PER);
  const nums = Array.from({ length: pages }, (_, n) => `<button class="pill pg" data-page="${n}" aria-label="Page ${n + 1}"${n === 0 ? ' aria-current="page"' : ""}>${n + 1}</button>`).join("");
  const pager = pages > 1 ? `<nav class="pager" aria-label="Shop pages"><button class="pill pg" data-page="-1" aria-label="Previous page" disabled>‹</button>${nums}<button class="pill pg" data-page="1" aria-label="Next page">›</button><span class="of">1–${shown.length} of ${list.length}</span></nav>` : "";
  return shown.map(productCard).join("") + pager;
}

// All products as a plain list. Inside <noscript>, so a shopper with JavaScript never sees it;
// bots that read the raw HTML, and shoppers without JavaScript, get every name, price and photo.
function catalogList() {
  const groups = T.categories.map((c) => `<h3>${esc(c.name)}</h3>
<ul>
${T.products.filter((p) => p.cat === c.id).map((p) => `<li><img src="${img(p.id)}" alt="${esc(p.name)}" loading="lazy" width="104" height="130"> <b>${esc(p.name)}</b> ${inr(p.price)}. ${esc(p.desc)}</li>`).join("\n")}
</ul>`).join("\n");
  return `<noscript><section id="all-products" aria-labelledby="allProductsTitle" style="padding:32px 0"><div class="wrap">
<h2 id="allProductsTitle">All products</h2>
${groups}
</div></section></noscript>`;
}

// ---- JSON-LD: the gift bags as an ItemList of Products with an Offer ----
// Availability mirrors avail() in index.html for an empty bag: the bag's own stock count and the stock of
// every item it holds. Without stock.json (or without a number for the bag) no availability is stated.
function capacity(b) {
  if (!STOCK) return null;
  let a = Infinity;
  if (isNum(STOCK.bags["cat-" + b.id])) a = STOCK.bags["cat-" + b.id];
  const per = {};
  for (const id of b.items) per[P[id].sid] = (per[P[id].sid] || 0) + (P[id].units || 1);
  for (const [sid, n] of Object.entries(per)) if (isNum(STOCK.items[sid])) a = Math.min(a, Math.floor(Math.max(0, STOCK.items[sid]) / n));
  return Number.isFinite(a) ? a : null;
}
function jsonld() {
  const data = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "TadaBoo gift bags",
    itemListElement: T.bags.map((b, i) => {
      const cap = capacity(b);
      const offer = { "@type": "Offer", url: SITE_URL + "#bags", price: b.price, priceCurrency: "INR" };
      if (cap !== null) offer.availability = "https://schema.org/" + (cap > 0 ? "InStock" : "OutOfStock");
      return {
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Product",
          name: b.name,
          image: SITE_URL + cover(b),
          description: "Gift bag with " + b.items.map((id) => P[id].name).join(", ") + ".",
          brand: { "@type": "Brand", name: "TadaBoo" },
          offers: offer,
        },
      };
    }),
  };
  const json = JSON.stringify(data, null, 1).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

const regions = { bags: () => T.bags.map(bagCard).join(""), grid: gridFirstPage, catalog: catalogList, jsonld };

let html = read("index.html");
const before = html;
for (const [name, make] of Object.entries(regions)) {
  const re = new RegExp(`(<!-- PRERENDER:${name} -->)[\\s\\S]*?(<!-- /PRERENDER:${name} -->)`);
  if (!re.test(html)) { console.error(`index.html has no <!-- PRERENDER:${name} --> region`); process.exit(2); }
  html = html.replace(re, (_, a, z) => `${a}${make()}${z}`);
}
if (process.argv.includes("--check")) {
  if (html !== before) { console.error("index.html is STALE: run  node tadaboo/scripts/prerender.mjs  and commit the result."); process.exit(1); }
  console.log(`Prerender OK (${T.bags.length} gift bags, ${T.products.length} products, prices from ${STOCK ? "stock.json" : "catalog.js"}).`);
} else {
  if (html !== before) fs.writeFileSync(path.join(site, "index.html"), html);
  console.log(`${html !== before ? "Updated" : "Already up to date:"} index.html (${T.bags.length} gift bags, ${T.products.length} products, prices from ${STOCK ? "stock.json" : "catalog.js"}).`);
}
