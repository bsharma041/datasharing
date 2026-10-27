# TadaBoo: business knowledge base

Last refreshed: 13 Oct 2026, from the TadaBoo Stockroom database and `Tadaboo_Catalogue.pdf` (2026 collection).
Numbers below are a snapshot. For anything current, re-read the Stockroom (see "Sources").

## 1. What TadaBoo is

- **Brand**: TadaBoo ("TADA✦BOO"). Tagline: *Little things that make you go TADA!* Catalogue title: *Welcome to TadaBoo Land!*
- **What we sell**: seriously cute stationery for children and young collectors (kawaii pens, novelty erasers and sharpeners, diaries, sticky notes), craft kits, squishies, and **curated gift bags**.
- **Customers**: parents buying for kids (school, birthdays, party return gifts), gift-givers, stationery collectors.
- **Market**: India. Prices in ₹. Launch: October 2026; no sales recorded yet in the Stockroom.
- **How people order**: on the website ("Place order": goes to the WebsitePublisher order inbox, then the buyer pays by UPI) or by call/WhatsApp on **97306 24700** (the website can also prefill a WhatsApp order). UPI payment is buyer-initiated; there is no payment gateway, so match each UPI credit to its order ID before packing.
- **Promise**: "You pick. We pack. TADA!" Every order goes in the original **white TadaBoo bag** with a TadaBoo sticker, the **thank-you card** and the **"Read. Dream. Imagine. Repeat!" bookmark**.

### Customer-facing rules (from the catalogue; do not change without the owner)
- **Custom bags**: selected items must total **more than ₹299**. Customers pay only for the items they choose.
- **Delivery** (owner decision, 27 Oct 2026, with the website redesign): every order ships, no pickup. **₹99, or ₹149 to the North East** (PIN codes 78, 79, 737), **free when items total ₹999 or more**. Checkout prices it from the PIN code and shows estimated arrival (7–10 days); the UPI amount includes it (`catalog.js` → `delivery`; the same numbers are in the hero, How to order, FAQ and policies). Basis: courier under ₹90 for 0.5 kg, about ₹300 for 2.5 kg (owner quote); two real orders on 27 Oct cost ₹159 and ₹355, so watch courier cost per sale in the Stockroom. UPI ID for website payments: `8415037227@axl` (`catalog.js` → `upi`, set 27 Oct 2026).
- **Dispatch**: bags are curated in small batches; allow **5–7 working days**.
- **Variation**: colours, characters or designs may vary with availability; product type and value stay the same.
- **Pencils**: Unicorn and Racing Car 2B pencils sell as a box of 12 for ₹109, or ₹15 per single pencil.

## 2. Brand system

| Token | Value | Use |
|---|---|---|
| Orange (TADA) | `#FF6B2C` | Wordmark "TADA" (italic), prices, primary buttons |
| Navy (BOO) | `#23264A` | Wordmark "BOO", headings, dark surfaces |
| Yellow star | `#FFC63A` | The ✦ between TADA and BOO |
| Teal | `#3FC1B6` | Eyebrow labels, "PICK" pill |
| Pastel panels | sky `#E6F2FC`, mint `#E5F6EC`, butter `#FFF4D2`, blush `#FFE8EE` | Card backgrounds, as in the catalogue |
| Fonts | Fredoka (display), Quicksand (body) | Shared by the website and the Stockroom |

Voice: warm, playful, short sentences, lots of "TADA!". Uppercase headings in the catalogue ("READY, SET... GIFT!", "THE LITTLE DETAILS MATTER!"). Pills: PICK · MIX · DISCOVER · GIFT.

## 3. Catalogue (50 products, 5 categories)

Full data with descriptions and Stockroom ids: `tadaboo/website/catalog.js`. Photos: `tadaboo/website/img/<id>.webp`.

| Category | Products | Price range |
|---|---|---|
| Pens & Highlighters | 11 | ₹20–₹129 |
| Pencils, Notebooks & Notes | 10 | ₹50–₹149 |
| Sharpeners & Erasers | 16 | ₹20–₹99 |
| Make & Create | 7 | ₹70–₹199 |
| Gift Sets & Squishy Fun | 6 | ₹99–₹299 |

### Gift collections (12, catalogue pp. 7–9)

Each collection is priced at exactly the sum of its items' catalogue prices (no bundle discount).
Packaging per order is about **₹37.4** (paper bag ₹22.4 average landed + sticker ₹5 + thank-you card ₹5 + bookmark ₹5).

**Shipping boxes** (delivered orders only; added to the Stockroom 26 Oct 2026 as packaging items, costs not yet known). Courier: Shiprocket or Delhivery (not decided). They bill the higher of actual weight and volumetric weight (L×B×H cm ÷ 5000, assumed), in 0.5 kg steps; confirm divisor and rounding with the chosen courier.

| Stockroom item | Size (in) | Holds | Volumetric weight |
|---|---|---|---|
| `pk-box-small` | 7.5 × 4.5 × 3.5 | 1–2 bags | 0.39 kg → 0.5 kg |
| `pk-box-medium` | 9 × 8.5 × 4 | up to 10 bags | 1.003 kg → may bill 1.5 kg; a 3.5–3.9 in height keeps it at 1 kg |
| `pk-box-large` | 13 × 10.5 × 5.5 | up to 20 bags (items kept separate, white bags packed flat alongside) | 2.46 kg → 2.5 kg, or actual weight if heavier |

A fourth size may be added if orders need it. Bubble wrap and tape are still to be costed (per box: up to ~0.10 / 0.19 / 0.34 m² of wrap; ~0.6 / 0.7 / 0.9 m of tape). Planned one-off cost: receipt printer ₹3,000 (fixed cost, not per order; record it under Stockroom → More → Fixed costs once paid).

| Collection | Price | Item cost | Gross profit after packaging | Margin | Max bags from stock* | Limiting item |
|---|---|---|---|---|---|---|
| Back to School · Starter | ₹199 | ₹85 | ₹77 | 39% | 10 | 2B pencil boxes |
| Back to School · Plus | ₹359 | ₹147 | ₹174 | 49% | 3 | 12 Pcs Pencil Gift Set |
| Make & Create | ₹497 | ₹218 | ₹242 | 49% | 4 | 6-in-1 Stationery Set |
| Vroom Vroom · Boys | ₹249 | ₹112 | ₹100 | 40% | 10 | Racing Car pencil boxes |
| Space Cadet · Boys | ₹399 | ₹181 | ₹180 | 45% | 10 | Magnetic Bookmark Set |
| Kuromi Kawaii · Girls | ₹259 | ₹105 | ₹117 | 45% | 10 | Magnetic Bookmark Set |
| Unicorn Sparkle · Girls | ₹399 | ₹167 | ₹194 | 49% | 12 | several (12 each) |
| Return Gift · Mini | ₹199 | ₹84 | ₹78 | 39% | 4 | Cute Crayons Set |
| Return Gift · Classic | ₹349 | ₹148 | ₹164 | 47% | 4 | Cute Crayons Set |
| Return Gift · Deluxe | ₹499 | ₹255 | ₹207 | 41% | 10 | Magnetic Bookmark Set |
| Birthday Hamper · Boys | ₹999 | ₹470 | ₹491 | 49% | 4 | 3-in-1 Activity Set |
| Birthday Hamper · Girls | ₹999 | ₹505 | ₹456 | 46% | 3 | 7 Pcs Aesthetic Set |

\*Upper bound: units purchased ÷ units per bag. Each item is counted for every bag independently, so bags that share items (e.g. A7 notebook, Labubu pen, magnetic bookmarks) compete for the same stock. Delivery/courier cost is not included.

## 4. Unit economics (landed cost = purchase price + share of GST, shipping, other)

- **Median item margin** at catalogue price: **~56%**.
- **Thinnest margins**: Chocolate Bar Squishy 35%, 7 Pcs Aesthetic Set 42%, Dumpling Bun Squishy 43%, Butterfly Pen 49%, 2-in-1 Sharpener + Eraser 49%, 6-in-1 Set 50%.
- **Richest margins**: 2B pencils (~56% per box at ₹109; 74% as singles at ₹15), Plane Sharpener 67%, Rabbit Eraser 66%, Clipboard Diary 65%, Shuttlecock Sharpener 65%, Diamond Bracelet Kit 63%.
- **Packaging in product cost** (owner's choice, 26 Oct 2026): packaging is costed when used, at its cost per piece, inside the item cost of the sale it went with (no separate packaging line, never charged to customers). Unused packaging stays in stock, so bulk packaging purchases don't move margins. Gift-bag margins include one gift kit (≈₹37.4: paper bag + sticker + card + bookmark). A spread-by-value method was tried and dropped because the share jumped with each packaging purchase.
- **Packaging drag**: ₹37.4 per order is 19% of a ₹199 bag but under 4% of a ₹999 hamper. Low-ticket bags carry the lowest margins (39–40%).
- **Stock on hand** (catalogue products, purchases only): ~₹25,800 at landed cost, ~₹57,900 at catalogue prices.

## 5. Suppliers and purchases to date (₹33,989 total)

| Date | Supplier | Value | Notes |
|---|---|---|---|
| 22 Sep 2026 | PaperZen | ₹4,555 | First order, via Amazon. Owner note: ₹710 gap vs quote, probably delivery; to check. |
| 23 Sep 2026 | 91Supplies | ₹8,549 | Invoice 3988. Gel pen boxes assumed 12 pens/box. |
| 30 Sep 2026 | Trendy | ₹8,186 | Estimate/memo #1866 (salesman Sanya); paid by A/C transfer. Wholesale novelty pens, sharpeners, erasers, stamps, bookmarks. |
| 5 Oct 2026 | 91Supplies | ₹4,899 | Invoice 4209. Squishies, bath bombs, sticky notes. |
| 9 Oct 2026 | Pixel Prints | ₹7,600 | Packaging: 205 paper bags, 200 thank-you cards, 200 stickers, 200 bookmarks. |
| 13 Oct 2026 | Amazon | ₹200 | ChibiCharm sticky notes (8), not yet in the catalogue. |

Payment methods seen: ICICI debit card, Amazon credit card, account transfer.

## 6. Systems

| System | Where | What it does |
|---|---|---|
| **TadaBoo Stockroom** | https://claude.ai/artifact/LaZN37L8DS7RDsbxhM9inG | Inventory, purchases (landed cost), sales, gift-bag recipes, packaging kits, profit. Shared database collections: `items`, `bags`, `purchases`, `sales`, `adjustments`, `settings/main`. Stock and cost are derived from the ledger (see its `calc.js`). |
| **Website orders** | WebsitePublisher order inbox (project 30289, form `tadaboo_order`) + Stockroom → Orders tab | Website orders land in the inbox; WhatsApp orders arrive as messages. Both carry an order code: paste it in the Orders tab; confirming records sale `web-<order id>`, so stock and profit update. Statuses New → Confirmed → Packed → Dispatched → Delivered, or Cancelled (stock put back). Exports `stock.json` for the website. See `tadaboo/stockroom/README.md`. |
| **Website** | `tadaboo/website/` (live on Cloudflare Pages: tadaboo-shop.pages.dev, production branch `claude/peaceful-keller-9qmlbg`, output dir `tadaboo/website`; domain www.tadaboo.com to be connected) | Customer storefront: gift collections, gift finder, shop, custom-bag builder with ₹299 meter, checkout on the site (order inbox + UPI) or on WhatsApp. Static files; deploy anywhere. |
| **Catalogue PDF** | owner's files | Customer-facing source of truth for products, prices, collections, policies. |
| **Website design draft** | claude.ai/design project "TadaBoo Store" | Needs `/design-login` or "Send to Claude Code" to be read by an agent. |

### Stockroom data model (key fields)
- `items/{id}`: `name`, `type` (product | packaging), `category`, `sellPrice`, `lowAt`, `costOverride`, `supplier`, `note`, `archived`.
- `purchases/{id}`: `date`, `supplier`, `ref`, `lines[{itemId, qty, unitPrice}]`, `extras{gst, shipping, other}`, `note`.
- `sales/{id}`: `date`, `kind` (items | bag | custom), `lines[{itemId|bagId, qty, price}]`, `consumed[{itemId, qty, cost}]`, `packaging{pieces[]}`, `shippingCharged`, `courierCost`.
- `bags/{id}`: `name`, `price`, `contents[{itemId, qty}]`.
- `expenses/{id}`: one-time fixed costs (`date`, `label`, `amount`, `note`, `createdAt`), e.g. the receipt printer. Not per order; shown on Home as profit after fixed costs and how much is paid back.
- `settings/main`: `giftKit`, `pouchKit`, `lowProduct` (5), `lowPackaging` (10), `threshold` (gift vs pouch order value; not set).

## 7. Open issues and data gaps (as of 13 Oct 2026)

1. ~~Stockroom gift bags out of date~~ **Resolved 13 Oct 2026:** the Stockroom now holds the 12 catalogue collections (ids `cat-<bag id>`, pencil boxes counted as 12 units); the 9 older bags (Aesthetic Bloom, Aesthetic Muse, Back to School ₹549, Fun Explorer, K-Style Cutie, Make & Create ₹499, Mini Surprise, Snoopy & Friends, Sweet Treats) are archived, not deleted.
2. **Pencil units.** The Stockroom tracks 2B pencils as single pencils (₹15, 120 each in stock); the catalogue sells boxes of 12 at ₹109. A box sale must consume 12 units.
3. ~~Bookmark not in the gift kit~~ **Resolved 26 Oct 2026:** the gift kit is paper bag + sticker + thank-you card + bookmark (≈₹37.4). **Plastic pouch stock is −7:** used in 7 sales but never purchased, so those sales carry ₹0 pouch cost; record a pouch purchase (or an opening count) to fix.
4. **Return-gift capacity.** Return Gift Mini and Classic can make only 4 bags each (Cute Crayons Set: 4 in stock). Party orders usually need 10–20 identical bags.
5. **No sales recorded yet**, so stock figures are units purchased.
6. **Uncategorised items** in the Stockroom: bath bomb, dumpling squishy, chocolate squishy (no category); fountain pen and pop-up pens under "Trendy (to classify)".
7. **Not in the catalogue**: ChibiCharm Sticky Notes (no price), Pineapple Paper Cutter (archived).
8. **Unverified counts**: gel pens assumed 12 per box; PaperZen ₹710 gap; Helmet vs Cold Drink Can sharpener on the 91Supplies sheet.
9. ~~Delivery pricing not defined~~ **Resolved 27 Oct 2026:** see §1 (₹99 / ₹149 North East / free from ₹999). The Stockroom fills "Shipping charged" from the order text (editable); its fallback rule is `DELIVERY` in `tadaboo/stockroom/app.js`, keep it in step with `catalog.js`.
10. **Low-stock threshold** for gift vs pouch packaging (`settings.threshold`) is not set.
