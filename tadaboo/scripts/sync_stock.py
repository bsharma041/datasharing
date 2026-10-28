"""Build tadaboo/website/stock.json (what the website may sell, at what price, and the best sellers)
from a Stockroom database dump.

Usage:
    python3 sync_stock.py <dump_dir> [<out.json>]

<dump_dir> holds items/, bags/, purchases/, sales/, adjustments/, offers/ and reviews/ folders of JSON documents,
as written by ArtifactData(action="list", out_dir=...). Stock follows the Stockroom's calc.js:
purchases + adjustments - items consumed by sales - packaging used by sales. Bag capacity is how
many of each (non-archived) bag current stock can make.

The Stockroom's Orders tab can produce the same file with "Website stock file".
"""
import glob
import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def load(root, coll):
    rows = []
    for f in sorted(glob.glob(f"{root}/{coll}/*.json")):
        d = json.load(open(f))
        x = dict(d.get("data", d))
        x["id"] = os.path.basename(f)[:-5]
        rows.append(x)
    return rows


def expand_sale(sale, bags_by_id):
    out = {}
    for l in sale.get("lines") or []:
        if l.get("bagId"):
            for c in (bags_by_id.get(l["bagId"]) or {}).get("contents") or []:
                out[c["itemId"]] = out.get(c["itemId"], 0) + num(c.get("qty")) * num(l.get("qty"))
        elif l.get("itemId"):
            out[l["itemId"]] = out.get(l["itemId"], 0) + num(l.get("qty"))
    return [{"itemId": k, "qty": v} for k, v in out.items()]


def main(root, out):
    items, bags = load(root, "items"), load(root, "bags")
    purchases, sales, adjustments = load(root, "purchases"), load(root, "sales"), load(root, "adjustments")
    bags_by_id = {b["id"]: b for b in bags}
    stock = {i["id"]: 0.0 for i in items}
    for p in purchases:
        for l in p.get("lines") or []:
            stock[l["itemId"]] = stock.get(l["itemId"], 0) + num(l.get("qty"))
    for a in adjustments:
        stock[a.get("itemId")] = stock.get(a.get("itemId"), 0) + num(a.get("qty"))
    for s in sales:
        consumed = s["consumed"] if isinstance(s.get("consumed"), list) else expand_sale(s, bags_by_id)
        for c in consumed:
            stock[c["itemId"]] = stock.get(c["itemId"], 0) - num(c.get("qty"))
        for pc in (s.get("packaging") or {}).get("pieces") or []:
            stock[pc["itemId"]] = stock.get(pc["itemId"], 0) - num(pc.get("qty"))

    archived = {i["id"] for i in items if i.get("archived")}
    item_stock = {k: max(0, int(v)) for k, v in sorted(stock.items()) if k and k not in archived}
    bag_cap = {}
    for b in bags:
        if b.get("archived"):
            continue
        caps = [math.floor(max(0, stock.get(c["itemId"], 0)) / max(1, num(c.get("qty"))))
                if c["itemId"] not in archived else 0 for c in b.get("contents") or []]
        bag_cap[b["id"]] = min(caps) if caps else 0

    # Selling prices (the website uses them, except for products marked fixedPrice in catalog.js),
    # and the items and bags the owner switched on as "Best seller on the website".
    def price(v):
        try:
            v = float(v)
        except (TypeError, ValueError):
            return None
        return int(v) if v == int(v) else v
    prices = {i["id"]: price(i.get("sellPrice")) for i in items
              if i["id"] not in archived and i.get("type", "product") == "product" and (price(i.get("sellPrice")) or 0) > 0}
    bag_prices = {b["id"]: price(b.get("price")) for b in bags if not b.get("archived") and (price(b.get("price")) or 0) > 0}
    best = sorted([i["id"] for i in items if i.get("best") and i["id"] not in archived] +
                  [b["id"] for b in bags if b.get("best") and not b.get("archived")])

    # Website-only sale prices (must be below the normal price) and occasion offers that are on and not over.
    sale = {}
    for x, base in [(i, i.get("sellPrice")) for i in items if i["id"] not in archived] + [(b, b.get("price")) for b in bags if not b.get("archived")]:
        sp, bp = price(x.get("salePrice")), price(base)
        if sp and bp and 0 < sp < bp:
            sale[x["id"]] = sp
    today = datetime.now(timezone(timedelta(hours=5, minutes=30))).strftime("%Y-%m-%d")  # India time
    offers = [{"name": str(o.get("name") or ""), "pct": price(o.get("pct")), "scope": o.get("scope") or "all",
               "from": str(o.get("from") or ""), "to": str(o.get("to") or "")}
              for o in load(root, "offers") if o.get("on") and (price(o.get("pct")) or 0) > 0 and str(o.get("to") or "") >= today]

    data = {"asOf": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "items": item_stock, "bags": bag_cap,
            "prices": prices, "bagPrices": bag_prices, "best": best, "sale": sale, "offers": offers}
    # Units in stock per Stockroom item id, how many of each gift bag can be packed, prices and best sellers.
    with open(out, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    # Reviews the owner marked "Show on website" and that have the customer's consent.
    reviews = [{"name": str(r.get("name") or "")[:60], "city": str(r.get("city") or "")[:40], "quote": str(r.get("quote") or "")[:320],
                "bought": str(r.get("bought") or ""), "rating": price(r.get("rating")), "photo": str(r.get("photo") or "") if str(r.get("photo") or "").startswith("data:image/") else ""}
               for r in sorted(load(root, "reviews"), key=lambda r: str(r.get("createdAt") or ""), reverse=True)
               if r.get("show") and r.get("consent") and str(r.get("quote") or "").strip()]
    with open(os.path.join(os.path.dirname(out), "reviews.json"), "w") as f:
        json.dump({"asOf": data["asOf"], "reviews": reviews}, f, separators=(",", ":"))
    print(f"wrote {out}: {len(item_stock)} items, {len(bag_cap)} bags, {len(prices)} prices, {len(best)} best sellers, {len(sale)} on sale, {len(offers)} offers, {len(reviews)} reviews")


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, "..", "website", "stock.json"))
