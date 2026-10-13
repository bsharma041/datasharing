"""Build tadaboo/knowledge/snapshot.json from a dump of the TadaBoo Stockroom database.

Usage:
    python3 build_snapshot.py <dump_dir> <out.json>

<dump_dir> holds one folder per collection (items/, bags/, purchases/), each with
one JSON file per document, as written by ArtifactData(action="list", out_dir=...).

Landed cost follows the Stockroom's calc.js: each purchase's GST + shipping + other
extras are spread over its lines by line value, then averaged per item by quantity.
Stock here is units purchased only (sales and adjustments are not in the dump).
"""
import glob
import json
import os
import sys


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


def main(root, out):
    items, bags, purs = load(root, "items"), load(root, "bags"), load(root, "purchases")

    qty, val = {}, {}
    for p in purs:
        lines = p["lines"]
        ex = p.get("extras", {})
        extras = sum(num(ex.get(k)) for k in ("gst", "shipping", "other"))
        value = sum(num(l["qty"]) * num(l["unitPrice"]) for l in lines)
        qty_total = sum(num(l["qty"]) for l in lines)
        for l in lines:
            q = num(l["qty"])
            share = (q * num(l["unitPrice"])) / value if value else (q / qty_total if qty_total else 0)
            landed = num(l["unitPrice"]) + (share * extras / q if q else 0)
            qty[l["itemId"]] = qty.get(l["itemId"], 0) + q
            val[l["itemId"]] = val.get(l["itemId"], 0) + q * landed

    def cost(i):
        return val[i] / qty[i] if qty.get(i) else None

    by_id = {i["id"]: i for i in items}
    rows = []
    for i in items:
        c, sp = cost(i["id"]), i.get("sellPrice")
        rows.append(dict(
            id=i["id"], name=i["name"], type=i.get("type"), category=i.get("category") or "",
            supplier=i.get("supplier") or "", sell=sp,
            landed=round(c, 2) if c else None, stock=int(qty.get(i["id"], 0)),
            margin=round((sp - c) / sp * 100, 1) if sp and c else None,
            archived=bool(i.get("archived")), note=i.get("note", ""),
        ))

    bag_rows = []
    for b in bags:
        item_cost = sum((cost(c["itemId"]) or 0) * c["qty"] for c in b["contents"])
        parts = sum(num(by_id[c["itemId"]].get("sellPrice")) * c["qty"] for c in b["contents"])
        cap = min(int(qty.get(c["itemId"], 0) // c["qty"]) for c in b["contents"])
        bag_rows.append(dict(
            id=b["id"], name=b["name"], price=b["price"],
            contents=[by_id[c["itemId"]]["name"] for c in b["contents"]],
            itemIds=[c["itemId"] for c in b["contents"]],
            itemCost=round(item_cost, 1), sumOfParts=parts,
            margin=round((b["price"] - item_cost) / b["price"] * 100, 1), capacity=cap,
        ))

    def total(p):
        return sum(num(l["qty"]) * num(l["unitPrice"]) for l in p["lines"]) + sum(num(v) for v in p.get("extras", {}).values())

    json.dump(dict(
        items=rows, bags=bag_rows,
        purchases=[dict(date=p["date"], supplier=p["supplier"], ref=p.get("ref"), lines=len(p["lines"]),
                        value=round(total(p), 2), note=p.get("note", "")) for p in purs],
        totalSpend=round(sum(total(p) for p in purs), 2),
    ), open(out, "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
