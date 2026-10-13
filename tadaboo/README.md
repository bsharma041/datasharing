# TadaBoo

Workspace for the TadaBoo business: the **Tadaboo agent**, its knowledge base, and the customer website.

```
.claude/agents/tadaboo.md      The Tadaboo agent (Claude Code subagent)
tadaboo/
  knowledge/business.md        Business, brand, catalogue rules, unit economics, suppliers, open issues
  knowledge/snapshot.json      Stockroom snapshot: items, landed costs, stock, bag economics (13 Oct 2026)
  scripts/build_snapshot.py    Rebuild snapshot.json from a Stockroom database dump
  scripts/extract_images.py    Pull product photos out of the catalogue PDF
  website/index.html           Storefront: gift collections, gift finder, shop, custom-bag builder, WhatsApp checkout
  website/catalog.js           Products, prices and gift collections (from the catalogue)
  website/img/                 Product photos, gift bag, thank-you card, bookmark
  website/stock.json           Stock the website may sell (from the Stockroom; refresh after orders/purchases)
  stockroom/                   Source copy of the Stockroom artifact + local test harness; README explains the order flow
  scripts/sync_stock.py        Rebuild website/stock.json from a Stockroom database dump
```

## Using the agent

In Claude Code, from this repository, ask for it by name, for example:

- "Use the tadaboo agent to give me this week's business pulse."
- "Tadaboo: plan a restock so we can pack 15 Return Gift · Classic bags."
- "Tadaboo: add the ChibiCharm sticky notes to the website at ₹79."

## Running the website

Static files, no build step. Open `tadaboo/website/index.html` in a browser, or serve the folder:

```
cd tadaboo/website && python3 -m http.server 8000
```

Deploy by uploading the `website/` folder to any static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages).
Orders go to WhatsApp **97306 24700** (set in `catalog.js`).
