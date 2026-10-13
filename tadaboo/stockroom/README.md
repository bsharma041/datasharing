# TadaBoo Stockroom (source copy)

The live Stockroom is a Claude artifact: https://claude.ai/artifact/LaZN37L8DS7RDsbxhM9inG
Its data (items, bags, purchases, sales, adjustments, orders, settings) lives in the artifact's own
database, not in this repository. These files are a copy of the published code, kept here for review
and version history. Publish changes to the artifact with the Artifact tool (`url` = the link above,
`file_path` = `index.html`, `files` = `app.js`, and `calc.js` if changed).

## Local testing
On `localhost`, `app.js` swaps the real database for `devdb.js`, an in-browser test double seeded
from `seed.json` (a dump of the live data you build yourself; never commit it, it holds costs and
customer details). Serve this folder with `python3 -m http.server 8766` and open http://localhost:8766.

## Website orders (Orders tab)
Orders reach the owner in one of two ways, and both carry the same order code:
- **On the website** ("Place order"): the order goes to the WebsitePublisher order inbox (project 30289,
  form `tadaboo_order`, lead capture) with name, phone, delivery, address, items, total and
  `order_code`. The buyer can then pay by UPI (if `upi` is set in `catalog.js`). The Tadaboo agent reads
  new orders with `leads/get-leads`; the owner can also see them in the WebsitePublisher dashboard.
- **On WhatsApp** ("Order on WhatsApp instead"): a prefilled message.

1. Take the order text (the WhatsApp message, or the inbox entry's fields) — it ends with
   `Order code (please keep): TB1|<order id>|<lines>`; each line is
   `kind:stockroomId:qty:unitsPerQty:unitPrice` (`b` = gift bag `cat-<id>`, `i` = item; a box of 12
   pencils is `i:it-racing-pencils:1:12:109`).
2. Paste the message into **Orders → Add an order from WhatsApp → Read order → Save order** (status *New*).
3. Open it, set packaging (gift kits default to one per gift bag plus one for loose items), shipping
   charged and courier cost, then **Confirm order and update stock**. This writes a normal sale with id
   `web-<order id>`, so stock, profit and History update exactly as for a Sell-screen sale.
4. Move it through *Packed → Dispatched* (optional tracking) *→ Delivered*. **Cancel order** deletes its
   sale, which puts the stock back.
5. **Website stock file** saves `stock.json`; put it in `tadaboo/website/` so the site shows
   "Only N left" / "Sold out" and caps quantities. `scripts/sync_stock.py` builds the same file from a
   database dump.
