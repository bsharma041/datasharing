// TadaBoo order inbox: a small Cloudflare Worker with KV storage.
//
//   POST /order                 public, from www.tadaboo.com: { fields: {...} } → stores the order as "new"
//   GET  /orders?status=new     owner only (Authorization: Bearer <ADMIN_TOKEN>) → { data: [order, ...] }
//   POST /orders/<id>/status    owner only, { status: "won" | "rejected" | "new" }
//
// An order is { id, form_name: "tadaboo_order", status, created_at, fields }: the same shape as the
// WebsitePublisher lead it replaces, so tadaboo/scripts/import_orders.mjs reads it unchanged.
// Bindings (wrangler.toml): KV namespace ORDERS; secret ADMIN_TOKEN. Local testing only: DEV_ORIGIN in .dev.vars.

const ALLOWED_ORIGINS = ['https://www.tadaboo.com', 'https://tadaboo.com', 'https://tadaboo-shop.pages.dev'];
const REQUIRED = ['order_id', 'name', 'phone', 'address', 'pincode', 'items', 'total', 'order_code'];
const MAX_FIELD = 4000, MAX_BODY = 20000, PER_IP_PER_HOUR = 10;
const STATUSES = ['new', 'won', 'rejected'];

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

async function placeOrder(req, env, origin) {
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
  }
  return json({ success: true, id }, 200, h);
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
  async fetch(req, env) {
    const url = new URL(req.url), origin = req.headers.get('origin') || '';
    if (req.method === 'OPTIONS') { const h = cors(origin, env); return new Response(null, { status: h ? 204 : 403, headers: h || {} }); }
    if (url.pathname === '/order' && req.method === 'POST') return placeOrder(req, env, origin);
    if (url.pathname === '/orders' && req.method === 'GET') return isOwner(req, env) ? listOrders(url, env) : json({ success: false, error: 'Unauthorized' }, 401);
    const m = /^\/orders\/(TB-\d{6}-[A-Z0-9]{4})\/status$/.exec(url.pathname);
    if (m && req.method === 'POST') return isOwner(req, env) ? setStatus(m[1], req, env) : json({ success: false, error: 'Unauthorized' }, 401);
    if (url.pathname === '/') return new Response('TadaBoo order inbox', { headers: { 'content-type': 'text/plain' } });
    return json({ success: false, error: 'Not found' }, 404);
  },
};
