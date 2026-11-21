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
//
// Razorpay: var RAZORPAY_KEY_ID (wrangler.toml, public), secrets RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET.
// The amount charged is the total stored with the order when it was placed, never a number sent with /pay/create.
// A paid order carries `payment: { status: "paid", id, amount (₹), via, at }`; the owner checks the amount
// against the order before dispatch (the site works the total out in the buyer's browser).
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
// is kept on the order as `copy` ("ok" or "failed: …") and the hourly task still imports from this inbox.

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
const payReady = (env) => !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
const ORDER_ID = /^TB-\d{6}-[A-Z0-9]{4}$/;

async function readJson(req, max = 4000) {
  const text = await req.text();
  if (text.length > max) return null;
  try { const b = JSON.parse(text); return b && typeof b === 'object' ? b : null; } catch { return null; }
}

// Note a payment on the stored order. Same payment seen twice (Checkout and webhook): kept once.
async function markPaid(env, id, p) {
  const key = `order:${id}`, o = await env.ORDERS.get(key, 'json');
  if (!o) return false;
  if (o.payment?.status === 'paid' && o.payment.id === p.id) return true;
  o.payment = { status: 'paid', id: p.id, amount: p.amount, via: p.via, at: new Date().toISOString(), rzp_order: p.rzp_order || o.rzp?.order_id || '' };
  if (o.rzp?.amount && Math.round(p.amount * 100) !== o.rzp.amount) o.payment.note = `amount differs from order (${o.rzp.amount / 100})`;
  await env.ORDERS.put(key, JSON.stringify(o), { metadata: { status: o.status } });
  return true;
}

async function payCreate(req, env, origin) {
  const h = cors(origin, env);
  if (!h) return json({ success: false, error: 'Origin not allowed' }, 403);
  if (!payReady(env)) return json({ success: false, error: 'Online payment is not set up' }, 503, h);
  const b = await readJson(req);
  const id = String(b?.order_id || '');
  if (!ORDER_ID.test(id)) return json({ success: false, error: 'Bad order id' }, 422, h);
  const key = `order:${id}`, o = await env.ORDERS.get(key, 'json');
  if (!o) return json({ success: false, error: 'Order not found' }, 404, h);
  if (o.payment?.status === 'paid') return json({ success: false, error: 'Already paid', paid: true }, 409, h);
  if (o.status === 'rejected') return json({ success: false, error: 'Order cancelled' }, 409, h);
  const amount = Math.round(Number(o.fields?.total) * 100);
  if (!Number.isFinite(amount) || amount < 100 || amount > 5000000) return json({ success: false, error: 'Bad order total' }, 422, h);
  const out = (rid) => json({ success: true, key: env.RAZORPAY_KEY_ID, order_id: rid, amount, currency: 'INR',
    name: o.fields.name || '', phone: o.fields.phone || '' }, 200, h);
  // Reuse the Razorpay order made for this order (Checkout opened twice, page reloaded).
  if (o.rzp?.order_id && o.rzp.amount === amount) return out(o.rzp.order_id);
  let r, body;
  try {
    r = await fetch(`${RZP}/orders`, {
      method: 'POST',
      headers: { authorization: 'Basic ' + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`), 'content-type': 'application/json' },
      body: JSON.stringify({ amount, currency: 'INR', receipt: id, notes: { order_id: id } }),
      signal: AbortSignal.timeout(15000),
    });
    body = await r.json().catch(() => null);
  } catch { return json({ success: false, error: 'Payment service unreachable' }, 502, h); }
  if (!r.ok || !body?.id) return json({ success: false, error: 'Payment service error' }, 502, h);
  o.rzp = { order_id: body.id, amount, at: new Date().toISOString() };
  await env.ORDERS.put(key, JSON.stringify(o), { metadata: { status: o.status } });
  return out(body.id);
}

// Checkout's success callback. The signature proves Razorpay saw this payment for our Razorpay order.
async function payVerify(req, env, origin) {
  const h = cors(origin, env);
  if (!h) return json({ success: false, error: 'Origin not allowed' }, 403);
  if (!payReady(env)) return json({ success: false, error: 'Online payment is not set up' }, 503, h);
  const b = await readJson(req);
  const id = String(b?.order_id || ''), ro = String(b?.razorpay_order_id || ''), rp = String(b?.razorpay_payment_id || ''), sig = String(b?.razorpay_signature || '');
  if (!ORDER_ID.test(id) || !/^order_\w{6,40}$/.test(ro) || !/^pay_\w{6,40}$/.test(rp) || !/^[0-9a-f]{64}$/.test(sig)) return json({ success: false, error: 'Bad payment details' }, 422, h);
  const o = await env.ORDERS.get(`order:${id}`, 'json');
  if (!o || o.rzp?.order_id !== ro) return json({ success: false, error: 'Order not found' }, 404, h);
  if (!sameSecret(await hmac(env.RAZORPAY_KEY_SECRET, `${ro}|${rp}`), sig)) return json({ success: false, error: 'Signature mismatch' }, 400, h);
  await markPaid(env, id, { id: rp, amount: o.rzp.amount / 100, via: 'checkout', rzp_order: ro });
  return json({ success: true, id, paid: true }, 200, h);
}

// Razorpay webhook (Dashboard → Webhooks, events payment.captured and order.paid). Catches payments
// where the buyer closed the page before Checkout called back.
async function payWebhook(req, env) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return json({ success: false }, 503);
  const raw = await req.text();
  if (raw.length > 100000) return json({ success: false }, 413);
  const sig = req.headers.get('x-razorpay-signature') || '';
  if (!sameSecret(await hmac(env.RAZORPAY_WEBHOOK_SECRET, raw), sig)) return json({ success: false }, 400);
  let ev; try { ev = JSON.parse(raw); } catch { return json({ success: false }, 400); }
  const p = ev?.payload?.payment?.entity;
  if (!['payment.captured', 'order.paid'].includes(ev?.event) || !p?.id) return json({ success: true, ignored: true });
  const id = String(p.notes?.order_id || ev?.payload?.order?.entity?.receipt || '');
  if (!ORDER_ID.test(id)) return json({ success: true, ignored: true });
  await markPaid(env, id, { id: p.id, amount: (p.amount || 0) / 100, via: 'webhook', rzp_order: p.order_id || '' });
  return json({ success: true });
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

  const key = `order:${id}`;
  if (!(await env.ORDERS.get(key))) {                                                     // same order sent twice: keep the first
    const order = { id, form_name: 'tadaboo_order', status: 'new', created_at: new Date().toISOString(), fields,
      metadata: { country: req.cf?.country || '', city: req.cf?.city || '' } };
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
  const o = await env.ORDERS.get(key, 'json');
  if (o) { o.copy = copy; await env.ORDERS.put(key, JSON.stringify(o), { metadata: { status: o.status } }); }
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
  const data = [];
  let cursor;
  do {
    const page = await env.ORDERS.list({ prefix: 'order:', cursor });
    for (const k of page.keys) {
      if (want && k.metadata?.status && k.metadata.status !== want) continue;
      const o = await env.ORDERS.get(k.name, 'json');
      if (o && (!want || o.status === want)) data.push(o);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  data.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return json({ data, total: data.length });
}

async function setStatus(id, req, env) {
  let body; try { body = await req.json(); } catch { return json({ success: false, error: 'Bad JSON' }, 400); }
  if (!STATUSES.includes(body?.status)) return json({ success: false, error: `status must be one of ${STATUSES.join(', ')}` }, 422);
  const key = `order:${id}`, o = await env.ORDERS.get(key, 'json');
  if (!o) return json({ success: false, error: 'Not found' }, 404);
  o.status = body.status; o.updated_at = new Date().toISOString();
  await env.ORDERS.put(key, JSON.stringify(o), { metadata: { status: o.status } });
  return json({ success: true, id, status: o.status });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), origin = req.headers.get('origin') || '';
    if (req.method === 'OPTIONS') { const h = cors(origin, env); return new Response(null, { status: h ? 204 : 403, headers: h || {} }); }
    if (url.pathname === '/order' && req.method === 'POST') return placeOrder(req, env, origin, ctx);
    if (url.pathname === '/hit' && req.method === 'POST') return hit(req, env, origin);
    if (url.pathname === '/pay/create' && req.method === 'POST') return payCreate(req, env, origin);
    if (url.pathname === '/pay/verify' && req.method === 'POST') return payVerify(req, env, origin);
    if (url.pathname === '/pay/webhook' && req.method === 'POST') return payWebhook(req, env);
    if (url.pathname === '/views' && req.method === 'GET') return isOwner(req, env) ? listViews(url, env) : json({ success: false, error: 'Unauthorized' }, 401);
    if (url.pathname === '/orders' && req.method === 'GET') return isOwner(req, env) ? listOrders(url, env) : json({ success: false, error: 'Unauthorized' }, 401);
    const m = /^\/orders\/(TB-\d{6}-[A-Z0-9]{4})\/status$/.exec(url.pathname);
    if (m && req.method === 'POST') return isOwner(req, env) ? setStatus(m[1], req, env) : json({ success: false, error: 'Unauthorized' }, 401);
    if (url.pathname === '/') return new Response('TadaBoo order inbox', { headers: { 'content-type': 'text/plain' } });
    return json({ success: false, error: 'Not found' }, 404);
  },
};
