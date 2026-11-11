// Gift guides (website/guides/*.html), the guides index and sitemap.xml. Called by prerender.mjs.
//
// Each guide answers one thing a parent types into a search box. The words are written here; the
// picks, prices and stock come from catalog.js + stock.json every time prerender runs, so a guide
// never shows an old price or a sold-out item. Output depends only on those two files (no clock),
// so an unchanged stock.json gives byte-identical pages.
//
// To add a guide: add an entry to GUIDES below and run  node tadaboo/scripts/prerender.mjs

const CSS = `:root{--bg:#FFF8F0;--card:#fff;--ink:#23264A;--muted:#5C5F78;--orange:#FF6B2C;--price:#B83A0A;--line:#F0E2D4;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:400 17px/1.7 "Figtree",system-ui,sans-serif}
.wrap{max-width:780px;margin:0 auto;padding:0 16px}
header{border-bottom:2px solid color-mix(in srgb,var(--orange) 35%,transparent);background:var(--bg)}
header .wrap{display:flex;align-items:center;justify-content:space-between;min-height:68px}
.wm{font:700 1.5rem/1 "Fredoka",system-ui;text-decoration:none;color:var(--ink);min-height:44px;display:inline-flex;align-items:center}.wm .t{color:#E2541A;font-style:italic}.wm .s{color:#FFC63A;font-size:.55em;vertical-align:.7em}
a{color:var(--price);font-weight:600}
.back{min-height:44px;display:inline-flex;align-items:center}
main{padding:28px 0 64px}
h1{font:600 clamp(1.9rem,1.4rem + 2vw,2.7rem)/1.1 "Bricolage Grotesque",sans-serif;margin:0 0 8px;text-wrap:balance}
h2{font:600 1.4rem/1.2 "Bricolage Grotesque",sans-serif;margin:28px 0 10px}
h3{font:600 1.1rem/1.3 "Bricolage Grotesque",sans-serif;margin:0 0 4px}
h3 a{color:var(--ink);text-decoration:none}
.updated{color:var(--muted);margin:0 0 18px;font-size:.92rem}
.lede{font-size:1.1rem}
p,ul,ol{margin:0 0 12px}ul,ol{padding-left:22px}li{margin-bottom:6px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;margin:16px 0}
@media(max-width:480px){.cards{grid-template-columns:1fr 1fr;gap:10px}}
.card{background:var(--card);border-radius:20px;padding:12px 12px 14px;border:1px solid var(--line);display:flex;flex-direction:column}
.card img{width:100%;height:auto;aspect-ratio:1/1;object-fit:cover;border-radius:14px;display:block;margin-bottom:10px}
.card .price{color:var(--price);font-weight:600;margin:0 0 6px}
.card p{margin:0 0 8px;font-size:.93rem;line-height:1.5}
.card .cta{margin:auto 0 0;min-height:44px;padding:0 16px;font-size:.95rem;justify-content:center}
.box{background:var(--card);border-radius:20px;padding:18px 20px;margin:16px 0;border:1px solid var(--line)}
table{border-collapse:collapse;width:100%;background:var(--card);border-radius:14px;overflow:hidden;font-size:.97rem}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line)}th{background:#FFEFE0}
.tw{overflow-x:auto}
.cta{display:inline-flex;align-items:center;min-height:48px;padding:0 22px;border-radius:999px;background:var(--ink);color:#fff;text-decoration:none;font-weight:600;margin:6px 8px 6px 0;border:2px solid var(--ink)}
.cta.line{background:transparent;color:var(--ink)}
details{background:var(--card);border-radius:14px;padding:2px 16px;margin-bottom:10px;border:1px solid var(--line)}summary{font-weight:600;cursor:pointer;padding:10px 0}
.strip{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}
.pn{background:var(--card);border:2px solid var(--ink);border-radius:14px;padding:10px 8px;text-align:center;font-size:.9rem;line-height:1.35}
.pn b{display:block;font-size:2rem;line-height:1.2;margin-bottom:4px}
@media(max-width:560px){.strip{grid-template-columns:1fr}.pn{display:flex;align-items:center;gap:12px;text-align:left;font-size:1rem}.pn b{margin:0;font-size:1.8rem}}
.glist{list-style:none;padding:0;margin:16px 0;display:grid;gap:12px}
.glist a{display:block;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px 18px;text-decoration:none;color:var(--ink)}
.glist b{display:block;font:600 1.15rem/1.3 "Bricolage Grotesque",sans-serif;margin-bottom:2px}.glist span{color:var(--muted);font-weight:400;font-size:.95rem}
footer{padding:24px 0 40px;color:var(--muted);font-size:.9rem}footer a{display:inline-block;padding:12px 0}`;

export function buildGuides({ entries, T, D, P, SITE_URL, inr, esc, stockDay, VISIT = "" }) {
  const live = (e) => e.left === null || e.left > 0;
  const bags = entries.filter((e) => e.kind === "b" && live(e)), items = entries.filter((e) => e.kind === "p" && live(e));
  const bagOf = (e) => T.bags.find((b) => b.id === e.id), prodOf = (e) => P[e.id];
  const byPrice = (a, b) => a.d.price - b.d.price;
  const has = (e, ...tags) => tags.some((t) => prodOf(e).tags.includes(t));
  const days = T.deliveryDays || "7–10 days", free = D.freeAbove, wa = `https://wa.me/${T.whatsapp}`;

  const blurb = (e) => e.kind === "b" ? `${e.contents.length} items: ${e.contents.map((id) => P[id].name).join(", ")}.` : e.desc;
  const card = (e) => `<div class="card"><a href="/${e.url}"><img src="/${e.image}" width="416" height="416" loading="lazy" alt="${esc(e.name)}"></a><h3><a href="/${e.url}">${esc(e.name)}</a></h3><p class="price">${inr(e.d.price)}</p><p>${esc(blurb(e))}</p><a class="cta" href="/?add=${e.kind}:${e.id}">Add to bag</a></div>`;
  const cards = (list) => `<div class="cards">\n    ${list.map(card).join("\n    ")}\n  </div>`;
  const section = (title, intro, list) => list.length ? `<h2>${title}</h2>\n  ${intro ? `<p>${intro}</p>\n  ` : ""}${cards(list)}` : "";
  const sumTable = (prices, counts) => { const ps = [...new Set(prices)].slice(0, 4); return ps.length ? `<h2>Do the sum first</h2>
  <div class="tw"><table>
    <tr><th>Per child</th>${counts.map((n) => `<th>${n} kids</th>`).join("")}</tr>
    ${ps.map((p) => `<tr><td>${inr(p)}</td>${counts.map((n) => `<td>${inr(p * n)}</td>`).join("")}</tr>`).join("\n    ")}
  </table></div>
  <p>Delivery is free when items total ${inr(free)} or more.</p>` : ""; };
  const BASE_FAQ = [
    ["Is delivery free?", `Items worth ${inr(free)} or more ship free. Smaller orders pay ${inr(D.rates.india)}, or ${inr(D.rates.remote)} to the North East.`],
    ["How long does delivery take?", `${days} to anywhere in India. For a party, order two weeks ahead.`],
    ["Will it look exactly like the photo?", "Colours, characters or designs may vary with availability. The product type and value stay the same."],
  ];
  const SAFE = "These are for school-going children. Many items have small parts, so they are not for children under 3.";

  const GUIDES = [
    { slug: "return-gift-ideas-under-300", published: "2026-11-03", image: "labubu-gel-pen",
      h1: "Return gift ideas under ₹300, without the party panic", title: "Return gift ideas under ₹300",
      lede: "Twenty kids. One cake. Zero spare minutes. Let's sort the return gifts, so you can go back to the balloons.",
      strip: [["🗓️", "Last week: \"Return gifts? Loads of time.\""], ["🎈", "Party day: 20 kids, plus one cousin nobody counted."], ["🎁", "TADA! Bags ready. You sit down for cake."]],
      body() {
        const b = bags.filter((e) => e.d.price <= 300).sort(byPrice), it = items.filter((e) => has(e, "return") && e.d.price <= 100).sort(byPrice).slice(0, 6);
        this.desc = `20 kids, one cake, zero spare minutes? Easy return gift ideas under ₹300: ready-made bags${b.length ? ` from ${inr(b[0].d.price)}` : ""}, build your own, and when to order.`;
        return [sumTable(b.map((e) => e.d.price), [10, 20, 30]),
          section("Ready-made bags", "Each bag is a ready set, so no shopping trip needed. Every order comes with a thank-you card and a bookmark. Need a whole class of one bag? WhatsApp us and we'll check stock.", b),
          `<p><a class="cta" href="/#bags">See all gift bags</a></p>`,
          section("Or build your own", `Pick single items and we pack them. A custom bag needs items worth more than ${inr(T.customMin)} in total.`, it),
          `<p><a class="cta line" href="/#build">Build a custom bag</a></p>`];
      },
      tips: ["<b>Pick one theme.</b> Matching bags look like a proper gift.", "<b>Order a few extra.</b> Someone always brings a cousin.", `<b>Order two weeks ahead.</b> Delivery anywhere in India takes ${days}.`],
      faq: [["Can I order one bag for the whole class?", `Yes. Add as many as are in stock. Need more? WhatsApp us on ${T.phone}.`]] },

    { slug: "return-gifts-under-200", published: "2026-11-11", image: "puzzle-whiteboard",
      h1: "Return gifts under ₹200 that kids actually use", title: "Return gifts under ₹200",
      lede: "A small budget does not have to mean a plastic toy that breaks in the car. Here is what ₹200 a child buys today.",
      body() {
        const b = bags.filter((e) => e.d.price <= 200).sort(byPrice), it = items.filter((e) => e.d.price <= 100 && has(e, "return", "crafty", "school")).sort(byPrice).slice(0, 8);
        this.desc = `Return gifts under ₹200 for kids' birthday parties: ${b.length ? `ready-packed bags from ${inr(b[0].d.price)}, ` : ""}pens, erasers and craft sets${it.length ? ` from ${inr(it[0].d.price)}` : ""}. Delivered anywhere in India.`;
        return [sumTable([...b.map((e) => e.d.price), ...it.slice(0, 2).map((e) => e.d.price)].sort((x, y) => x - y), [10, 20, 30]),
          section("Ready-packed bags under ₹200", "Open the box, hand them out. Every order comes with a thank-you card and a bookmark.", b),
          section("Single gifts under ₹100", `One useful thing beats five forgettable ones. Mix any of these; a custom bag needs items worth more than ${inr(T.customMin)} in total, which a party order crosses easily.`, it),
          `<p><a class="cta" href="/#shop">See everything in the shop</a></p>`];
      },
      tips: ["<b>Choose things that get used.</b> Pens, erasers and notebooks go to school the next day.", "<b>Same gift for everyone.</b> It saves the \"why did she get that one\" talk.", `<b>Order two weeks ahead.</b> Delivery takes ${days}.`],
      faq: [["What is the cheapest return gift you have?", "The shop's Budget buttons show everything up to ₹50, ₹100 and ₹300. Prices on this page are today's prices."]] },

    { slug: "return-gifts-for-a-class-of-30", published: "2026-11-11", image: "labubu-gel-pen",
      h1: "Return gifts for a class of 30", title: "Return gifts for a class of 30",
      lede: "The whole class is coming. You need thirty of the same thing, in one box, on time. Here is what we can send today.",
      body() {
        const many = items.filter((e) => e.left !== null && e.left >= 30).sort(byPrice), top = many.slice(0, 8);
        const kindOf = (e) => (/sharpener|eraser|pencil|notebook|sticker|highlighter|pen/i.exec(e.name) || [prodOf(e).cat])[0].toLowerCase();
        const trio = []; for (const e of many) if (!trio.some((x) => kindOf(x) === kindOf(e))) { trio.push(e); if (trio.length === 3) break; }
        const each = trio.reduce((s, e) => s + e.d.price, 0);
        this.desc = `Thirty matching return gifts for a class birthday: ${top.length ? `${top.length} gifts with 30 or more in stock today, from ${inr(top[0].d.price)} each. ` : ""}What it costs, and when to order.`;
        return [top.length ? sumTable(top.map((e) => e.d.price), [20, 30, 40]) : "",
          section("In stock for 30 today", "Each of these has thirty or more in stock right now. Add one to your bag, then change the number to 30.", top),
          trio.length === 3 ? `<div class="box"><h3>An easy set of three</h3><p>${trio.map((e) => `<a href="/${e.url}">${esc(e.name)}</a>`).join(" + ")} comes to <b>${inr(each)} a child</b>, or ${inr(each * 30)} for 30.${each * 30 >= free ? " Delivery is free at that size." : ""}</p></div>` : "",
          `<h2>Want 30 ready-made bags?</h2>
  <p>Our gift bags are packed in small batches, so the shop may show fewer than 30 of one bag. WhatsApp us the bag and the date, and we will tell you what we can do.</p>
  <p><a class="cta" href="${wa}?text=${encodeURIComponent("Hi TadaBoo! I need return gifts for a class of 30.")}" target="_blank" rel="noopener">WhatsApp us about 30 bags</a><a class="cta line" href="/#bags">See gift bags</a></p>`];
      },
      tips: ["<b>Count the teachers too.</b> Order 32 or 33, not 30.", "<b>Check the school's rules.</b> Some classes ask for no food and no toys. Stationery is usually welcome.", `<b>Order two to three weeks ahead.</b> Delivery takes ${days}, and big orders may need time to pack.`],
      faq: [["Can you send more than what the shop shows?", `Sometimes, with notice. WhatsApp us on ${T.phone} with the item, the number and your date.`]] },

    { slug: "birthday-gifts-for-girls", published: "2026-11-11", image: "crystal-unicorn-pen",
      h1: "Birthday gifts for girls who love cute stationery", title: "Birthday gifts for girls",
      lede: "For the girl who lines up her pens by colour. Small things, big squeals.",
      body() {
        const b = bags.filter((e) => bagOf(e).for === "girls").sort(byPrice), it = items.filter((e) => has(e, "girls", "unicorn", "aesthetic")).sort(byPrice).slice(0, 8);
        this.desc = `Birthday gift ideas for girls: ${b.length ? `ready-packed gift bags from ${inr(b[0].d.price)}, ` : ""}unicorn pens, diaries and craft kits${it.length ? ` from ${inr(it[0].d.price)}` : ""}. Delivered anywhere in India.`;
        return [section("Ready-packed gift bags", "One box, already matched. Every order comes with a thank-you card and a bookmark.", b),
          section("Little things she will use", "Pick a few and we pack them together.", it),
          `<p class="updated">${SAFE}</p>`, `<p><a class="cta" href="/#bags">See all gift bags</a><a class="cta line" href="/#shop">Browse the shop</a></p>`];
      },
      tips: ["<b>Not sure what she likes?</b> A diary plus a pen is hard to get wrong.", `<b>Spend ${inr(free)} or more</b> and delivery is free.`, `<b>Order two weeks ahead.</b> Delivery takes ${days}.`],
      faq: [] },

    { slug: "birthday-gifts-for-boys", published: "2026-11-11", image: "rocket-sharpener",
      h1: "Birthday gifts for boys: rockets, racing cars and space", title: "Birthday gifts for boys",
      lede: "For the boy whose pencil box is also a garage. Things that zoom, light up and still fit in a school bag.",
      body() {
        const b = bags.filter((e) => bagOf(e).for === "boys").sort(byPrice), it = items.filter((e) => has(e, "boys", "vroom", "space")).sort(byPrice).slice(0, 8);
        this.desc = `Birthday gift ideas for boys: ${b.length ? `ready-packed gift bags from ${inr(b[0].d.price)}, ` : ""}rocket sharpeners, racing pencils and space sets${it.length ? ` from ${inr(it[0].d.price)}` : ""}. Delivered anywhere in India.`;
        return [section("Ready-packed gift bags", "One box, already matched. Every order comes with a thank-you card and a bookmark.", b),
          section("Little things he will use", "Pick a few and we pack them together.", it),
          `<p class="updated">${SAFE}</p>`, `<p><a class="cta" href="/#bags">See all gift bags</a><a class="cta line" href="/#shop">Browse the shop</a></p>`];
      },
      tips: ["<b>Not sure what he likes?</b> A sharpener shaped like something fast usually wins.", `<b>Spend ${inr(free)} or more</b> and delivery is free.`, `<b>Order two weeks ahead.</b> Delivery takes ${days}.`],
      faq: [] },

    { slug: "birthday-hampers-under-1000", published: "2026-11-11", image: "dumpling-squishy",
      h1: "Birthday hampers under ₹1,000", title: "Birthday hampers under ₹1,000",
      lede: "A proper present for the birthday child, a niece, a best friend's kid. Packed, matched and sent to their door.",
      body() {
        const b = bags.filter((e) => e.d.price >= 400 && e.d.price <= 1000 && bagOf(e).occasion !== "return").sort((x, y) => y.d.price - x.d.price);
        const freeOnes = b.filter((e) => e.d.price >= free);
        this.desc = `Kids' birthday hampers under ₹1,000: ${b.length ? `${b.length} ready-packed hampers from ${inr(Math.min(...b.map((e) => e.d.price)))}` : "ready-packed hampers"}, with stationery, craft kits and squishies. Delivered anywhere in India.`;
        return [section("Hampers in stock today", `Each one is a ready set of stationery and fun things.${freeOnes.length ? ` ${freeOnes.map((e) => esc(e.name)).join(" and ")} ${freeOnes.length > 1 ? "ship" : "ships"} free.` : ""} Every order comes with a thank-you card and a bookmark.`, b),
          `<p class="updated">${SAFE}</p>`,
          `<h2>Sending it as a gift?</h2>
  <p>Put the birthday child's address at checkout and we deliver it there.</p>
  <p><a class="cta" href="/#bags">See all gift bags</a><a class="cta line" href="${wa}" target="_blank" rel="noopener">WhatsApp us</a></p>`];
      },
      tips: ["<b>Check the stock tag on the photo.</b> Hampers are packed in small numbers.", `<b>Delivery is free from ${inr(free)}.</b> Below that it is ${inr(D.rates.india)}.`, `<b>Order two weeks before the birthday.</b> Delivery takes ${days}.`],
      faq: [["Can I change what is inside a hamper?", `Build your own instead: pick single items worth more than ${inr(T.customMin)} and we pack them together.`]] },
  ];

  const head = (title, desc, url, extra = "") => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${esc(title)} · TadaBoo</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE_URL + url}">
<meta property="og:type" content="article"><meta property="og:site_name" content="TadaBoo"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${SITE_URL + url}"><meta property="og:image" content="${SITE_URL}img/og-share.jpg">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon.png">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="stylesheet" href="/fonts/fonts.css">
<style>
${CSS}
</style>${extra}
${VISIT}
</head>
<body>
<header><div class="wrap"><a class="wm" href="/"><span class="t">TADA</span><span class="s">✦</span>BOO</a><a class="back" href="/">← Back to the shop</a></div></header>`;
  const foot = `<footer><div class="wrap">© TadaBoo · <a href="/">Back to the shop</a> · <a href="/guides/">Gift guides</a> · <a href="/policies">Policies &amp; privacy</a></div></footer>
</body>
</html>
`;
  const out = {}, built = [];
  for (const gd of GUIDES) {
    const body = gd.body().filter(Boolean), faq = [...gd.faq, ...BASE_FAQ], url = `guides/${gd.slug}`;
    const ld = { "@context": "https://schema.org", "@graph": [
      { "@type": "Article", headline: gd.h1, description: gd.desc, datePublished: gd.published, dateModified: stockDay > gd.published ? stockDay : gd.published, image: `${SITE_URL}img/${gd.image}.webp`, inLanguage: "en-IN", mainEntityOfPage: SITE_URL + url,
        author: { "@type": "Organization", name: "TadaBoo", url: SITE_URL }, publisher: { "@type": "Organization", name: "TadaBoo", url: SITE_URL } },
      { "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }] };
    built.push(gd);
    out[url + ".html"] = `${head(gd.title, gd.desc, url, `\n<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`)}
<main class="wrap">
  <h1>${esc(gd.h1)}</h1>
  <p class="updated">By TadaBoo · prices and stock as on the shop today</p>
  <p class="lede">${esc(gd.lede)}</p>
  ${gd.strip ? `<div class="strip">\n    ${gd.strip.map(([e, t]) => `<div class="pn"><b>${e}</b>${esc(t)}</div>`).join("\n    ")}\n  </div>\n  ` : ""}${body.join("\n\n  ")}

  <h2>Three quick tips</h2>
  <ol>
    ${gd.tips.map((t) => `<li>${t}</li>`).join("\n    ")}
  </ol>

  <h2>Quick questions</h2>
  ${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n  ")}

  <h2>More gift guides</h2>
  <ul>
    ${GUIDES.filter((x) => x !== gd).map((x) => `<li><a href="/guides/${x.slug}">${esc(x.title)}</a></li>`).join("\n    ")}
  </ul>

  <div class="box"><h3>Ready? TADA!</h3><p>Pick a bag, or WhatsApp us and we will help you choose.</p><a class="cta" href="/#bags">Shop gift bags</a><a class="cta line" href="${wa}" target="_blank" rel="noopener">WhatsApp us</a></div>
</main>
${foot}`;
  }
  const idxDesc = "Gift guides from TadaBoo: return gifts by budget, gifts for a whole class, birthday gifts for girls and boys, and birthday hampers. Today's prices, delivered anywhere in India.";
  out["guides/index.html"] = `${head("Gift guides", idxDesc, "guides/")}
<main class="wrap">
  <h1>Gift guides</h1>
  <p class="lede">Short answers for busy parents. Every guide shows today's prices and only what is in stock.</p>
  <ul class="glist">
    ${built.map((gd) => `<li><a href="/guides/${gd.slug}"><b>${esc(gd.title)}</b><span>${esc(gd.lede)}</span></a></li>`).join("\n    ")}
  </ul>
  <div class="box"><h3>Rather just browse?</h3><a class="cta" href="/#bags">Shop gift bags</a><a class="cta line" href="/#shop">See the shop</a></div>
</main>
${foot}`;
  // Main sitemap. The home page and guides change whenever stock or prices do, so they carry the stock date.
  const u = (loc, mod) => `  <url><loc>${SITE_URL}${loc}</loc><lastmod>${mod}</lastmod></url>`;
  out["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[u("", stockDay), u("policies", "2026-10-27"), u("guides/", stockDay), ...built.map((gd) => u(`guides/${gd.slug}`, stockDay > gd.published ? stockDay : gd.published))].join("\n")}
</urlset>
`;
  return out;
}
