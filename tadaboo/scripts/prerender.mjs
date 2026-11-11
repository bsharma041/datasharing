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
//   bags     the gift bag cards (same markup the page script builds on first load)
//   grid     the first page of the shop grid (12 of 50), same markup
//   catalog  all products as a plain list inside <noscript> (never shown to shoppers with JavaScript)
//   jsonld   schema.org ItemList of the gift bags (price, INR, availability from stock.json)
// It also writes p/<id>.html and bag/<id>.html (one page per product and gift bag), google-feed.xml
// (Google Merchant Center product feed) and sitemap-products.xml; --check checks those too.
// Prices come from stock.json when present, else catalog.js: the same rule as applyStock() in index.html
// (set-priced products, fixedPrice, keep the catalogue price). Sale and offer data is never written here.
// No dependencies; Node 18+.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { buildGuides } from "./guides.mjs";

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
// Sold-out products go to the end of the shop list, as in renderGrid() in index.html.
const prodLeft = (p) => STOCK && isNum(STOCK.items[p.sid]) ? Math.floor(Math.max(0, STOCK.items[p.sid]) / (p.units || 1)) : Infinity;
function gridFirstPage() {
  // New arrivals (`added` in catalog.js) lead, as in renderGrid(); the page script drops them back after 45 days.
  const byNew = [...T.products.filter((p) => p.added), ...T.products.filter((p) => !p.added)];
  const list = [...byNew.filter((p) => prodLeft(p) > 0), ...byNew.filter((p) => prodLeft(p) <= 0)], pages = Math.max(1, Math.ceil(list.length / PER)), shown = list.slice(0, PER);
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

// Sold-out bags last, the same order renderBags() in index.html gives once stock.json has loaded.
const soldOut = (b) => { const c = capacity(b); return c !== null && c <= 0; };
const bagsInOrder = () => [...T.bags.filter((b) => !soldOut(b)), ...T.bags.filter(soldOut)];
const regions = { bags: () => bagsInOrder().map(bagCard).join(""), grid: gridFirstPage, catalog: catalogList, jsonld };

let html = read("index.html");
const before = html;
for (const [name, make] of Object.entries(regions)) {
  const re = new RegExp(`(<!-- PRERENDER:${name} -->)[\\s\\S]*?(<!-- /PRERENDER:${name} -->)`);
  if (!re.test(html)) { console.error(`index.html has no <!-- PRERENDER:${name} --> region`); process.exit(2); }
  html = html.replace(re, (_, a, z) => `${a}${make()}${z}`);
}

// ---- Product pages (/p/<id>, /bag/<id>), Google Merchant feed and product sitemap ----
// One plain page per product and gift bag, so Google Shopping (and search) has a page that shows
// that item's photo, price and stock, with a button that opens it in the shop (/?open=p:<id>).
// Prices follow the page script: stock.json price, then the lower of a Stockroom sale price and an
// occasion offer running today (India date). Built from the date, never the clock, so an unchanged
// stock.json gives byte-identical files and the hourly task has nothing to commit.
const FEED_SKIP = /kuromi|labubu|snoopy|sanrio|hello kitty|disney|marvel|avengers|pokemon|barbie|peppa|doraemon|minion|spider|batman|harry potter/i;
// Character names in a title, description or photo can get a new Merchant Center account suspended
// (unlicensed brand use). Those products keep their pages but stay out of google-feed.xml.
// Products whose photo shows a cartoon character or another brand's packaging, though the name does not
// (checked by eye on 2026-11-04). Add an id here when a new photo shows one.
const FEED_PHOTO_SKIP = new Set(["korean-gel-pen", "light-up-pen", "icecream-pen", "toffee-eraser", "sharpener-eraser",
  "activity-set", "magnetic-bookmark", "chocolate-squishy"]);
const feedSkipItem = (p) => FEED_PHOTO_SKIP.has(p.id) || FEED_SKIP.test(p.name + " " + p.desc);
const istDay = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const SALE = (STOCK && STOCK.sale) || {};
const OFFERS = ((STOCK && Array.isArray(STOCK.offers)) ? STOCK.offers : []).filter((o) => o && o.pct > 0 && o.pct < 90 && String(o.from) <= istDay && istDay <= String(o.to));
function deal(x, saleV, isBag) {
  let price = x.price, why = "", offer = null;
  if (isNum(saleV) && saleV > 0 && saleV < price) { price = saleV; why = "Sale"; }
  for (const o of OFFERS) if (o.scope === "all" || o.scope === (isBag ? "bags" : "items")) {
    const v = Math.round(x.price * (1 - o.pct / 100)); if (v < price) { price = v; why = String(o.name || "Offer"); offer = o; }
  }
  return { list: x.price, price, why, offer };
}
const B = Object.fromEntries(T.bags.map((b) => [b.id, b]));
const itemLeft = (p) => (STOCK && isNum(STOCK.items[p.sid]) ? Math.floor(Math.max(0, STOCK.items[p.sid]) / (p.units || 1)) : null);
const D = T.delivery || { rates: { india: 99, remote: 149 }, freeAbove: 999 };
const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
const catName = Object.fromEntries((T.categories || []).map((c) => [c.id, c.name]));
const entries = [
  ...T.products.map((p) => ({ kind: "p", id: p.id, url: `p/${p.id}`, name: p.name, desc: p.desc, image: img(p.id), extra: [], left: itemLeft(p),
    d: deal(p, p.fixedPrice || (p.units || 1) !== 1 ? NaN : SALE[p.sid], false), type: "Kids stationery > " + (catName[p.cat] || "Stationery"),
    skip: feedSkipItem(p), contents: null })),
  ...T.bags.map((b) => { const names = b.items.map((id) => P[id].name);
    return { kind: "b", id: b.id, url: `bag/${b.id}`, name: b.name, image: cover(b), extra: b.items.filter((id) => id !== (b.cover || b.items[0])).map(img),
      desc: `Ready-packed TadaBoo gift bag with ${b.items.length} items: ${names.join(", ")}.${b.note ? " " + b.note : ""}`, left: capacity(b),
      d: deal(b, SALE["cat-" + b.id], true), type: "Kids gift bags > Return gifts", brand: "TadaBoo",
      skip: b.items.some((id) => feedSkipItem(P[id])) || FEED_SKIP.test(b.name + " " + (b.note || "") + " " + (b.cover || "")), contents: b.items }; }),
];
const stockLine = (e) => e.left === null ? "" : e.left <= 0 ? "Sold out for now" : e.left <= 5 ? `Only ${e.left} left` : "In stock";
const PAGE_CSS = `:root{--bg:#FFF8F0;--card:#fff;--ink:#23264A;--muted:#5C5F78;--price:#B83A0A;--line:#F0E2D4;--ok:#17795E;color-scheme:light}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:400 17px/1.6 "Figtree",system-ui,sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:0 16px}header{border-bottom:2px solid #FFD2BC}header .wrap{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:68px}
header nav{display:flex;gap:2px}header nav a{color:var(--ink);font-weight:600;font-size:.95rem;text-decoration:none;min-height:44px;padding:0 12px;display:inline-flex;align-items:center;border-radius:999px;white-space:nowrap}header nav a:hover{background:#FFF0E2}
@media(max-width:420px){header nav a{padding:0 8px;font-size:.9rem}.wm{font-size:1.3rem!important}}
.wm{font:700 1.5rem/1 "Fredoka",system-ui;text-decoration:none;color:var(--ink);min-height:44px;display:inline-flex;align-items:center}.wm .t{color:#E2541A;font-style:italic}.wm .s{color:#FFC63A;font-size:.55em;vertical-align:.7em}
a{color:var(--price);font-weight:600}.back{min-height:44px;display:inline-flex;align-items:center}
main{padding:24px 0 56px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px;align-items:start}
@media(max-width:700px){main{grid-template-columns:1fr}}
.photo{width:100%;height:auto;aspect-ratio:4/5;object-fit:cover;border-radius:20px;background:#fff;display:block}
h1{font:600 clamp(1.6rem,1.2rem + 1.6vw,2.2rem)/1.15 "Bricolage Grotesque",sans-serif;margin:0 0 8px;text-wrap:balance}
.price{font:700 1.6rem/1.2 "Figtree",sans-serif;color:var(--price);margin:0}.was{color:var(--muted);text-decoration:line-through;font-size:1rem;margin-left:8px;font-weight:600}
.why{display:inline-block;background:#FFEFE0;color:var(--price);border-radius:999px;padding:2px 10px;font-size:.85rem;font-weight:600;margin-top:6px}
.stock{color:var(--ok);font-weight:600;margin:10px 0 0}.stock.out{color:var(--muted)}
p{margin:0 0 12px}.info{display:flex;flex-direction:column;gap:6px}
.cta{display:inline-flex;align-items:center;justify-content:center;min-height:50px;padding:0 24px;border-radius:999px;background:var(--ink);color:#fff;text-decoration:none;font-weight:600;border:2px solid var(--ink);margin:14px 10px 0 0}
.cta.line{background:transparent;color:var(--ink)}
.buy{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}.buy .cta{margin:0;flex:1 1 auto}
@media(max-width:700px){.buy{position:sticky;bottom:0;z-index:5;margin-inline:-16px;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));background:var(--bg);border-top:1px solid var(--line)}}
.ship{display:flex;align-items:center;gap:8px;background:#E5F6EC;border-radius:14px;padding:10px 12px;font-size:.92rem;margin:12px 0 0}
.more{grid-column:1/-1;margin-top:8px}.more h2{font:600 1.35rem/1.2 "Bricolage Grotesque",sans-serif;margin:0 0 14px}
.more ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:14px}
.more li a{display:flex;flex-direction:column;gap:6px;background:var(--card);border-radius:18px;padding:8px 8px 12px;text-decoration:none;color:var(--ink);font-weight:600;font-size:.92rem;line-height:1.3;height:100%}
.more li img{width:100%;height:auto;aspect-ratio:4/5;object-fit:cover;border-radius:12px}.more li b{color:var(--price);font-size:1rem}
ul.items{list-style:none;padding:0;margin:8px 0 0;display:grid;gap:8px}ul.items li{display:flex;align-items:center;gap:10px}ul.items img{width:48px;height:60px;object-fit:cover;border-radius:8px}
.share{display:inline-flex;align-items:center;min-height:44px;color:#17795E}
.small{font-size:.92rem;color:var(--muted)}footer{padding:24px 0 40px;color:var(--muted);font-size:.9rem}footer a{display:inline-block;padding:12px 0}`;
// "You may also like": up to four other things that can be bought now. For a gift bag, other gift bags;
// for a product, the gift bags that hold it, then its category neighbours (catalogue order, starting after it).
const inStock = (x) => x.left === null || x.left > 0;
const moreCard = (x) => `<li><a href="/${x.url}"><img src="/${x.image}" alt="" loading="lazy" width="416" height="520">${esc(x.name)}<b>${inr(x.d.price)}</b></a></li>`;
function related(e) {
  const bags = entries.filter((x) => x.kind === "b" && x.id !== e.id && inStock(x));
  let picks;
  if (e.kind === "b") picks = bags;
  else {
    const same = entries.filter((x) => x.kind === "p" && P[x.id].cat === P[e.id].cat), at = same.findIndex((x) => x.id === e.id);
    picks = [...bags.filter((x) => x.contents.includes(e.id)).slice(0, 2), ...[...same.slice(at + 1), ...same.slice(0, at)].filter(inStock)];
  }
  picks = picks.slice(0, 4);
  return picks.length ? `<section class="more" aria-labelledby="moreTitle"><h2 id="moreTitle">You may also like</h2><ul>${picks.map(moreCard).join("")}</ul></section>` : "";
}
// Visit count on every generated page (website/visit.js), sent to the order inbox.
const VISIT = T.orders && T.orders.url ? `<script src="/visit.js" data-hit="${esc(T.orders.url.replace(/\/order$/, "/hit"))}" defer></script>` : "";
function productPage(e) {
  const abs = SITE_URL + e.url, d = e.d, out = e.left !== null && e.left <= 0;
  const ld = { "@context": "https://schema.org", "@type": "Product", name: e.name, image: [SITE_URL + e.image, ...e.extra.map((s) => SITE_URL + s)], description: e.desc, sku: (e.kind === "b" ? "bag-" : "") + e.id,
    ...(e.brand ? { brand: { "@type": "Brand", name: e.brand } } : {}),
    offers: { "@type": "Offer", url: abs, price: d.price, priceCurrency: "INR", itemCondition: "https://schema.org/NewCondition",
      ...(e.left === null ? {} : { availability: "https://schema.org/" + (out ? "OutOfStock" : "InStock") }) } };
  const items = e.contents ? `<p class="small" style="margin-top:14px">What's inside</p><ul class="items">${e.contents.map((id) => `<li><img src="/${thumb(id)}" alt="" loading="lazy" width="48" height="60"><a href="/p/${id}">${esc(P[id].name)}</a></li>`).join("")}</ul>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(e.name)} · TadaBoo</title>
<meta name="description" content="${esc((e.desc + " " + inr(d.price) + ", delivered anywhere in India.").slice(0, 300))}">
<link rel="canonical" href="${abs}">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon.png">
<meta property="og:type" content="product"><meta property="og:site_name" content="TadaBoo"><meta property="og:title" content="${esc(e.name)} · ${inr(d.price)}"><meta property="og:description" content="${esc((e.desc + " Delivered anywhere in India.").slice(0, 200))}"><meta property="og:image" content="${SITE_URL + e.image}"><meta property="og:url" content="${abs}">
<meta property="product:price:amount" content="${d.price}"><meta property="product:price:currency" content="INR"><meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/fonts/fonts.css">
<style>${PAGE_CSS}</style>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
${VISIT}
</head>
<body>
<header><div class="wrap"><a class="wm" href="/"><span class="t">TADA</span><span class="s">✦</span>BOO</a><nav aria-label="Shop"><a href="/#bags">Gift bags</a><a href="/#shop">Shop</a><a href="/#order">How to order</a></nav></div></header>
<main class="wrap">
  <img class="photo" src="/${e.image}" alt="${esc(e.name)}" width="520" height="650">
  <div class="info">
    <h1>${esc(e.name)}</h1>
    <p class="price">${inr(d.price)}${d.price < d.list ? `<span class="was">${inr(d.list)}</span>` : ""}</p>
    ${d.why ? `<span class="why">${esc(d.why)}</span>` : ""}
    ${stockLine(e) ? `<p class="stock${out ? " out" : ""}">${stockLine(e)}</p>` : ""}
    <p style="margin-top:10px">${esc(e.desc)}</p>
    ${items}
    <p class="ship">${d.price >= D.freeAbove ? "Free delivery" : `Delivery ${inr(D.rates.india)}, free from ${inr(D.freeAbove)}`} · arrives in ${T.deliveryDays || "7–10 days"}</p>
    <div class="buy">${out
      ? `<a class="cta" href="https://wa.me/${T.whatsapp}?text=${encodeURIComponent(`Hi TadaBoo! Please tell me when ${e.name} is back in stock.`)}" target="_blank" rel="noopener">Tell me when it's back</a><a class="cta line" href="/?open=${e.kind}:${e.id}">See it in the shop</a>`
      : `<a class="cta" href="/?add=${e.kind}:${e.id}">Add to bag · ${inr(d.price)}</a><a class="cta line" href="https://wa.me/${T.whatsapp}?text=${encodeURIComponent(`Hi TadaBoo! A question about ${e.name}:`)}" target="_blank" rel="noopener">Ask on WhatsApp</a>`}</div>
    <p style="margin:12px 0 0"><a class="share" href="https://wa.me/?text=${encodeURIComponent(`Look at this from TadaBoo: ${e.name}, ${inr(d.price)} ${abs}?s=share`)}" target="_blank" rel="noopener">Share on WhatsApp</a></p>
    <p class="small" style="margin-top:14px">Delivered anywhere in India in ${T.deliveryDays || "7–10 days"}. Delivery ${inr(D.rates.india)} (${inr(D.rates.remote)} to the North East), free when items total ${inr(D.freeAbove)} or more. Every order comes with a thank-you card and a bookmark.</p>
  </div>
  ${related(e)}
</main>
<footer><div class="wrap">© TadaBoo · <a href="/">Shop</a> · <a href="/policies">Policies &amp; privacy</a></div></footer>
</body>
</html>
`;
}
const g = (k, v) => `<g:${k}>${xml(v)}</g:${k}>`;
const ist = (day, end) => `${day}T${end ? "23:59" : "00:00"}+05:30`;
function feedItem(e) {
  const d = e.d, out = e.left !== null && e.left <= 0;
  const parts = [g("id", (e.kind === "b" ? "bag-" : "") + e.id), g("title", e.name.replace(/ · /g, " - ").slice(0, 150)), g("description", e.desc.slice(0, 5000)),
    g("link", SITE_URL + e.url), g("image_link", SITE_URL + e.image), ...e.extra.slice(0, 10).map((s) => g("additional_image_link", SITE_URL + s)),
    g("availability", out ? "out_of_stock" : "in_stock"), g("price", d.list.toFixed(2) + " INR")];
  if (d.price < d.list) {
    parts.push(g("sale_price", d.price.toFixed(2) + " INR"));
    if (d.offer) parts.push(g("sale_price_effective_date", `${ist(d.offer.from)}/${ist(d.offer.to, true)}`));
  }
  parts.push(g("condition", "new"), g("identifier_exists", "no"), g("product_type", e.type));
  if (e.brand) parts.push(g("brand", e.brand));
  return `<item>\n  ${parts.join("\n  ")}\n</item>`;
}
const feedEntries = entries.filter((e) => !e.skip);
const gen = {
  "google-feed.xml": `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>TadaBoo</title>
<link>${SITE_URL}</link>
<description>Kids' stationery and ready-packed gift bags, delivered anywhere in India.</description>
${feedEntries.map(feedItem).join("\n")}
</channel>
</rss>
`,
  "sitemap-products.xml": `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((e) => `  <url><loc>${SITE_URL + e.url}</loc></url>`).join("\n")}
</urlset>
`,
};
for (const e of entries) gen[e.url + ".html"] = productPage(e);
// Gift guides, their index and sitemap.xml (guides.mjs): same live prices and stock as the pages above.
Object.assign(gen, buildGuides({ entries, T, D, P, SITE_URL, inr, esc, VISIT, stockDay: String((STOCK && STOCK.asOf) || "2026-11-11").slice(0, 10) }));
// Pages for products that left the catalogue are removed.
const stale = [];
for (const dir of ["p", "bag"]) {
  const abs = path.join(site, dir);
  if (fs.existsSync(abs)) for (const f of fs.readdirSync(abs)) if (!gen[`${dir}/${f}`]) stale.push(`${dir}/${f}`);
}
const changed = Object.entries(gen).filter(([f, s]) => { try { return read(f) !== s; } catch { return true; } }).map(([f]) => f);
const skipped = entries.filter((e) => e.skip).map((e) => (e.kind === "b" ? "bag " : "") + e.id);
const summary = `${entries.length} product pages, feed of ${feedEntries.length} (left out for character names or photos: ${skipped.join(", ") || "none"})`;

if (process.argv.includes("--check")) {
  let bad = false;
  if (html !== before) { console.error("index.html is STALE: run  node tadaboo/scripts/prerender.mjs  and commit the result."); bad = true; }
  if (changed.length || stale.length) { console.error(`Product pages/feed are STALE (${[...changed, ...stale].slice(0, 5).join(", ")}…): run  node tadaboo/scripts/prerender.mjs  and commit.`); bad = true; }
  if (bad) process.exit(1);
  console.log(`Prerender OK (${T.bags.length} gift bags, ${T.products.length} products, prices from ${STOCK ? "stock.json" : "catalog.js"}; ${summary}).`);
} else {
  if (html !== before) fs.writeFileSync(path.join(site, "index.html"), html);
  for (const f of changed) { fs.mkdirSync(path.dirname(path.join(site, f)), { recursive: true }); fs.writeFileSync(path.join(site, f), gen[f]); }
  for (const f of stale) fs.unlinkSync(path.join(site, f));
  console.log(`${html !== before ? "Updated" : "Already up to date:"} index.html (${T.bags.length} gift bags, ${T.products.length} products, prices from ${STOCK ? "stock.json" : "catalog.js"}). ${changed.length + stale.length} product files changed; ${summary}.`);
}

// Reminder only (does not change any output): "New" tags are meant to last 45 days.
{
  const old = T.products.filter((p) => p.added && Date.now() - Date.parse(p.added) > 45 * 864e5).map((p) => p.id);
  if (old.length) console.log(`Note: remove \`added\` from these catalog.js rows, they are no longer new: ${old.join(", ")}.`);
}
