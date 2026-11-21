// Category pages: /stationery/ (hub), /stationery/<category> and /gift-bags/. Called by prerender.mjs.
//
// The shop itself is one page, so search engines had no page to show for "kids' pens" or "return gift
// bags", and no plain link from the home page to any product page. Each page here lists one part of
// the catalogue with a plain link to every product page. The words are written here; names, prices,
// counts and stock come from catalog.js + stock.json every time prerender runs (no clock), so an
// unchanged stock.json gives byte-identical pages.
//
// To add a category page: add the category to catalog.js, then a row to CATS below (same id).
import { CSS } from "./guides.mjs";

// id = category id in catalog.js. Words only; nothing here states a price, a count or a stock level.
const CATS = [
  { id: "pens", slug: "pens-highlighters", title: "Cute Pens & Highlighters for Kids", h1: "Cute pens and highlighters for kids",
    lede: "Erasable gel pens, character pens, pastel highlighters and brush pens. Write it, doodle it, make it sparkle." },
  { id: "paper", slug: "pencils-notebooks", title: "Pencils, Notebooks & Sticky Notes for Kids", h1: "Pencils, notebooks and sticky notes for kids",
    lede: "Pencil sets, pocket diaries, sticky notes and page-keepers for the school bag." },
  { id: "sharp", slug: "sharpeners-erasers", title: "Fancy Erasers & Sharpeners for Kids", h1: "Fancy erasers and sharpeners for kids",
    lede: "Sharpeners shaped like rockets, helmets and cameras. Erasers that look like ice cream and fast food. Tiny treasures for every pencil case." },
  { id: "make", slug: "craft-kits", title: "Craft Kits & Activity Sets for Kids", h1: "Craft kits and activity sets for kids",
    lede: "Diamond art bracelets, 3D stickers, colouring murals and reward stamps. Hands-on fun for creative explorers." },
  { id: "gift", slug: "gift-sets-squishies", title: "Stationery Gift Sets & Squishies for Kids", h1: "Stationery gift sets and squishies",
    lede: "Ready stationery sets and squishy toys. Bigger treats for bigger smiles." },
];
// Gift bags by the `occasion` field in catalog.js, in the order shown on /gift-bags/.
const OCCASIONS = [
  ["return", "Return gift bags", "One bag per child, already packed. Add the bag you like and set the number you need."],
  ["birthday", "Birthday hampers", "A bigger present for the birthday child."],
  ["themed", "Themed gift bags for boys and girls", "Cars, space, unicorns and kawaii, matched and packed."],
  ["school", "Back to school bags", "Pencils, pens and the small things a pencil case needs."],
  ["create", "Craft and colouring bags", "For the child who would rather make something."],
];

export function buildCollections({ entries, T, D, P, SITE_URL, inr, esc, VISIT = "" }) {
  const live = (e) => e.left === null || e.left > 0;
  const days = T.deliveryDays || "7–10 days", free = D.freeAbove, wa = `https://wa.me/${T.whatsapp}`;
  const prods = entries.filter((e) => e.kind === "p"), bags = entries.filter((e) => e.kind === "b");
  const bagOf = (e) => T.bags.find((b) => b.id === e.id);
  const inCat = (id) => { const l = prods.filter((e) => P[e.id].cat === id); return [...l.filter(live), ...l.filter((e) => !live(e))]; };
  const cats = CATS.map((c) => ({ ...c, url: `stationery/${c.slug}`, name: (T.categories.find((x) => x.id === c.id) || {}).name, list: inCat(c.id) })).filter((c) => c.name && c.list.length);
  const from = (list) => { const l = list.filter(live); return l.length ? Math.min(...l.map((e) => e.d.price)) : null; };

  const blurb = (e) => e.kind === "b" ? `${e.contents.length} items: ${e.contents.map((id) => P[id].name).join(", ")}.` : e.desc;
  const card = (e) => `<div class="card"><a href="/${e.url}"><img src="/${e.image}" width="416" height="416" loading="lazy" alt="${esc(e.name)}"></a><h3><a href="/${e.url}">${esc(e.name)}</a></h3><p class="price">${inr(e.d.price)}</p><p>${esc(blurb(e))}</p>${live(e) ? `<a class="cta" href="/?add=${e.kind}:${e.id}">Add to bag</a>` : `<p class="updated">Sold out for now</p>`}</div>`;
  const cards = (list) => `<div class="cards">\n    ${list.map(card).join("\n    ")}\n  </div>`;
  const FAQ = [
    ["Do you deliver across India?", `Yes, anywhere in India, in ${days} from your order.`],
    ["Is delivery free?", `Items worth ${inr(free)} or more ship free. Smaller orders pay ${inr(D.rates.india)}, or ${inr(D.rates.remote)} to the North East.`],
    ["How do I order and pay?", `Add things to your bag on the website and pay online by UPI, card, netbanking or wallet, or send the same order on WhatsApp to ${T.phone} and we send you a payment link.`],
    ["Will it look exactly like the photo?", "Colours, characters or designs may vary with availability. The product type and value stay the same."],
  ];
  const faqHtml = (faq) => `<h2>Quick questions</h2>\n  ${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n  ")}`;
  const crumbs = (trail) => `<p class="updated"><a href="/">Shop</a>${trail.map(([n, u]) => ` › ${u ? `<a href="/${u}">${esc(n)}</a>` : esc(n)}`).join("")}</p>`;
  const ld = (url, name, trail, list, faq) => ({ "@context": "https://schema.org", "@graph": [
    { "@type": "BreadcrumbList", itemListElement: [["Shop", ""], ...trail.map(([n, u]) => [n, u === undefined ? url : u])].map(([n, u], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: SITE_URL + u })) },
    { "@type": "ItemList", name, numberOfItems: list.length, itemListElement: list.map((e, i) => ({ "@type": "ListItem", position: i + 1, name: e.name, url: SITE_URL + e.url })) },
    { "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }] });
  const head = (title, desc, url, data) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${esc(title)} · TadaBoo</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE_URL + url}">
<meta property="og:type" content="website"><meta property="og:site_name" content="TadaBoo"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${SITE_URL + url}"><meta property="og:image" content="${SITE_URL}img/og-share.jpg"><meta property="og:locale" content="en_IN">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon.png">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="stylesheet" href="/fonts/fonts.css">
<style>
${CSS}
</style>
<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
${VISIT}
</head>
<body>
<header><div class="wrap"><a class="wm" href="/"><span class="t">TADA</span><span class="s">✦</span>BOO</a><a class="back" href="/">← Back to the shop</a></div></header>`;
  const foot = `<footer><div class="wrap">© TadaBoo · <a href="/">Back to the shop</a> · <a href="/stationery/">Stationery</a> · <a href="/gift-bags/">Gift bags</a> · <a href="/guides/">Gift guides</a> · <a href="/about">About us</a> · <a href="/policies">Policies &amp; privacy</a></div></footer>
</body>
</html>
`;
  const others = (skip) => `<h2>More to explore</h2>
  <ul>
    ${[...cats.filter((c) => c.url !== skip).map((c) => [c.url, c.name]), ["gift-bags/", "Gift bags and birthday hampers"], ["stationery/", "All stationery"], ["guides/", "Gift guides"]].filter(([u]) => u !== skip).map(([u, n]) => `<li><a href="/${u}">${esc(n)}</a></li>`).join("\n    ")}
  </ul>`;
  const facts = (list) => { const f = from(list); return `<p>${list.length} to choose from${f !== null ? `, from ${inr(f)}` : ""}. Delivered anywhere in India in ${days}. Delivery is free when items total ${inr(free)} or more.</p>`; };
  const out = {};

  // ---- One page per shop category ----
  for (const c of cats) {
    const f = from(c.list), holders = bags.filter((b) => live(b) && b.contents.some((id) => P[id].cat === c.id)).slice(0, 4);
    const desc = `${c.lede.split(". ")[0].replace(/\.$/, "")}. ${c.list.length} to choose from${f !== null ? `, from ${inr(f)}` : ""}. Delivered anywhere in India.`;
    const faq = [["Can I buy just one?", `Yes. Pick single items and we pack them together. With single items, your items must total more than ${inr(T.customMin)} before delivery; gift bags count toward it.`], ...FAQ];
    const trail = [["Stationery", "stationery/"], [c.name]];
    out[c.url + ".html"] = `${head(c.title, desc, c.url, ld(c.url, c.h1, trail, c.list, faq))}
<main class="wrap">
  ${crumbs(trail)}
  <h1>${esc(c.h1)}</h1>
  <p class="lede">${esc(c.lede)}</p>
  ${facts(c.list)}
  <h2>All ${c.list.length} to choose from</h2>
  ${cards(c.list)}
  ${holders.length ? `<h2>Already packed as a gift</h2>\n  <p>These ready-made gift bags include something from this page.</p>\n  ${cards(holders)}` : ""}

  ${faqHtml(faq)}

  ${others(c.url)}

  <div class="box"><h3>Need help choosing?</h3><p>WhatsApp us and we will help you pick.</p><a class="cta" href="/#shop">Open the shop</a><a class="cta line" href="${wa}" target="_blank" rel="noopener">WhatsApp us</a></div>
</main>
${foot}`;
  }

  // ---- /stationery/: every category, every product ----
  {
    const all = cats.flatMap((c) => c.list), f = from(all), url = "stationery/";
    const title = "Cute Stationery for Kids, Online in India", h1 = "Cute stationery for kids";
    const desc = `Cute stationery for kids: pens, pencils, notebooks, fancy erasers, sharpeners, craft kits and squishies. ${all.length} things${f !== null ? ` from ${inr(f)}` : ""}, delivered anywhere in India.`;
    const faq = [["Is there a minimum order?", `With single items, your items (gift bags included) must total more than ${inr(T.customMin)} before delivery. Ready-made gift bags on their own have no minimum.`], ...FAQ];
    out[url + "index.html"] = `${head(title, desc, url, ld(url, h1, [["Stationery"]], all, faq))}
<main class="wrap">
  ${crumbs([["Stationery"]])}
  <h1>${esc(h1)}</h1>
  <p class="lede">Little things that make you go tada! Pens, pencils, erasers, sharpeners, craft kits and squishies for school-going children.</p>
  ${facts(all)}
  ${cats.map((c) => `<h2><a href="/${c.url}">${esc(c.name)}</a></h2>\n  <p>${esc(c.lede)}</p>\n  ${cards(c.list)}`).join("\n\n  ")}

  <h2>Want it packed as a gift?</h2>
  <p>Our <a href="/gift-bags/">gift bags and birthday hampers</a> come ready to hand over. Every order comes with a thank-you card and a bookmark.</p>

  ${faqHtml(faq)}

  ${others(url)}
</main>
${foot}`;
  }

  // ---- /gift-bags/: every ready-made bag, by occasion ----
  {
    const order = (l) => [...l.filter(live), ...l.filter((e) => !live(e))];
    const groups = OCCASIONS.map(([key, name, line]) => ({ name, line, list: order(bags.filter((e) => bagOf(e).occasion === key)) }));
    const rest = order(bags.filter((e) => !OCCASIONS.some(([k]) => k === bagOf(e).occasion)));
    if (rest.length) groups.push({ name: "More gift bags", line: "", list: rest });
    const shown = groups.filter((gp) => gp.list.length), all = shown.flatMap((gp) => gp.list), f = from(all), url = "gift-bags/";
    const title = "Return Gift Bags & Birthday Hampers for Kids", h1 = "Return gift bags and birthday hampers for kids";
    const desc = `Ready-packed return gift bags and birthday hampers for kids, filled with stationery and craft kits. ${all.length} gift bags${f !== null ? ` from ${inr(f)}` : ""}, delivered anywhere in India.`;
    const faq = [
      ["Can I order many return gifts for a party?", "Yes. Add the return-gift bag you like, set the quantity, and send it to us. We'll confirm stock for larger orders."],
      ["Can I choose what goes in the bag?", `Yes. Build your own: pick single items and we pack them together. Your items must total more than ${inr(T.customMin)} before delivery. Ready-made gift bags have no minimum.`],
      ["What comes with every order?", "A thank-you card and a TadaBoo bookmark."], ...FAQ];
    out[url + "index.html"] = `${head(title, desc, url, ld(url, h1, [["Gift bags"]], all, faq))}
<main class="wrap">
  ${crumbs([["Gift bags"]])}
  <h1>${esc(h1)}</h1>
  <p class="lede">Ready, set… gift! Stationery and craft kits, matched and packed, so the party bags are done before the cake is.</p>
  ${facts(all)}
  ${shown.map((gp) => `<h2>${esc(gp.name)}</h2>\n  ${gp.line ? `<p>${esc(gp.line)}</p>\n  ` : ""}${cards(gp.list)}`).join("\n\n  ")}

  <h2>Planning a party?</h2>
  <p>Delivery takes ${days}, so order two weeks ahead. Our <a href="/guides/">gift guides</a> work out the cost for 10, 20 or 30 children.</p>
  <p><a class="cta" href="/#build">Build your own bag</a><a class="cta line" href="${wa}" target="_blank" rel="noopener">WhatsApp us</a></p>

  ${faqHtml(faq)}

  ${others(url)}
</main>
${foot}`;
  }

  // What prerender.mjs needs from here: the pages, their URLs (sitemap, llms.txt) and each product's category page (breadcrumb).
  const pages = [{ url: "stationery/", name: "Stationery" }, ...cats.map((c) => ({ url: c.url, name: c.name })), { url: "gift-bags/", name: "Gift bags and birthday hampers" }];
  const catOf = Object.fromEntries(cats.map((c) => [c.id, { url: c.url, name: c.name }]));
  return { files: out, pages, catOf };
}
