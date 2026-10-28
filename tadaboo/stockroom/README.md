# TadaBoo Stockroom (source copy)

The live Stockroom is a Claude artifact: https://claude.ai/artifact/LaZN37L8DS7RDsbxhM9inG
Its data (items, bags, purchases, sales, adjustments, orders, expenses, settings) lives in the artifact's own
database, not in this repository. These files are a copy of the published code, kept here for review
and version history. Publish changes to the artifact with the Artifact tool (`url` = the link above,
`file_path` = `index.html`, `files` = `app.js`, and `calc.js` if changed).

## Local testing
On `localhost`, `app.js` swaps the real database for `devdb.js`, an in-browser test double seeded
from `seed.json` (a dump of the live data you build yourself; never commit it, it holds costs and
customer details). Serve this folder with `python3 -m http.server 8766` and open http://localhost:8766.

## Website orders (Orders tab)
Orders reach the owner in one of two ways, and both carry the same order code:
- **On the website** ("Place order"): the order goes to TadaBoo's order inbox (Cloudflare Worker
  `tadaboo/orders-worker`) with name, phone, delivery, address, items, total and `order_code`. The buyer can
  then pay by UPI (if `upi` is set in `catalog.js`). The inbox also files a copy in WebsitePublisher's lead
  capture (project 30289 — "My First Project" in the dashboard — form `tadaboo_order`; needs the Worker
  secret `WP_KEY`, a `wpa_` project key from dashboard.websitepublisher.ai/keys).
  **Live import:** while the Stockroom is open it reads those leads through the owner's *WebsitePublisher AI*
  connector (`mcp` capability, tool `execute_integration`, `leads/get-leads`, last 30 days) on open and every
  minute, and saves each new order id as a *New* order (same record as Save order, plus `source: 'website'`,
  `leadId` = order id, `wpLeadId`). The Orders tab shows when it last checked and a **Check now** button.
  The hourly task (`scripts/scheduled_task.md`) imports from the Cloudflare inbox too, as the backup.
- **On WhatsApp** ("Order on WhatsApp instead"): a prefilled message.

1. Take the order text (the WhatsApp message, or the inbox entry's fields) — it ends with
   `Order code (please keep): TB1|<order id>|<lines>`; each line is
   `kind:stockroomId:qty:unitsPerQty:unitPrice` (`b` = gift bag `cat-<id>`, `i` = item; a box of 12
   pencils is `i:it-racing-pencils:1:12:109`).
2. Paste the message into **Orders → Add an order from WhatsApp → Read order → Save order** (status *New*).
3. Open it, set packaging (gift kits default to one per gift bag plus one for loose items), shipping
   charged and courier cost. **Shipping charged is filled in automatically** (editable): the fee written
   in the order ("Delivery charge: ₹99" / "(₹99)" / "Free"), or for messages without one the website rule
   in `DELIVERY` (₹99, ₹149 for North East PIN codes 78/79/737, free from ₹999 of items; collect = 0). It is saved on the order when
   you save it, and the payment amount (items + shipping) follows any edit. Then then **Confirm order and update stock**. This writes a normal sale with id
   `web-<order id>`, so stock, profit and History update exactly as for a Sell-screen sale.
4. Move it through *Packed → Dispatched* (optional tracking) *→ Delivered*. **Cancel order** deletes its
   sale, which puts the stock back.
5. **Website stock file** saves `stock.json`; put it in `tadaboo/website/` so the site shows
   "Only N left" / "Sold out" and caps quantities. `scripts/sync_stock.py` builds the same file from a
   database dump.

## Fixed costs (More → Fixed costs)
One-time costs that are not stock or packaging (a receipt printer, a stall fee): `expenses/{id}` =
`{ date, label, amount, note, createdAt }`. They don't touch stock or each sale's profit. Home shows profit
after fixed costs for the period, and a "Fixed costs paid back" card: all-time profit against all-time
fixed costs, with the orders still needed at the average profit per order. The Excel export has a
Fixed costs sheet and two extra Summary rows.

New packaging (another box size, bubble wrap, tape): Stock → Packaging → **+ Add packaging**; use it in a
sale or order under Packaging → Custom.

## Packaging given (Sell and order confirmation)
Each sale lists every packaging item with a tick and a quantity. "Gift kit" / "Pouch" fill it from the kits
in Settings (one gift kit per gift bag, plus one for loose items); untick what was not given (e.g. no
thank-you card) or tick extras (bookmark, a shipping box). Only ticked items leave stock. The sale stores
`packaging: { mode: 'gift' | 'pouch' | 'custom' | 'none', pieces: [{ itemId, qty, cost }] }`; a confirmed
order also stores `packQty`.

## Packaging cost (More → Settings → Packaging cost)
Default **In item cost**: packaging counts when it is used. What is ticked under "Packaging given" on a sale,
at its cost per piece (landed), goes into that sale's item cost (`saleTotals(..., packIn = true)`: packCost 0,
packShare = the packaging part). No separate packaging line; customers are never charged for it. Unused
packaging stays in stock, so buying packaging in bulk does not change any cost or margin. Gift-bag cost and
margin (More → Gift bags) include one gift kit at today's cost per piece. A gift-bag sale with nothing ticked
shows a warning. **Separate line** (`settings/main.packCost = 'perSale'`) shows the same packaging cost as its
own line; profit is identical either way.
