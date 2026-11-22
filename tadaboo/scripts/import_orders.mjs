// Turn new website orders (WebsitePublisher order inbox) into Stockroom "New" orders.
//
//   node tadaboo/scripts/import_orders.mjs <leads.json> <orders_dump_dir> <out.json> [<cancelled.json>]
//
// <leads.json>       the result of leads/get-leads (form tadaboo_order), as saved by the task
// <orders_dump_dir>  folder of existing Stockroom orders (ArtifactData list orders, out_dir) — may be empty
// <out.json>         written: { writes: [...ArtifactData batch entries], report: [...], retryRefund: [order ids] }
// <cancelled.json>   optional: `orders.sh list rejected`. Orders the buyer cancelled on the website (cancel.by "buyer"):
//                    not in the Stockroom yet → created there as "cancelled"; still "new" there → set to "cancelled"
//                    (with if_version, so an owner's confirm made at the same moment wins); already confirmed there →
//                    left alone and reported as "stop" (the owner cancels it in the Stockroom, which puts stock back).
//                    A refund that didn't go through is listed in retryRefund for `orders.sh refund <id>`.
//
// It reads each order with the Stockroom's OWN code (parseOrder, shipDefault, ... sliced out of
// tadaboo/stockroom/app.js), so an imported order is exactly what "Paste → Read order → Save order"
// would save. It only creates orders/<order id> with status "new"; it never writes a sale, so stock
// changes only when the owner presses "Confirm order and update stock" in the Stockroom.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [leadsFile, ordersDir, outFile, cancelledFile] = process.argv.slice(2);
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
const listOf = (x) => { if (Array.isArray(x)) return x; for (const k of ['data', 'result', 'leads']) if (x && x[k] != null) { const r = listOf(x[k]); if (r) return r; } return null; };
const leads = listOf(JSON.parse(fs.readFileSync(leadsFile, 'utf8'))) || [];   // accept the full tool result or just the list
const dumpFiles = fs.existsSync(ordersDir)
  ? fs.readdirSync(ordersDir, { recursive: true }).filter((f) => String(f).endsWith('.json')).map((f) => String(f))
  : [];
const existing = new Set(dumpFiles.map((f) => path.basename(f, '.json')));
// One Stockroom order from the dump: its fields and version (the dump may wrap the document).
const stockroomOrder = (id) => {
  const f = dumpFiles.find((x) => path.basename(x, '.json') === id);
  if (!f) return null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ordersDir, f), 'utf8'));
    const doc = j && typeof j.data === 'object' && j.data ? j.data : j && typeof j.doc === 'object' && j.doc ? j.doc : j;
    return { doc: doc || {}, version: j?.version ?? j?._version ?? j?.meta?.version ?? null };
  } catch { return { doc: {}, version: null }; }
};

// Inbox field order matches the website's form; this text is what the owner would otherwise paste.
const FIELD_ORDER = ['order_id', 'name', 'phone', 'delivery', 'address', 'pincode', 'note', 'items', 'total', 'order_code', 'offers_whatsapp'];
const asText = (fields) => {
  const keys = [...FIELD_ORDER.filter((k) => k in fields), ...Object.keys(fields).filter((k) => !FIELD_ORDER.includes(k) && k !== 'website')];
  return keys.map((k) => `${k}: ${String(fields[k] ?? '').trim()}`).join('\n');
};

// What the order inbox knows beyond the form: online payment, a flagged total or price, a second payment.
const online = (lead) => {
  const out = {};
  if (lead.payment?.status === 'paid') out.paid = `₹${lead.payment.amount} online (Razorpay ${lead.payment.id})${lead.payment.note ? `: ${lead.payment.note}` : ''}`;
  else out.paid = 'not paid yet';
  if (lead.check) out.check = `needs checking, can't be paid online: ${lead.check}`;
  if (lead.price_check) out.priceCheck = `prices not checked (${lead.price_check}): check them by hand`;
  if (Array.isArray(lead.extra_payments) && lead.extra_payments.length) out.refund = lead.extra_payments.map((x) => `paid twice: refund ₹${x.amount} (${x.id})`).join('; ');
  return out;
};
const writes = [], report = [];
for (const lead of leads) {
  const leadId = lead.id ?? lead.lead_id ?? null;
  let fields = lead.fields ?? lead.data ?? lead.payload ?? lead;
  if (typeof fields === 'string') { try { fields = JSON.parse(fields); } catch { fields = {}; } }
  if (lead.form_name && lead.form_name !== 'tadaboo_order') continue;
  const p = parseOrder(asText(fields));
  if (p.error) { report.push({ leadId, action: 'skipped', why: p.error }); continue; }
  if (existing.has(p.id)) { report.push({ leadId, orderId: p.id, action: 'already in Stockroom', ...online(lead) }); continue; }
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
  report.push({ leadId, orderId: p.id, action: 'import', customer: p.customer.name, lines: p.lines.length, items: total, delivery: ship, ...online(lead),
    ...(stated && Math.abs(stated - (total + ship)) > 0.5 ? { warn: `buyer's total ₹${stated} ≠ items ₹${total} + delivery ₹${ship}` } : {}) });
}
// ---- Orders the buyer cancelled on the website
const retryRefund = [];
const CANCEL_NOTE = 'Cancelled by the buyer on the website';
// Refund figures are Razorpay's own (the order inbox works them out from Razorpay after every refund).
const paidOf = (lead) => [lead.payment?.status === 'paid' ? lead.payment.amount : 0, ...(lead.extra_payments || []).map((x) => x.amount)].reduce((a, x) => a + (Number(x) || 0), 0);
// More paid than refunded: a payment landed after the cancel was last checked. Treated as not finished.
const owes = (lead) => paidOf(lead) > (Number(lead.refunded_total) || 0) + 0.001;
const refundLine = (lead) => {
  const got = Number(lead.refunded_total) || 0;
  if (lead.refund_pending || owes(lead)) return `${got > 0 ? `₹${got} refunded so far, ` : ''}refund not finished${lead.refund_error ? ` (${String(lead.refund_error).slice(0, 120)})` : ''}`;
  if (lead.awaiting_capture) return 'a payment is still being processed by Razorpay; it is refunded automatically once it goes through';
  return got > 0 ? `refunded ₹${got} automatically` : lead.refund_checked && !paidOf(lead) ? 'nothing was paid' : 'refund not checked yet';
};
if (cancelledFile && fs.existsSync(cancelledFile)) {
  const recent = Date.now() - 30 * 86400e3;
  for (const lead of listOf(JSON.parse(fs.readFileSync(cancelledFile, 'utf8'))) || []) {
    if (lead?.cancel?.by !== 'buyer' || !(Date.parse(lead.cancel.at) > recent)) continue;
    let fields = lead.fields ?? {};
    const p = parseOrder(asText(fields));
    if (p.error) { report.push({ leadId: lead.id, action: 'cancelled by buyer, not readable', why: p.error, refundStatus: refundLine(lead) }); continue; }
    // Ask the inbox to check again: refunds not finished, payments still being processed, or not checked yet.
    if (lead.refund_pending || lead.awaiting_capture || !lead.refund_checked || owes(lead)) retryRefund.push(lead.id);
    const at = new Date().toISOString(), refundStatus = refundLine(lead), sr = stockroomOrder(p.id);
    const hist = { status: 'cancelled', at, by: 'website inbox', note: `${CANCEL_NOTE} at ${lead.cancel.at}` };
    if (!sr) {
      const total = p.lines.reduce((a, l) => a + n(l.qty) * n(l.price), 0);
      writes.push({ op: 'set', collection: 'orders', doc_id: p.id, data: { code: p.code, lines: p.lines, customer: p.customer, raw: p.raw, total,
        shippingCharged: shipDefault(p, total), status: 'cancelled', cancelReason: CANCEL_NOTE, createdAt: at, updatedAt: at,
        history: [{ status: 'new', at: lead.created_at || at, by: 'website inbox' }, hist], source: 'website', leadId: lead.id } });
      report.push({ leadId: lead.id, orderId: p.id, action: 'cancelled by buyer before import', customer: p.customer.name, refundStatus });
    } else if (sr.doc.status === 'new' && sr.version == null) {
      // Without the version the update could overwrite a confirm the owner made at the same moment.
      report.push({ leadId: lead.id, orderId: p.id, action: 'cancelled by buyer, not marked', customer: p.customer.name, refundStatus,
        stop: `the buyer cancelled at ${lead.cancel.at}. Open it in the Stockroom and press Cancel order; don't send it.` });
    } else if (sr.doc.status === 'new') {
      writes.push({ op: 'update', collection: 'orders', doc_id: p.id, if_version: sr.version,
        data: { status: 'cancelled', cancelReason: CANCEL_NOTE, updatedAt: at, history: [...(Array.isArray(sr.doc.history) ? sr.doc.history : []), hist] } });
      report.push({ leadId: lead.id, orderId: p.id, action: 'cancelled by buyer', customer: p.customer.name, refundStatus });
    } else if (sr.doc.status !== 'cancelled') {
      report.push({ leadId: lead.id, orderId: p.id, action: 'cancelled by buyer after you confirmed', customer: p.customer.name, refundStatus,
        stop: `the buyer cancelled at ${lead.cancel.at} and was refunded: don't send it. Open it in the Stockroom and press Cancel order to put the stock back.` });
    } else if (lead.refund_pending || lead.awaiting_capture || owes(lead)) {
      report.push({ leadId: lead.id, orderId: p.id, action: 'cancelled by buyer, refund pending', refundStatus });
    }
  }
}
fs.writeFileSync(outFile, JSON.stringify({ writes, report, retryRefund }, null, 2));
const cancels = report.filter((r) => String(r.action).startsWith('cancelled by buyer')).length;
console.log(`${leads.length} lead(s): ${writes.length} Stockroom write(s), ${cancels} buyer cancellation(s), ${report.length - cancels} other report line(s)`);
for (const r of report) console.log(' -', JSON.stringify(r));
