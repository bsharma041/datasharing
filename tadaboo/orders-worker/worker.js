// TadaBoo order inbox: a small Cloudflare Worker with KV storage.
//
//   POST /order                 public, from www.tadaboo.com: { fields: {...} } → stores the order as "new"
//   GET  /orders?status=new     owner only (Authorization: Bearer <ADMIN_TOKEN>) → { data: [order, ...] }
//   POST /orders/<id>/status    owner only, { status: "won" | "rejected" | "new" }
//   POST /hit                   public, from www.tadaboo.com: { new, src, land } → adds one visit to today's count
//                               (src = where the visitor came from, land = kind of page; see SRC and LAND)
//   GET  /views?days=30         owner only → { days: { "2026-10-29": { visits, new }, ... } } (dates in India time)
//   POST /pay/create            public, from www.tadaboo.com: { order_id } → a Razorpay order for that stored order's total
//   POST /pay/verify            public, from www.tadaboo.com: Checkout's { order_id, razorpay_* } → marks the order paid
//   POST /pay/webhook           from Razorpay (signed): payment.captured / order.paid → marks the order paid
//   POST /order/cancel          public, from www.tadaboo.com: { order_id, key, confirm } → the buyer cancels their own
//                               order (only while it is still "new") and every payment on it is refunded in full
//   POST /orders/<id>/refund    owner only → tries again to refund a buyer-cancelled order (after a refund failed)
//
// Razorpay: var RAZORPAY_KEY_ID (wrangler.toml, public), secrets RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET.
// The amount charged is the total stored with the order when it was placed, never a number sent with /pay/create.
// A paid order carries `payment: { status: "paid", id, amount (₹), via, at }`. The site works the total out in
// the buyer's browser, so /order checks it adds up (items in the order code + a known delivery charge) and
// /pay/create refuses an order that doesn't (`check`). It also checks each unit price against the shop's
// own prices (priceCheck): no line may be cheaper than the lowest price that item can have today. A second payment for an already-paid order is
// kept in `extra_payments` (to refund), never written over the first.
// Online payment is only offered for orders placed after it went live (PAY_SINCE) and for PAY_HOURS after.
//
// Buyer cancel: when placing an order the page makes a random 256-bit key, keeps it on the buyer's phone and
// sends only its SHA-256 (`cancel_hash`, stored outside `fields`, so it never reaches WebsitePublisher or the
// Stockroom). /order/cancel needs the key itself, so knowing an order ID is not enough. It works only while the
// order's status is "new" (the owner hasn't confirmed it) and for CANCEL_HOURS (2) after it was placed. The order is marked rejected with
// `cancel: { by: "buyer", at }` before any refund, so it can't be paid again. Refunds: each captured payment on
// the order is fetched from Razorpay and refunded for what Razorpay says is still unrefunded, to the original
// method (Razorpay never refunds anywhere else). Nothing the buyer sends decides an amount, and a payment counts
// only if it is on the order's own Razorpay order (never by its notes, which the browser sets). A payment that
// lands after the cancel (Checkout left open) is refunded the same way when it is recorded. Figures written back
// (`refunded_total`, `refund_pending`, `awaiting_capture`) are always Razorpay's latest. The cancel, the Razorpay
// order and each payment also live in their own write-once KV keys (see loadOrder), so no later write can undo them.
// setStatus refuses to move a buyer-cancelled order on (409 cancelledByBuyer) unless told { override: true }.
//
// Visits: the site sends one hit per browser session (sessionStorage), `new` on the first visit from that device
// (localStorage). Nothing about the visitor is stored (no IP, no cookie): only a count per day.
//
// An order is { id, form_name: "tadaboo_order", status, created_at, fields }: the same shape as the
// WebsitePublisher lead it replaces, so tadaboo/scripts/import_orders.mjs reads it unchanged.
// Bindings (wrangler.toml): KV namespace ORDERS; secret ADMIN_TOKEN. Local testing only: DEV_ORIGIN in .dev.vars.
//
// Live copy for the Stockroom: with secret WP_KEY (a WebsitePublisher project key, wpa_…, project 30289) set,
// each NEW order is also filed in WebsitePublisher's lead capture (form tadaboo_order), in the background.
// The Stockroom reads those leads through the owner's WebsitePublisher connector while it is open, so a
// website order shows up there within a minute. The order is stored here first either way; the copy's result
// is kept as KV copy:<id> ("ok" or "failed: …", shown as `copy` in /orders) and the hourly task still imports from this inbox.

const ALLOWED_ORIGINS = ['https://www.tadaboo.com', 'https://tadaboo.com', 'https://tadaboo-shop.pages.dev'];
const REQUIRED = ['order_id', 'name', 'phone', 'address', 'pincode', 'items', 'total', 'order_code'];
const MAX_FIELD = 4000, MAX_BODY = 20000, PER_IP_PER_HOUR = 10;
const STATUSES = ['new', 'won', 'rejected'];
// One KV write per visit (Cloudflare's free plan allows 1,000 writes a day in all).
const VIEW_TTL = 400 * 86400;
// Labels website/visit.js may send with a visit. Anything else is counted as 'unknown'.
const SRC = ['direct', 'google', 'instagram', 'whatsapp', 'facebook', 'youtube', 'search', 'ai', 'share', 'campaign', 'other'];
const LAND = ['home', 'product', 'bag', 'guide', 'other'];
const label = (v, list) => (list.includes(v) ? v : 'unknown');
const istDate = (t = Date.now()) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);
const WP = { url: 'https://api.websitepublisher.ai/iapi/project/30289/leads/submit-lead', form: 'tadaboo_order' };

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

const cors = (origin, env = {}) => (ALLOWED_ORIGINS.includes(origin) || (env.DEV_ORIGIN && origin === env.DEV_ORIGIN) || /^https:\/\/[a-z0-9-]+\.tadaboo-shop\.pages\.dev$/.test(origin)
  ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'Origin' }
  : null);

// Constant-time compare for the owner token.
const sameSecret = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
};
const isOwner = (req, env) => sameSecret((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), env.ADMIN_TOKEN);

// ---- Razorpay ----
const RZP = 'https://api.razorpay.com/v1';
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
}
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const payReady = (env) => !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
const ORDER_ID = /^TB-\d{6}-[A-Z0-9]{4}$/;
const PAY_SINCE = Date.parse('2026-11-21T08:57:55Z'), PAY_HOURS = 48;
// Delivery charge by PIN code (catalog.js delivery: remote prefixes pay 149, the rest 99; free from FREE_ABOVE in items).
const REMOTE_PIN = ['78', '79', '737'], FEE = { india: 99, remote: 149 }, FREE_ABOVE = 999;
const feeFor = (pin) => (REMOTE_PIN.some((p) => String(pin || '').trim().startsWith(p)) ? FEE.remote : FEE.india);
const NUM = /^\d{1,6}(\.\d{1,2})?$/;
// Does the total add up? Items from the order code (kind:id:qty:units:unitPrice, …) plus a known delivery charge.
// Minimum order: items (gift bags included, delivery excluded) must total at least this. Same as minOrder in catalog.js.
const MIN_ORDER = 299;
function totalCheck(f) {
  const lines = String(f.order_code || '').split('|')[2] || '';
  let items = 0;
  for (const l of lines.split(',')) {
    const p = l.split(':'), n = Number(p[2]), price = Number(p[4]);
    if (p.length !== 5 || !/^[bi]$/.test(p[0]) || !/^\d{1,4}$/.test(p[2]) || !/^\d{1,3}$/.test(p[3]) || !NUM.test(p[4]) || n < 1) return 'bad order code';
    items += n * price;
  }
  const total = Number(f.total), fee = Math.round((total - items) * 100) / 100;
  if (!NUM.test(String(f.total).trim()) || items <= 0) return 'bad total';
  if (items < MIN_ORDER) return `items ₹${items} below the ₹${MIN_ORDER} minimum order`;
  const want = items >= FREE_ABOVE ? 0 : feeFor(f.pincode);
  if (fee !== want) return `total ${total} doesn't match items ${items} + delivery ${want}`;
  return '';
}

// The lowest price each item can legitimately have right now, worked out from the live site's files the same
// way index.html does (applyStock + applyDiscounts): Stockroom price (stock.json prices/bagPrices) unless the
// catalogue price is fixed (website/prices.json, made by prerender.mjs), then a Stockroom sale price, then any
// occasion offer. Offers count from a day before `from` to a day after `to`, for buyers on either side of
// midnight. A floor, not an exact match: tampering only ever lowers a price, and a sale starting or ending
// mid-checkout must not block an honest buyer. If index.html's pricing rules change, change this too.
const SITE = 'https://www.tadaboo.com';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const shiftDay = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
async function siteJson(f) {
  const r = await fetch(`${SITE}/${f}`, { cf: { cacheTtl: 0 }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
  const j = await r.json();
  if (!isObj(j)) throw new Error(`${f}: not an object`);
  return j;
}
// A tab opened before the daily Stockroom publish still charges yesterday's prices. So the worker keeps the
// stock.json it saw before the latest one (KV stock:seen) and, for PREV_HOURS after a change, accepts either.
const PREV_HOURS = 48;
async function stockVersions(env, stock) {
  const pick = (x) => ({ asOf: String(x.asOf || ''), prices: x.prices, bagPrices: x.bagPrices, sale: x.sale, offers: x.offers });
  const cur = pick(stock);
  let seen = null; try { seen = await env.ORDERS.get('stock:seen', 'json'); } catch { /* use today's only */ }
  if (!seen?.cur) { try { await env.ORDERS.put('stock:seen', JSON.stringify({ cur, prev: null, changed: 0 })); } catch {} return [cur]; }
  if (seen.cur.asOf !== cur.asOf && cur.asOf) {
    seen = { cur, prev: seen.cur, changed: Date.now() };
    try { await env.ORDERS.put('stock:seen', JSON.stringify(seen)); } catch { /* next order retries */ }
  }
  return seen.prev && Date.now() - seen.changed < PREV_HOURS * 3600e3 ? [cur, seen.prev] : [cur];
}
async function priceCheck(f, env) {
  let cat, stock;
  try { [cat, stock] = await Promise.all([siteJson('prices.json'), siteJson('stock.json')]); }
  catch (e) { return { skipped: String(e?.message || e).slice(0, 80) }; }      // site unreachable: don't block the order
  try {
    const today = istDate();
    const floorsFrom = (st) => {
      const pr = isObj(st.prices) ? st.prices : {}, bp = isObj(st.bagPrices) ? st.bagPrices : {}, sale = isObj(st.sale) ? st.sale : {};
      const offers = (Array.isArray(st.offers) ? st.offers : []).filter((o) => isObj(o) && o.pct > 0 && o.pct < 90
        && DAY.test(String(o.from)) && DAY.test(String(o.to)) && shiftDay(o.from, -1) <= today && today <= shiftDay(o.to, 1));
      const floorOf = (base, saleV, isBag) => {
        let low = base;
        if (Number.isFinite(saleV) && saleV > 0 && saleV < low) low = saleV;
        for (const o of offers) if (o.scope === 'all' || o.scope === (isBag ? 'bags' : 'items')) low = Math.min(low, Math.round(base * (1 - o.pct / 100)));
        return low;
      };
      return (kind, id) => {
        if (kind === 'b') { const c = cat.bags?.[id]; return Number.isFinite(c) ? floorOf(Number.isFinite(bp[id]) && bp[id] > 0 ? bp[id] : c, sale[id], true) : NaN; }
        const c = cat.items?.[id]; if (!c || !Number.isFinite(c.price)) return NaN;
        return floorOf(!c.fixed && Number.isFinite(pr[id]) && pr[id] > 0 ? pr[id] : c.price, c.fixed ? NaN : sale[id], false);
      };
    };
    const versions = (env ? await stockVersions(env, stock) : [stock]).map(floorsFrom);
    const lines = (String(f.order_code || '').split('|')[2] || '').split(',');
    const bad = [];
    for (const l of lines) {
      const [kind, id, , , priceS] = l.split(':'), price = Number(priceS);
      if (kind !== 'b' && kind !== 'i') { bad.push(`${l}: unknown kind`); continue; }
      const floors = versions.map((v) => v(kind, id)).filter(Number.isFinite);
      if (!floors.length) { bad.push(`${id}: not in the catalogue`); continue; }
      const floor = Math.min(...floors);
      if (price < floor) bad.push(`${id} at ${price}, lowest price ${floor}`);
    }
    return bad.length ? { bad: bad.slice(0, 5).join('; ') } : {};
  } catch (e) { return { skipped: `error: ${String(e?.message || e).slice(0, 70)}` }; }   // never block an order on our own bug
}

async function readJson(req, max = 4000) {
  const text = await req.text();
  if (text.length > max) return null;
  try { const b = JSON.parse(text); return b && typeof b === 'object' ? b : null; } catch { return null; }
}

// ---- Order state that must never be lost ----
// KV has no compare-and-set and a read elsewhere can be a minute old, so two requests can each read an order and
// write it back, the later one undoing the earlier. Facts that must survive that are kept in their own write-once
// keys and merged in on every read (loadOrder): the buyer's cancel (cancel:<id>), the Razorpay order made for it
// (rzpo:<id>, and rzp:<razorpay order> → id for the webhook), and every payment (pay:<id>:<pay id>). The order
// record itself is only a convenient copy. Refund totals are always worked out again from Razorpay.
const KEEP = { expirationTtl: 400 * 86400 };
async function loadOrder(env, id) {
  const [o, c, r] = await Promise.all([env.ORDERS.get(`order:${id}`, 'json'), env.ORDERS.get(`cancel:${id}`, 'json'), env.ORDERS.get(`rzpo:${id}`, 'json')]);
  if (!o) return null;
  if (c?.by) { o.status = 'rejected'; o.cancel = c; }
  if (r?.order_id && !o.rzp?.order_id) o.rzp = r;
  return o;
}
const saveOrder = (env, o) => env.ORDERS.put(`order:${o.id}`, JSON.stringify(o), { metadata: { status: o.status } });
async function paymentsOf(env, id) {
  const out = [];
  let cursor;
  do {
    const page = await env.ORDERS.list({ prefix: `pay:${id}:`, cursor });
    for (const k of page.keys) out.push({ id: k.name.slice(`pay:${id}:`.length), amount: Number(k.metadata?.amount) || 0, via: k.metadata?.via || '' });
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

// Note a payment on the stored order. Same payment seen twice (Checkout and webhook): kept once.
// Only called for payments known to be on this order's own Razorpay order (signature or rzp:<order> map).
async function markPaid(env, id, p) {
  await env.ORDERS.put(`pay:${id}:${p.id}`, '1', { ...KEEP, metadata: { amount: p.amount, via: p.via } });
  const o = await loadOrder(env, id);
  if (!o) return null;
  if (o.payment?.status === 'paid' && o.payment.id === p.id) return o;
  if (o.payment?.status === 'paid') {                                   // a second, different payment: keep both
    o.extra_payments = (o.extra_payments || []).filter((x) => x.id !== p.id);
    if (o.extra_payments.length < 5) o.extra_payments.push({ id: p.id, amount: p.amount, via: p.via, at: new Date().toISOString(), note: 'paid twice: refund this one' });
  } else {
    o.payment = { status: 'paid', id: p.id, amount: p.amount, via: p.via, at: new Date().toISOString(), rzp_order: p.rzp_order || o.rzp?.order_id || '' };
    if (o.rzp?.amount && Math.round(p.amount * 100) !== o.rzp.amount) o.payment.note = `amount differs from order (${o.rzp.amount / 100})`;
  }
  await saveOrder(env, o);
  return o;
}

async function payCreate(req, env, origin) {
  const h = cors(origin, env);
  if (!h) return json({ success: false, error: 'Origin not allowed' }, 403);
  if (!payReady(env)) return json({ success: false, error: 'Online payment is not set up' }, 503, h);
  const b = await readJson(req);
  const id = String(b?.order_id || '');
  if (!ORDER_ID.test(id)) return json({ success: false, error: 'Bad order id' }, 422, h);
  const o = await loadOrder(env, id);
  if (!o) return json({ success: false, error: 'Order not found' }, 404, h);
  if (o.status === 'rejected') return json({ success: false, error: 'Order cancelled', cancelled: true }, 409, h);
  if (o.payment?.status === 'paid' || (await paymentsOf(env, id)).length) return json({ success: false, error: 'Already paid', paid: true }, 409, h);
  const placed = Date.parse(o.created_at);
  if (!(placed >= PAY_SINCE) || Date.now() - placed > PAY_HOURS * 3600e3) return json({ success: false, error: 'Order too old to pay online', expired: true }, 410, h);
  if (o.check) return json({ success: false, error: 'Order total needs checking', needsCheck: true }, 422, h);
  const amount = Math.round(Number(o.fields?.total) * 100);
  if (!Number.isFinite(amount) || amount < 100 || amount > 5000000) return json({ success: false, error: 'Bad order total' }, 422, h);
  const out = (rid) => json({ success: true, key: env.RAZORPAY_KEY_ID, order_id: rid, amount, currency: 'INR' }, 200, h);
  // Reuse the Razorpay order made for this order (Checkout opened twice, page reloaded).
  if (o.rzp?.order_id && o.rzp.amount === amount) return out(o.rzp.order_id);
  let r, body;
  try {
    r = await rzpFetch(env, '/orders', { method: 'POST', body: JSON.stringify({ amount, currency: 'INR', receipt: id, notes: { order_id: id } }) });
    body = r.body;
  } catch { return json({ success: false, error: 'Payment service unreachable' }, 502, h); }
  if (!r.ok || !body?.id) return json({ success: false, error: 'Payment service error' }, 502, h);
  o.rzp = { order_id: body.id, amount, at: new Date().toISOString() };
  await env.ORDERS.put(`rzp:${body.id}`, id, KEEP);
  await env.ORDERS.put(`rzpo:${id}`, JSON.stringify(o.rzp), KEEP);
  await env.ORDERS.put(`rzpos:${id}:${body.id}`, '1', KEEP);           // every Razorpay order made for it (two taps at once make two)
  await saveOrder(env, o);
  return out(body.id);
}

// Checkout's success callback. The signature proves Razorpay saw this payment for our Razorpay order.
async function payVerify(req, env, origin, ctx) {
  const h = cors(origin, env);
  if (!h) return json({ success: false, error: 'Origin not allowed' }, 403);
  if (!payReady(env)) return json({ success: false, error: 'Online payment is not set up' }, 503, h);
  const b = await readJson(req);
  const id = String(b?.order_id || ''), ro = String(b?.razorpay_order_id || ''), rp = String(b?.razorpay_payment_id || ''), sig = String(b?.razorpay_signature || '');
  if (!ORDER_ID.test(id) || !/^order_\w{6,40}$/.test(ro) || !/^pay_\w{6,40}$/.test(rp) || !/^[0-9a-f]{64}$/.test(sig)) return json({ success: false, error: 'Bad payment details' }, 422, h);
  const o = await loadOrder(env, id);
  if (!o || !o.rzp?.order_id || (o.rzp.order_id !== ro && (await env.ORDERS.get(`rzp:${ro}`)) !== id)) return json({ success: false, error: 'Order not found' }, 404, h);
  if (!sameSecret(await hmac(env.RAZORPAY_KEY_SECRET, `${ro}|${rp}`), sig)) return json({ success: false, error: 'Signature mismatch' }, 400, h);
  const after = await markPaid(env, id, { id: rp, amount: o.rzp.amount / 100, via: 'checkout', rzp_order: ro });
  if (after?.cancel?.by === 'buyer') { ctx?.waitUntil(refundAll(env, id)); return json({ success: true, id, cancelled: true }, 200, h); }
  return json({ success: true, id, paid: true }, 200, h);
}

// Which TadaBoo order a Razorpay order belongs to: the map payCreate wrote, else the receipt on the Razorpay order
// (set by this worker with its secret key). Never the payment's notes: the buyer's browser sets those.
async function orderOfRzp(env, rzpOrder) {
  if (!/^order_\w{6,40}$/.test(String(rzpOrder || ''))) return '';
  const mapped = await env.ORDERS.get(`rzp:${rzpOrder}`);
  if (ORDER_ID.test(mapped || '')) return mapped;
  const r = await rzpFetch(env, `/orders/${rzpOrder}`).catch(() => null);
  const id = String(r?.ok ? r.body?.receipt || '' : '');
  if (!ORDER_ID.test(id)) return '';
  const o = await loadOrder(env, id);
  return o && (!o.rzp?.order_id || o.rzp.order_id === rzpOrder) ? id : '';
}

// Razorpay webhook (Dashboard → Webhooks, events payment.captured and order.paid). Catches payments
// where the buyer closed the page before Checkout called back.
async function payWebhook(req, env, ctx) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return json({ success: false }, 503);
  const raw = await req.text();
  if (raw.length > 100000) return json({ success: false }, 413);
  const sig = req.headers.get('x-razorpay-signature') || '';
  if (!sameSecret(await hmac(env.RAZORPAY_WEBHOOK_SECRET, raw), sig)) return json({ success: false }, 400);
  let ev; try { ev = JSON.parse(raw); } catch { return json({ success: false }, 400); }
  const p = ev?.payload?.payment?.entity;
  if (!['payment.captured', 'order.paid'].includes(ev?.event) || !PAY_ID.test(String(p?.id || ''))) return json({ success: true, ignored: true });
  const id = payReady(env) ? await orderOfRzp(env, p.order_id) : await env.ORDERS.get(`rzp:${p.order_id}`).then((x) => (ORDER_ID.test(x || '') ? x : ''));
  if (!id) return json({ success: true, ignored: true });                // not one of our website orders (e.g. a payment link)
  const o = await markPaid(env, id, { id: p.id, amount: (p.amount || 0) / 100, via: 'webhook', rzp_order: p.order_id });
  if (o?.cancel?.by === 'buyer') ctx?.waitUntil(refundAll(env, id));
  return json({ success: true });
}

// ---- Buyer cancel and refunds ----
const rzpFetch = (env, path, init = {}) => fetch(`${RZP}${path}`, { ...init, signal: AbortSignal.timeout(15000),
  headers: { authorization: 'Basic ' + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`), 'content-type': 'application/json', ...(init.headers || {}) } })
  .then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) }));
const PAY_ID = /^pay_\w{6,40}$/;
const rupees = (paise) => Math.round(paise) / 100;

// Razorpay's own view of the payments on this order's Razorpay order. null if it couldn't be read.
async function rzpOrdersOf(env, o, withList = true) {
  const set = new Set(o.rzp?.order_id ? [o.rzp.order_id] : []);
  if (withList) { const page = await env.ORDERS.list({ prefix: `rzpos:${o.id}:` }); for (const k of page.keys) set.add(k.name.slice(`rzpos:${o.id}:`.length)); }
  return [...set].filter((x) => /^order_\w{6,40}$/.test(x));
}
async function rzpPayments(env, o, withList = true) {
  const orders = await rzpOrdersOf(env, o, withList);
  if (!orders.length) return [];
  if (!payReady(env)) return null;
  const out = [];
  for (const ro of orders) {
    const r = await rzpFetch(env, `/orders/${ro}/payments`).catch(() => null);
    if (!r?.ok || !Array.isArray(r.body?.items)) return null;
    out.push(...r.body.items.filter((p) => PAY_ID.test(String(p?.id || '')) && p.order_id === ro));
  }
  return out;
}
// Refunded, still to refund, and waiting for capture, in paise, from Razorpay's figures.
const tally = (pays) => pays.reduce((t, p) => {
  t.refunded += p.amount_refunded || 0;
  if (p.status === 'captured' || p.status === 'refunded') t.due += Math.max(0, (p.amount || 0) - (p.amount_refunded || 0));
  if (p.status === 'authorized') t.waiting += p.amount || 0;
  return t;
}, { refunded: 0, due: 0, waiting: 0 });

// Refund every captured payment on a buyer-cancelled order's own Razorpay order, for what Razorpay says is still
// unrefunded. Only payments whose order_id is this order's Razorpay order count (never by notes). Safe to run any
// number of times, also at once: Razorpay refuses a refund above what is left on a payment, and the result written
// back is always Razorpay's latest figures.
async function refundAll(env, id) {
  let o = await loadOrder(env, id);
  if (!o || o.cancel?.by !== 'buyer') return o;
  const errors = [], done = [];
  let pays = await rzpPayments(env, o);
  if (pays === null) errors.push(payReady(env) ? "couldn't read the payments from Razorpay" : 'online payment not set up');
  for (const p of pays || []) {
    const dueOf = (q) => ((q.status === 'captured' || q.status === 'refunded') ? (q.amount || 0) - (q.amount_refunded || 0) : 0);
    if (dueOf(p) <= 0) continue;
    const lock = `lock:refund:${p.id}`;
    if (await env.ORDERS.get(lock)) continue;                                  // another call refunded it or is doing so
    await env.ORDERS.put(lock, '1', { expirationTtl: 60 });
    const fresh = await rzpFetch(env, `/payments/${p.id}`).catch(() => null);  // what is left now, after taking the lock
    const due = fresh?.ok && fresh.body?.order_id === p.order_id ? dueOf(fresh.body) : 0;
    if (due <= 0) { if (!fresh?.ok) { errors.push(`${p.id}: couldn't read it`); try { await env.ORDERS.delete(lock); } catch {} } continue; }
    const rf = await rzpFetch(env, `/payments/${p.id}/refund`, { method: 'POST', body: JSON.stringify({ amount: due, notes: { order_id: id, reason: 'Cancelled by the buyer on the website' } }) }).catch(() => null);
    if (rf?.ok && rf.body?.id) done.push({ id: rf.body.id, payment: p.id, amount: rupees(due), at: new Date().toISOString() });  // lock stays for its minute
    else { errors.push(`${p.id}: ${String(rf?.body?.error?.description || rf?.status || 'unreachable').slice(0, 100)}`); try { await env.ORDERS.delete(lock); } catch {} }
  }
  // Payments recorded here that are not on our Razorpay order can't be refunded automatically: the owner does it.
  const recorded = await paymentsOf(env, id);
  const foreign = pays ? recorded.filter((x) => !pays.some((p) => p.id === x.id)) : [];
  if (foreign.length) errors.push(`${foreign.map((x) => x.id).join(', ')}: not on this order's Razorpay order, refund by hand`);
  if (done.length || pays) { const again = await rzpPayments(env, o); if (again) pays = again; }
  const t = tally(pays || []);
  o = await loadOrder(env, id) || o;                                              // re-read: keep what others wrote meanwhile
  const known = new Set((o.refunds || []).map((x) => x.id));
  o.refunds = [...(o.refunds || []), ...done.filter((x) => !known.has(x.id))].slice(-10);
  o.refunded_total = rupees(t.refunded);
  o.awaiting_capture = t.waiting > 0;
  o.refund_pending = t.due > 0 || pays === null || foreign.length > 0;
  if (errors.length && (o.refund_pending || o.awaiting_capture)) o.refund_error = errors.join('; ').slice(0, 300); else delete o.refund_error;
  o.refund_checked = new Date().toISOString();
  await saveOrder(env, o);
  return o;
}

const cancelView = (o) => ({ success: true, cancelled: true, at: o.cancel.at, refunded: Number(o.refunded_total) || 0, pending: !!(o.refund_pending || o.awaiting_capture) });

// Online cancel is open for CANCEL_HOURS after placing (the page says the same); after that, WhatsApp.
const CANCEL_HOURS = 2, CANCEL_TRIES = 20;
// The buyer cancels their own order from "My orders". confirm: false only says whether it can be cancelled.
async function cancelOrder(req, env, origin) {
  const h = cors(origin, env);
  if (!h) return json({ success: false, error: 'Origin not allowed' }, 403);
  const b = await readJson(req, 1000);
  const id = String(b?.order_id || ''), k = String(b?.key || '');
  if (!ORDER_ID.test(id) || !/^[0-9a-f]{64}$/.test(k)) return json({ success: false, error: 'Bad request' }, 422, h);
  // Only wrong keys count towards the limit, so an honest buyer on a shared mobile IP isn't blocked.
  const ip = req.headers.get('cf-connecting-ip') || 'unknown', rl = `rlc:${ip}:${new Date().toISOString().slice(0, 13)}`;
  const n = +(await env.ORDERS.get(rl)) || 0;
  if (n >= CANCEL_TRIES) return json({ success: false, error: 'Too many tries', busy: true }, 429, h);
  const o = await loadOrder(env, id);
  // Same answer for "no such order" and "wrong key", so the endpoint tells a guesser nothing.
  if (!o || !o.cancel_hash || !sameSecret(await sha256(k), o.cancel_hash)) {
    await env.ORDERS.put(rl, String(n + 1), { expirationTtl: 3700 });
    return json({ success: false, error: 'Not allowed', denied: true }, 403, h);
  }
  if (o.cancel?.by === 'buyer') {
    // Repeat calls cost nothing: refunds are looked at again only when something may still be owed, at most once a minute.
    const recorded = [o.payment?.status === 'paid' ? o.payment.amount : 0, ...(o.extra_payments || []).map((x) => x.amount)].reduce((a, x) => a + (Number(x) || 0), 0);
    const owed = !o.refund_checked || o.refund_pending || o.awaiting_capture || recorded > (Number(o.refunded_total) || 0) + 0.001;
    const recent = Date.now() - Date.parse(o.refund_checked || 0) < 60e3;
    return json(cancelView(b.confirm === true && owed && !recent ? await refundAll(env, id) : o), 200, h);
  }
  if (o.status === 'rejected') return json({ success: false, error: 'Cancelled by the shop', shopCancelled: true }, 409, h);
  if (o.status !== 'new') return json({ success: false, error: 'Already confirmed', locked: true }, 409, h);
  if (!(Date.now() - Date.parse(o.created_at) < CANCEL_HOURS * 3600e3)) return json({ success: false, error: 'Too late to cancel online', late: true }, 409, h);
  if (b.confirm !== true) {
    // What was paid: Razorpay's figures when it can be asked, else the payments recorded here.
    // No KV list or write here: the dry run can be called freely without using up the shop's daily KV allowance.
    const pays = await rzpPayments(env, o, false);
    const recorded = [o.payment?.status === 'paid' ? o.payment.amount : 0, ...(o.extra_payments || []).map((x) => x.amount)].reduce((a, x) => a + (Number(x) || 0), 0);
    const fromRzp = pays ? pays.filter((p) => ['captured', 'refunded', 'authorized'].includes(p.status)).reduce((a, p) => a + (p.amount || 0) - (p.amount_refunded || 0), 0) : 0;
    return json({ success: true, can: true, paid: Math.max(rupees(fromRzp), Math.round(recorded * 100) / 100), sure: pays !== null }, 200, h);
  }
  // The cancel goes in its own write-once key first: from then on every read sees the order as cancelled, whatever
  // else writes the order record. Then the money goes back.
  const at = new Date().toISOString();
  await env.ORDERS.put(`cancel:${id}`, JSON.stringify({ by: 'buyer', at }), KEEP);
  o.status = 'rejected'; o.updated_at = at; o.cancel = { by: 'buyer', at };
  await saveOrder(env, o);
  return json(cancelView(await refundAll(env, id)), 200, h);
}

async function ownerRefund(id, env) {
  const o = await loadOrder(env, id);
  if (o?.cancel?.by !== 'buyer') return json({ success: false, error: 'Not a buyer-cancelled order' }, 409);
  const r = await refundAll(env, id);
  return json({ success: true, id, refunded: Number(r.refunded_total) || 0, pending: !!r.refund_pending, awaiting_capture: !!r.awaiting_capture, error: r.refund_error || '' });
}

async function placeOrder(req, env, origin, ctx) {
  const h = cors(origin, env);
  if (!h) return json({ success: false, error: 'Origin not allowed' }, 403);
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ success: false, error: 'Too large' }, 413, h);
  let body; try { body = JSON.parse(text); } catch { return json({ success: false, error: 'Bad JSON' }, 400, h); }
  const f = body && typeof body.fields === 'object' && body.fields ? body.fields : {};
  if (String(f.website || '').trim()) return json({ success: true }, 200, h);           // honeypot: pretend it worked
  const fields = {};
  for (const [k, v] of Object.entries(f)) {
    if (!/^[a-z_]{1,40}$/.test(k) || k === 'website') continue;
    fields[k] = String(v ?? '').slice(0, MAX_FIELD);
  }
  const missing = REQUIRED.filter((k) => !fields[k] || !fields[k].trim());
  if (missing.length) return json({ success: false, error: 'Missing fields', fields: missing }, 422, h);
  const id = fields.order_id.trim();
  if (!/^TB-\d{6}-[A-Z0-9]{4}$/.test(id) || !fields.order_code.startsWith(`TB1|${id}|`)) return json({ success: false, error: 'Bad order code' }, 422, h);

  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const rlKey = `rl:${ip}:${new Date().toISOString().slice(0, 13)}`;
  const count = +(await env.ORDERS.get(rlKey)) || 0;
  if (count >= PER_IP_PER_HOUR) return json({ success: false, error: 'Too many orders, please use WhatsApp' }, 429, h);
  await env.ORDERS.put(rlKey, String(count + 1), { expirationTtl: 3700 });

  const key = `order:${id}`, prev = await env.ORDERS.get(key, 'json');
  if (prev && (prev.fields?.order_code !== fields.order_code || prev.fields?.total !== fields.total || prev.fields?.pincode !== fields.pincode))
    return json({ success: false, error: 'Order id already used', conflict: true }, 409, h);  // bag changed after a lost reply: page makes a new id
  if (!prev) {                                                                            // same order sent twice: keep the first
    const order = { id, form_name: 'tadaboo_order', status: 'new', created_at: new Date().toISOString(), fields,
      metadata: { country: req.cf?.country || '', city: req.cf?.city || '' } };
    if (/^[0-9a-f]{64}$/.test(String(body.cancel_hash || ''))) order.cancel_hash = body.cancel_hash;
    let check = totalCheck(fields);
    if (!check) { const pc = await priceCheck(fields, env); if (pc.bad) check = `price below shop price: ${pc.bad}`; else if (pc.skipped) order.price_check = `skipped (${pc.skipped})`; }
    if (check) order.check = check;
    await env.ORDERS.put(key, JSON.stringify(order), { metadata: { status: 'new' } });
    if (env.WP_KEY && ctx) ctx.waitUntil(copyToWebsitePublisher(env, key, order));
  }
  return json({ success: true, id }, 200, h);
}

// File the order in WebsitePublisher's lead capture, then note the result on the stored order.
async function copyToWebsitePublisher(env, key, order) {
  let copy;
  try {
    const r = await fetch(WP.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.WP_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ form_name: WP.form, fields: order.fields, metadata: { source: 'tadaboo-orders', order_id: order.id } }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await r.json().catch(() => null);
    copy = r.ok && body?.success !== false ? 'ok' : `failed: HTTP ${r.status} ${String(body?.error?.message || '').slice(0, 120)}`.trim();
  } catch (e) { copy = `failed: ${String(e?.name || e).slice(0, 60)}`; }
  try { await env.ORDERS.put(`copy:${order.id}`, copy, { expirationTtl: 400 * 86400 }); } catch { /* not worth failing for */ }
}

// One visit = one small KV key v:<date>:<n|r>:<src>:<land>:<random> (n = first visit from that device), kept 3 days.
// (Keys written before sources were recorded are v:<date>:<n|r>:<random>; they count as 'unknown'.)
// KV has no atomic add and its reads can be a minute old, so keys are counted rather than a number bumped.
async function hit(req, env, origin) {
  const h = cors(origin, env);
  if (!h) return new Response(null, { status: 403 });
  const text = await req.text();
  if (text.length > 200) return new Response(null, { status: 413, headers: h });
  let body = {}; try { body = JSON.parse(text || '{}'); } catch { /* count it anyway */ }
  await env.ORDERS.put(`v:${istDate()}:${body?.new === true ? 'n' : 'r'}:${label(body?.src, SRC)}:${label(body?.land, LAND)}:${crypto.randomUUID()}`, '', { expirationTtl: 3 * 86400 });
  return new Response(null, { status: 204, headers: h });
}

async function countDay(env, date) {
  let visits = 0, fresh = 0, cursor;
  const src = {}, land = {};
  do {
    const page = await env.ORDERS.list({ prefix: `v:${date}:`, cursor });
    for (const k of page.keys) {
      visits++; if (k.name.startsWith(`v:${date}:n:`)) fresh++;
      const p = k.name.split(':'), s = p.length >= 6 ? p[3] : 'unknown', l = p.length >= 6 ? p[4] : 'unknown';
      src[s] = (src[s] || 0) + 1; land[l] = (land[l] || 0) + 1;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return { visits, new: fresh, src, land };
}

// Today is counted live; a finished day is counted once and kept as views:<date> for 400 days.
async function listViews(url, env) {
  const days = Math.min(400, Math.max(1, +url.searchParams.get('days') || 30));
  const out = {};
  for (let i = 0; i < days; i++) {
    const d = istDate(Date.now() - i * 86400e3);
    if (i === 0) { out[d] = await countDay(env, d); continue; }
    let v = await env.ORDERS.get(`views:${d}`, 'json');
    if (!v) { v = await countDay(env, d); await env.ORDERS.put(`views:${d}`, JSON.stringify(v), { expirationTtl: VIEW_TTL }); }
    out[d] = { visits: v.visits || 0, new: v.new || 0, ...(v.src ? { src: v.src, land: v.land || {} } : {}) };
  }
  return json({ days: out, at: new Date().toISOString() });
}

async function listOrders(url, env) {
  const want = url.searchParams.get('status');
  const keysOf = async (prefix) => { const out = []; let cursor; do { const page = await env.ORDERS.list({ prefix, cursor }); out.push(...page.keys); cursor = page.list_complete ? null : page.cursor; } while (cursor); return out; };
  const cancelled = new Set((await keysOf('cancel:')).map((k) => k.name.slice(7)));
  const pays = {};
  for (const k of await keysOf('pay:')) { const [, id, pid] = k.name.split(':'); (pays[id] ||= []).push({ id: pid, amount: Number(k.metadata?.amount) || 0, via: k.metadata?.via || '' }); }
  const data = [];
  for (const k of await keysOf('order:')) {
    const id = k.name.slice(6);
    const st = cancelled.has(id) ? 'rejected' : k.metadata?.status;
    if (want && st && st !== want) continue;
    const o = await loadOrder(env, id);
    if (!o || (want && o.status !== want)) continue;
    delete o.cancel_hash;
    // Payments kept in their own keys: put back any the order record lost.
    for (const p of pays[id] || []) {
      if (o.payment?.id === p.id || (o.extra_payments || []).some((x) => x.id === p.id)) continue;
      if (o.payment?.status !== 'paid') o.payment = { status: 'paid', id: p.id, amount: p.amount, via: p.via };
      else (o.extra_payments ||= []).push({ id: p.id, amount: p.amount, via: p.via, note: 'paid twice: refund this one' });
    }
    if (!o.copy) { const c = await env.ORDERS.get(`copy:${o.id}`); if (c) o.copy = c; }
    data.push(o);
  }
  data.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return json({ data, total: data.length });
}

// A buyer-cancelled order is never moved on by accident (the hourly sync's "won" after the buyer cancelled and was
// refunded): that answers 409 cancelledByBuyer. { override: true } reopens it on purpose (the cancel is kept in
// cancel_history, so later payments are no longer refunded automatically). A reopened order still shows its old,
// refunded payment, so it can't be paid online again: send the buyer a Razorpay payment link instead.
async function setStatus(id, req, env) {
  let body; try { body = await req.json(); } catch { return json({ success: false, error: 'Bad JSON' }, 400); }
  if (!STATUSES.includes(body?.status)) return json({ success: false, error: `status must be one of ${STATUSES.join(', ')}` }, 422);
  const o = await loadOrder(env, id);
  if (!o) return json({ success: false, error: 'Not found' }, 404);
  if (o.cancel?.by === 'buyer' && body.status !== 'rejected') {
    if (body.override !== true) return json({ success: false, error: `The buyer cancelled this order at ${o.cancel.at}${o.refund_pending ? ' (refund not finished yet)' : ''}: don't send it`, cancelledByBuyer: true }, 409);
    o.cancel_history = [...(o.cancel_history || []), { ...o.cancel, reopened: new Date().toISOString() }];
    delete o.cancel;
    await env.ORDERS.delete(`cancel:${id}`);
  }
  o.status = body.status; o.updated_at = new Date().toISOString();
  await saveOrder(env, o);
  return json({ success: true, id, status: o.status });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), origin = req.headers.get('origin') || '';
    if (req.method === 'OPTIONS') { const h = cors(origin, env); return new Response(null, { status: h ? 204 : 403, headers: h || {} }); }
    if (url.pathname === '/order' && req.method === 'POST') return placeOrder(req, env, origin, ctx);
    if (url.pathname === '/hit' && req.method === 'POST') return hit(req, env, origin);
    if (url.pathname === '/pay/create' && req.method === 'POST') return payCreate(req, env, origin);
    if (url.pathname === '/pay/verify' && req.method === 'POST') return payVerify(req, env, origin, ctx);
    if (url.pathname === '/pay/webhook' && req.method === 'POST') return payWebhook(req, env, ctx);
    if (url.pathname === '/order/cancel' && req.method === 'POST') return cancelOrder(req, env, origin);
    if (url.pathname === '/views' && req.method === 'GET') return isOwner(req, env) ? listViews(url, env) : json({ success: false, error: 'Unauthorized' }, 401);
    if (url.pathname === '/orders' && req.method === 'GET') return isOwner(req, env) ? listOrders(url, env) : json({ success: false, error: 'Unauthorized' }, 401);
    const m = /^\/orders\/(TB-\d{6}-[A-Z0-9]{4})\/status$/.exec(url.pathname);
    if (m && req.method === 'POST') return isOwner(req, env) ? setStatus(m[1], req, env) : json({ success: false, error: 'Unauthorized' }, 401);
    const rf = /^\/orders\/(TB-\d{6}-[A-Z0-9]{4})\/refund$/.exec(url.pathname);
    if (rf && req.method === 'POST') return isOwner(req, env) ? ownerRefund(rf[1], env) : json({ success: false, error: 'Unauthorized' }, 401);
    if (url.pathname === '/') return new Response('TadaBoo order inbox', { headers: { 'content-type': 'text/plain' } });
    return json({ success: false, error: 'Not found' }, 404);
  },
};
