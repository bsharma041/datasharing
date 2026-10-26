// TadaBoo calculation core. Pure functions only: no DOM, no db.
// Stock and average cost are derived from the event ledger
// (purchases, sales, adjustments), never stored as counters.

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);

/** Per-unit landed cost for each purchase line: unit price plus its share of extras.
 *  Extras are spread by line value, or by quantity when the order value is 0. */
export function landedLines(purchase) {
  const lines = purchase?.lines || [];
  const ex = purchase?.extras || {};
  const extras = num(ex.gst) + num(ex.shipping) + num(ex.other);
  const value = sum(lines, (l) => num(l.qty) * num(l.unitPrice));
  const qtyTotal = sum(lines, (l) => num(l.qty));
  return lines.map((l) => {
    const qty = num(l.qty);
    const lineValue = qty * num(l.unitPrice);
    const share = value > 0 ? lineValue / value : qtyTotal > 0 ? qty / qtyTotal : 0;
    const landed = qty > 0 ? num(l.unitPrice) + (share * extras) / qty : num(l.unitPrice);
    return { itemId: l.itemId, qty, unitPrice: num(l.unitPrice), landed };
  });
}

/** Weighted-average landed cost per item. costOverride is used only for items never
 *  bought, so a typed cost can't hide GST/shipping. null when unknown
 *  (so sales never freeze a made-up ₹0 into their cost snapshot). */
export function avgCosts(items, purchases) {
  const qty = {}, val = {};
  for (const p of purchases || []) {
    for (const l of landedLines(p)) {
      qty[l.itemId] = (qty[l.itemId] || 0) + l.qty;
      val[l.itemId] = (val[l.itemId] || 0) + l.qty * l.landed;
    }
  }
  const out = {};
  for (const id of Object.keys(qty)) out[id] = qty[id] > 0 ? val[id] / qty[id] : null;
  for (const it of items || []) {
    if (out[it.id] != null) continue;
    out[it.id] = it.costOverride != null && it.costOverride !== '' ? num(it.costOverride) : null;
  }
  return out;
}

/** Item quantities a sale takes out of stock (bags expanded into contents). */
export function expandSale(sale, bags) {
  const bagById = Object.fromEntries((bags || []).map((b) => [b.id, b]));
  const acc = new Map();
  const add = (id, q) => acc.set(id, (acc.get(id) || 0) + q);
  for (const l of sale?.lines || []) {
    if (l.bagId) {
      for (const c of bagById[l.bagId]?.contents || []) add(c.itemId, num(c.qty) * num(l.qty));
    } else if (l.itemId) add(l.itemId, num(l.qty));
  }
  return [...acc].map(([itemId, qty]) => ({ itemId, qty }));
}

const consumedOf = (sale, bags) => (Array.isArray(sale?.consumed) ? sale.consumed : expandSale(sale, bags));

/** Current stock per item = purchases + adjustments − sold items − packaging used. */
export function stockLevels(items, purchases, sales, adjustments, bags) {
  const s = {};
  for (const it of items || []) s[it.id] = 0;
  const add = (id, q) => { s[id] = (s[id] || 0) + num(q); };
  for (const p of purchases || []) for (const l of p.lines || []) add(l.itemId, l.qty);
  for (const a of adjustments || []) add(a.itemId, a.qty);
  for (const sale of sales || []) {
    for (const c of consumedOf(sale, bags)) add(c.itemId, -num(c.qty));
    for (const pc of sale.packaging?.pieces || []) add(pc.itemId, -num(pc.qty));
  }
  return s;
}

/** Money for one sale. Cost snapshots on the sale win; else current avg costs.
 *  packIn: the packaging ticked on the sale (at its cost per piece) is built into item cost, so packCost is 0
 *  and packShare is the part of itemCost that is packaging. Otherwise packaging is its own cost line. */
export function saleTotals(sale, costs, bags, packIn = false) {
  const c = costs || {};
  const lineRevenue = sum(sale?.lines || [], (l) => num(l.price));
  const revenue = lineRevenue + num(sale?.shippingCharged);
  const itemCost = sum(consumedOf(sale, bags), (x) => num(x.qty) * (x.cost != null ? num(x.cost) : num(c[x.itemId])));
  const packCost = sum(sale?.packaging?.pieces || [], (x) => num(x.qty) * (x.cost != null ? num(x.cost) : num(c[x.itemId])));
  const courier = num(sale?.courierCost);
  if (packIn) return { revenue, itemCost: itemCost + packCost, packCost: 0, packShare: packCost, courier, profit: revenue - itemCost - packCost - courier };
  return { revenue, itemCost, packCost, packShare: 0, courier, profit: revenue - itemCost - packCost - courier };
}

/** Totals over sales whose date falls in [from, to] (inclusive, either optional). */
export function summary(sales, costs, bags, range = {}, packIn = false) {
  const t = { revenue: 0, itemCost: 0, packCost: 0, packShare: 0, courier: 0, profit: 0, orders: 0 };
  for (const s of sales || []) {
    if ((range.from || range.to) && !s.date) continue; // undated: all-time only
    if (range.from && s.date < range.from) continue;
    if (range.to && s.date > range.to) continue;
    const x = saleTotals(s, costs, bags, packIn);
    for (const k of ['revenue', 'itemCost', 'packCost', 'packShare', 'courier', 'profit']) t[k] += x[k];
    t.orders++;
  }
  t.margin = t.revenue > 0 ? t.profit / t.revenue : 0;
  return t;
}

export function status(stock, lowAt) {
  if (num(stock) <= 0) return 'out';
  if (num(stock) <= num(lowAt)) return 'low';
  return 'ok';
}

/** How many of a bag can be made from current stock, and what limits it. */
export function bagCapacity(bag, stock, itemsById) {
  let count = Infinity, limitingItemId = null;
  const missing = [];
  for (const c of bag?.contents || []) {
    const it = itemsById?.[c.itemId];
    if (!it || it.archived) missing.push(c.itemId);
    const can = !it || it.archived ? 0 : Math.floor(Math.max(0, num(stock?.[c.itemId])) / Math.max(1, num(c.qty)));
    if (can < count) { count = can; limitingItemId = c.itemId; }
  }
  if (count === Infinity) count = 0;
  return { count, limitingItemId, missing };
}

export function kitPieces(kit, costs) {
  return (kit || []).map((k) => ({ itemId: k.itemId, qty: num(k.qty), cost: costs?.[k.itemId] ?? null }));
}

export function suggestPackaging(orderValue, threshold) {
  if (threshold == null || threshold === '' || !Number.isFinite(+threshold)) return 'none';
  return num(orderValue) >= +threshold ? 'gift' : 'pouch';
}

export function inr(n, decimals = 0) {
  const v = num(n);
  const s = Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (v < 0 ? '-₹' : '₹') + s;
}
