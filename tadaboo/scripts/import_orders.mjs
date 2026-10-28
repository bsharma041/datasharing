// Turn new website orders (WebsitePublisher order inbox) into Stockroom "New" orders.
//
//   node tadaboo/scripts/import_orders.mjs <leads.json> <orders_dump_dir> <out.json>
//
// <leads.json>       the result of leads/get-leads (form tadaboo_order), as saved by the task
// <orders_dump_dir>  folder of existing Stockroom orders (ArtifactData list orders, out_dir) — may be empty
// <out.json>         written: { writes: [...ArtifactData batch entries], report: [...] }
//
// It reads each order with the Stockroom's OWN code (parseOrder, shipDefault, ... sliced out of
// tadaboo/stockroom/app.js), so an imported order is exactly what "Paste → Read order → Save order"
// would save. It only creates orders/<order id> with status "new"; it never writes a sale, so stock
// changes only when the owner presses "Confirm order and update stock" in the Stockroom.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [leadsFile, ordersDir, outFile] = process.argv.slice(2);
if (!leadsFile || !ordersDir || !outFile) { console.error('usage: import_orders.mjs <leads.json> <orders_dump_dir> <out.json>'); process.exit(2); }

// ---- Load the Stockroom's order-reading functions from app.js
const here = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(here, '..', 'stockroom', 'app.js'), 'utf8');
const slice = (from, to) => {
  const a = app.indexOf(from), b = app.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`app.js changed: can't find "${from}" … "${to}". Update import_orders.mjs.`);
  return app.slice(a, b);
};
const helpers = ['const n = ', 'const str = '].map((h) => app.slice(app.indexOf(h)).split('\n')[0]).join('\n');
const orderCode = slice('const DELIVERY = ', '// Gift kits default');
// eslint-disable-next-line no-new-func
const { parseOrder, shipDefault, n } = new Function(`${helpers}\n${orderCode}\nreturn { parseOrder, shipDefault, n };`)();

// ---- Inputs
const raw = JSON.parse(fs.readFileSync(leadsFile, 'utf8'));
const leads = (function find(x) {           // accept the full tool result or just the list
  if (Array.isArray(x)) return x;
  for (const k of ['data', 'result', 'leads']) if (x && x[k] != null) { const r = find(x[k]); if (r) return r; }
  return null;
})(raw) || [];
const existing = new Set(fs.existsSync(ordersDir)
  ? fs.readdirSync(ordersDir, { recursive: true }).filter((f) => String(f).endsWith('.json')).map((f) => path.basename(String(f), '.json'))
  : []);

// Inbox field order matches the website's form; this text is what the owner would otherwise paste.
const FIELD_ORDER = ['order_id', 'name', 'phone', 'delivery', 'address', 'pincode', 'note', 'items', 'total', 'order_code', 'offers_whatsapp'];
const asText = (fields) => {
  const keys = [...FIELD_ORDER.filter((k) => k in fields), ...Object.keys(fields).filter((k) => !FIELD_ORDER.includes(k) && k !== 'website')];
  return keys.map((k) => `${k}: ${String(fields[k] ?? '').trim()}`).join('\n');
};

const writes = [], report = [];
for (const lead of leads) {
  const leadId = lead.id ?? lead.lead_id ?? null;
  let fields = lead.fields ?? lead.data ?? lead.payload ?? lead;
  if (typeof fields === 'string') { try { fields = JSON.parse(fields); } catch { fields = {}; } }
  if (lead.form_name && lead.form_name !== 'tadaboo_order') continue;
  const p = parseOrder(asText(fields));
  if (p.error) { report.push({ leadId, action: 'skipped', why: p.error }); continue; }
  if (existing.has(p.id)) { report.push({ leadId, orderId: p.id, action: 'already in Stockroom' }); continue; }
  if (writes.some((w) => w.doc_id === p.id)) { report.push({ leadId, orderId: p.id, action: 'duplicate lead, skipped' }); continue; }
  const total = p.lines.reduce((a, l) => a + n(l.qty) * n(l.price), 0);
  const ship = shipDefault(p, total);
  const at = new Date().toISOString();
  // Same body as saveOrder in app.js, plus where it came from.
  const body = { code: p.code, lines: p.lines, customer: p.customer, raw: p.raw, total, shippingCharged: ship,
    status: 'new', createdAt: at, updatedAt: at, history: [{ status: 'new', at, by: 'website inbox' }],
    source: 'website', ...(leadId != null ? { leadId } : {}) };
  writes.push({ op: 'set', collection: 'orders', doc_id: p.id, data: body });
  const stated = n(String(fields.total ?? '').replace(/[^\d.]/g, ''));
  report.push({ leadId, orderId: p.id, action: 'import', customer: p.customer.name, lines: p.lines.length, items: total, delivery: ship,
    ...(stated && Math.abs(stated - (total + ship)) > 0.5 ? { warn: `buyer's total ₹${stated} ≠ items ₹${total} + delivery ₹${ship}` } : {}) });
}
fs.writeFileSync(outFile, JSON.stringify({ writes, report }, null, 2));
console.log(`${leads.length} lead(s): ${writes.length} to import, ${report.length - writes.length} skipped`);
for (const r of report) console.log(' -', JSON.stringify(r));
