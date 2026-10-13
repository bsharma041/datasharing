// TadaBoo Stockroom: UI + data layer.
// Every business event (purchase, sale, stock correction) is ONE db document.
// Stock and costs are derived from those events in calc.js on every snapshot.
import {
  landedLines, avgCosts, stockLevels, expandSale, saleTotals, summary,
  status, bagCapacity, kitPieces, suggestPackaging, inr,
} from './calc.js';

// ---------------------------------------------------------------- state
const COLLS = ['items', 'bags', 'purchases', 'sales', 'adjustments', 'orders'];
const S = {
  db: null, downloads: null, ready: false, conn: 'connecting', error: null,
  items: [], bags: [], purchases: [], sales: [], adjustments: [], orders: [],
  settings: { giftKit: [], pouchKit: [], threshold: null, lowProduct: 5, lowPackaging: 10 },
  loaded: new Set(),
  tab: 'home', period: 'month',
  stock: { type: 'product', q: '', filter: 'all', archived: false, sort: 'category', dir: 'asc', cat: '' },
  more: 'history', historyLimit: 60,
  sell: null, buy: null, setDraft: null, ord: null,
  sheet: null,
};
let D = {}; // derived

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => (v === '' || v == null || !Number.isFinite(+v) ? 0 : +v);
const nOrNull = (v) => (v === '' || v == null || !Number.isFinite(+v) ? null : +v);
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const nowIso = () => new Date().toISOString();
const pct = (x) => `${Math.round(x * 100)}%`;
// Returns escaped HTML: dates can be written by Claude or another device.
const fmtDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return s ? esc(s) : 'no date';
  return `${+m[3]} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m[2] - 1] || '?'} ${m[1]}`;
};
const negative = (...vals) => vals.some((v) => n(v) < 0);
const changedFields = (now, was) => Object.fromEntries(Object.entries(now).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(was[k])));
const str = (v) => String(v ?? ''); // fields written elsewhere may not be strings
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------- derived
function derive() {
  const items = S.items, bags = S.bags;
  const itemsById = Object.fromEntries(items.map((i) => [i.id, i]));
  const bagsById = Object.fromEntries(bags.map((b) => [b.id, b]));
  const costs = avgCosts(items, S.purchases);
  const stock = stockLevels(items, S.purchases, S.sales, S.adjustments, bags);
  const lowAt = (it) => it.lowAt ?? (it.type === 'packaging' ? S.settings.lowPackaging ?? 10 : S.settings.lowProduct ?? 5);
  const st = (it) => status(stock[it.id], lowAt(it));
  const active = items.filter((i) => !i.archived);
  const t = today();
  const range = S.period === 'month' ? { from: t.slice(0, 8) + '01', to: t.slice(0, 8) + '31' } : {};
  const sum = summary(S.sales, costs, bags, range);
  const purchaseTotal = (p) => landedLines(p).reduce((a, l) => a + l.qty * l.landed, 0);
  const spent = S.purchases.filter((p) => !range.from || (p.date >= range.from && p.date <= range.to)).reduce((a, p) => a + purchaseTotal(p), 0);
  const stockValue = active.reduce((a, i) => a + Math.max(0, stock[i.id] || 0) * (costs[i.id] || 0), 0);  const alerts = active.filter((i) => st(i) !== 'ok').sort((a, b) => (stock[a.id] || 0) - (stock[b.id] || 0));
  const capacity = bags.filter((b) => !b.archived).map((b) => ({ bag: b, ...bagCapacity(b, stock, itemsById) })).sort((a, b) => a.count - b.count);
  D = { itemsById, bagsById, costs, stock, lowAt, st, active, sum, spent, stockValue, alerts, capacity, purchaseTotal };
}
// Records can be written by Claude or another device, so a name may be missing.
const nameOf = (x) => (x?.name ? String(x.name) : '(no name)');
const byName = (a, b) => nameOf(a).localeCompare(nameOf(b));
const itemName = (id) => (D.itemsById[id] ? nameOf(D.itemsById[id]) : '(deleted item)');
const bagName = (id) => (D.bagsById[id] ? nameOf(D.bagsById[id]) : '(deleted bag)');

// ---------------------------------------------------------------- db
async function connect() {
  let db = null;
  if (window.claude?.use) {
    try { db = await window.claude.use('db'); S.downloads = await window.claude.use('downloads'); }
    catch (e) { console.error(e); db = null; }
  } else if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    db = (await import('./devdb.js')).createDevDb(); // local testing only, never published
    S.downloads = { save: async ({ filename }) => { console.log('download', filename); return { status: 'saved' }; } };
  }
  if (!db) { S.conn = 'off'; renderAll(); return; }
  S.db = db;
  for (const c of COLLS) {
    db.collection(c).onSnapshot((snap) => {
      S[c] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      S.loaded.add(c); S.conn = 'live'; onData();
    }, (e) => { S.conn = 'err'; S.error = e; S.loaded.add(c); onData(); }); // show what loaded, flagged, instead of spinning forever
  }
  db.doc('settings/web').onSnapshot((snap) => { S.web = snap.exists ? snap.data() : {}; onData(); }, () => {});
  db.doc('settings/main').onSnapshot((snap) => {
    if (snap.exists) S.settings = { ...S.settings, ...snap.data() };
    if (!S.setDirty) S.setDraft = null; // show outside changes unless the owner is mid-edit
    S.loaded.add('settings'); onData();
  }, (e) => { S.conn = 'err'; S.error = e; S.loaded.add('settings'); onData(); });
}
function onData() {
  S.ready = S.loaded.size >= COLLS.length + 1;
  derive(); // numbers stay current even while the screen redraw waits for typing to finish
  scheduleRender();
}

const errText = (e) => ({
  quota_exceeded: 'Storage is full. Delete old history entries, then try again.',
  invalid_argument: 'This entry could not be saved. You may only have view access to this stockroom.',
  revoked: 'Access to this stockroom was removed. Reload the page.',
}[e?.code] || 'Could not save. Check your connection and try again.');

/** Run one db write; retry once on a transient error. Returns true on success. */
async function write(fn, okMsg) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await fn(); if (okMsg) toast(okMsg); return true; } catch (e) {
      if (e?.code === 'unavailable' && attempt === 0) { await new Promise((r) => setTimeout(r, 300 + Math.random() * 500)); continue; }
      console.error(e); toast(errText(e), true); return false;
    }
  }
  return false;
}
const newId = (c) => S.db.collection(c).doc().id;
const setDoc = (c, id, body) => S.db.collection(c).doc(id).set(body);
const delDoc = (c, id) => S.db.collection(c).doc(id).delete();

// ---------------------------------------------------------------- render loop
let pending = false;
const editing = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
function scheduleRender() { if (editing()) { pending = true; return; } renderAll(); }
// Wait past the click that caused the blur, so a deferred re-render never swallows that tap.
document.addEventListener('focusout', () => setTimeout(() => { if (pending && !editing()) { pending = false; renderAll(); } }, 300));

// Redraws replace DOM nodes; put keyboard focus back on the equivalent control afterwards.
function focusKey() {
  const a = document.activeElement;
  if (!a || a === document.body) return null;
  const scope = a.closest('[data-draft]')?.dataset.draft || '';
  if (a.dataset.bind) return { scope, sel: `[data-bind="${CSS.escape(a.dataset.bind)}"]` };
  if (a.dataset.act) return { scope, sel: `[data-act="${CSS.escape(a.dataset.act)}"]${a.dataset.id ? `[data-id="${CSS.escape(a.dataset.id)}"]` : ''}${a.dataset.v ? `[data-v="${CSS.escape(a.dataset.v)}"]` : ''}` };
  return null;
}
function keepFocus(fn) {
  const k = focusKey(); fn();
  if (!k || (document.activeElement && document.activeElement !== document.body)) return; // focus survived or moved on purpose
  const root = k.scope ? document.querySelector(`[data-draft="${k.scope}"]`) : document;
  const el = (root || document).querySelector(k.sel);
  if (el && el !== document.activeElement) el.focus({ preventScroll: true });
}
function renderAll() { keepFocus(renderAllNow); }
function renderAllNow() {
  derive();
  renderSync(); renderNav();
  const v = $('#view');
  if (S.conn === 'off') v.innerHTML = `<div class="empty card"><h3>Sign in to see your stockroom</h3><p>Your stock and sales are stored in your Claude account. Open this page on claude.ai while signed in.</p></div>`;
  else if (!S.ready) v.innerHTML = `<div class="empty"><h3>Opening your stockroom…</h3><p>Loading stock, sales and purchases.</p></div>`;
  else v.innerHTML = ({ home: viewHome, orders: viewOrders, stock: viewStock, sell: viewSell, buy: viewBuy, more: viewMore })[S.tab]();
  renderSheetNow();
}
function renderSync() {
  const m = { connecting: ['', 'Connecting…'], live: ['live', 'Synced'], err: ['err', 'Sync problem: reload'], off: ['err', 'Offline'] }[S.conn];
  $('#sync').innerHTML = `<span class="dot ${m[0]}"></span><span>${m[1]}</span>`;
}

const ICONS = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  stock: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4"/><path d="M3 17l9 4 9-4"/>',
  sell: '<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  orders: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 12h6M9 16h4"/>',
  buy: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
};
const TABS = [['home', 'Home'], ['orders', 'Orders'], ['stock', 'Stock'], ['sell', 'Sell'], ['buy', 'Buy'], ['more', 'More']];
function renderNav() {
  $('#nav').innerHTML = TABS.map(([k, l]) => `<button class="tab" data-act="tab" data-v="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>
    <span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg></span>${l}</button>`).join('');
}

// ---------------------------------------------------------------- shared bits
const chipFor = (s) => ({ ok: '<span class="chip ok">In stock</span>', low: '<span class="chip low">Low</span>', out: '<span class="chip out">Out</span>' }[s]);
const money = (v, cls = '') => `<span class="num ${cls}">${inr(v)}</span>`;
function itemOptions(selected, { type, includeNew } = {}) {
  const groups = {};
  for (const it of S.items) {
    if (type && it.type !== type) continue;
    if (it.archived && it.id !== selected) continue;
    const g = it.type === 'packaging' ? 'Packaging' : it.category || 'Other';
    (groups[g] ||= []).push(it);
  }
  const opts = Object.keys(groups).sort().map((g) => `<optgroup label="${esc(g)}">${groups[g].sort((a, b) => byName(a, b)).map((it) =>
    `<option value="${esc(it.id)}" ${it.id === selected ? 'selected' : ''}>${esc(nameOf(it))} (${D.stock[it.id] ?? 0})</option>`).join('')}</optgroup>`).join('');
  const gone = selected && selected !== '__new' && !S.items.some((i) => i.id === selected)
    ? `<option value="${esc(selected)}" selected>(deleted item): choose another</option>` : '';
  return `<option value="" ${!selected ? 'selected' : ''} disabled>Choose an item…</option>${gone}${includeNew ? `<option value="__new" ${selected === '__new' ? 'selected' : ''}>+ New item…</option>` : ''}${opts}`;
}
function bagOptions(selected) {
  return `<option value="" disabled ${!selected ? 'selected' : ''}>Choose a bag…</option>` + S.bags.filter((b) => !b.archived || b.id === selected)
    .sort((a, b) => byName(a, b))
    .map((b) => `<option value="${esc(b.id)}" ${b.id === selected ? 'selected' : ''}>${esc(nameOf(b))} · ${inr(b.price)}</option>`).join('');
}
// ---- categories: picked from the categories already in use, or a new one typed once
// Every category in use, A–Z, one spelling each (case and extra spaces ignored). `keep` is listed with its exact spelling.
function categoryList(keep = '') {
  const seen = new Map();
  const saved = Array.isArray(S.settings.categories) ? S.settings.categories : []; // added in More → Categories, maybe still empty
  for (const c of [str(keep).trim(), ...S.items.map((i) => str(i.category).trim()), ...saved.map((x) => str(x).trim())]) {
    if (c && c !== '__new' && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
// The category to store: the picked one, or the typed new name — reusing an existing spelling if it only differs in case/spaces.
function resolveCategory(pick, typed) {
  if (pick !== '__new') return str(pick).trim();
  const t = str(typed).trim().replace(/\s+/g, ' ');
  return categoryList().find((c) => c.toLowerCase() === t.toLowerCase()) || t;
}
// `choose`: start on a "Choose a category…" prompt instead of "No category" (bulk move must be a deliberate choice).
// `exclude`: leave one category out (e.g. the one being removed).
const categoryPicker = (bind, value, textBind, textVal, choose = false, exclude = '') => `<select class="input" data-bind="${bind}" aria-label="Category">
    ${choose ? `<option value="__choose" disabled ${value === '__choose' ? 'selected' : ''}>Choose a category…</option>` : ''}
    <option value="" ${!value ? 'selected' : ''}>No category</option>
    ${categoryList(value === '__choose' ? '' : value).filter((c) => !exclude || c.toLowerCase() !== exclude.toLowerCase()).map((c) => `<option value="${esc(c)}" ${c === value ? 'selected' : ''}>${esc(c)}</option>`).join('')}
    <option value="__new" ${value === '__new' ? 'selected' : ''}>+ New category…</option></select>
  ${value === '__new' ? `<input class="input" data-bind="${textBind}" value="${esc(textVal || '')}" placeholder="New category name" aria-label="New category name" autocomplete="off">` : ''}`;

const field = (label, bind, val, { type = 'text', ph = '', rupee = false, attrs = '' } = {}) =>
  `<label class="f">${label}<span class="${rupee ? 'prefix' : ''}"><input class="input" data-bind="${bind}" value="${esc(val ?? '')}" placeholder="${esc(ph)}"
   ${type === 'number' ? 'type="number" inputmode="decimal" step="any" min="0"' : `type="${type}"`} ${attrs}></span></label>`;
const kitLines = (draftKey, path, lines, type) => `${lines.map((l, i) => `<div class="row">
    <select class="input grow" data-bind="${path}.${i}.itemId" data-draft="${draftKey}" aria-label="Packaging item">${itemOptions(l.itemId, { type })}</select>
    <div class="qty"><input class="input" type="number" inputmode="numeric" min="1" data-bind="${path}.${i}.qty" value="${esc(l.qty)}" aria-label="Quantity"></div>
    <button class="icon-btn" data-act="rmLine" data-path="${path}" data-i="${i}" aria-label="Remove">×</button></div>`).join('')}
  <button class="btn ghost sm" data-act="addLine" data-path="${path}" data-kind="kit">+ Add piece</button>`;

// ---------------------------------------------------------------- HOME
function viewHome() {
  const s = D.sum, costTotal = s.itemCost + s.packCost + s.courier;
  const label = S.period === 'month' ? new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' }) : 'All time';
  const bar = (v, c) => (costTotal > 0 ? `<i style="width:${(v / costTotal) * 100}%;background:${c}"></i>` : '');
  const alerts = D.alerts.slice(0, 12);
  return `<div class="stack">
  <div class="section-head"><div><div class="eyebrow">Money</div><h2>${esc(label)}</h2></div>
    <div class="seg" role="group" aria-label="Period"><button data-act="period" data-v="month" aria-pressed="${S.period === 'month'}">This month</button><button data-act="period" data-v="all" aria-pressed="${S.period === 'all'}">All time</button></div></div>
  ${S.orders.some((o) => o.status === 'new') ? `<button class="card li" data-act="tab" data-v="orders" style="border:0"><div class="grow"><div class="name">${S.orders.filter((o) => o.status === 'new').length} website order${S.orders.filter((o) => o.status === 'new').length === 1 ? '' : 's'} to confirm</div><div class="meta">Confirming updates stock and profit</div></div><span class="chip check">Orders</span></button>` : ''}
  <div class="kpis">
    <div class="kpi hero"><span class="eyebrow">Profit</span><span class="v">${inr(s.profit)}</span><span class="small muted">${s.revenue > 0 ? `${pct(s.margin)} margin` : 'No sales yet'}</span></div>
    <div class="kpi"><span class="eyebrow">Revenue</span><span class="v">${inr(s.revenue)}</span><span class="small muted">${s.orders} order${s.orders === 1 ? '' : 's'}</span></div>
    <div class="kpi"><span class="eyebrow">Costs of sales</span><span class="v">${inr(costTotal)}</span><span class="small muted">items + packaging + courier</span></div>
    <div class="kpi"><span class="eyebrow">Stock value</span><span class="v">${inr(D.stockValue)}</span><span class="small muted">${inr(D.spent)} spent on stock ${S.period === 'month' ? 'this month' : 'so far'}</span></div>
  </div>
  ${costTotal > 0 ? `<div class="card stack"><div class="bars">${bar(s.itemCost, 'var(--accent)')}${bar(s.packCost, 'var(--teal)')}${bar(s.courier, 'var(--pink)')}</div>
    <div class="legend"><span><b style="background:var(--accent)"></b>Items ${inr(s.itemCost)}</span><span><b style="background:var(--teal)"></b>Packaging ${inr(s.packCost)}</span><span><b style="background:var(--pink)"></b>Courier ${inr(s.courier)}</span></div></div>` : ''}
  <div class="two-col">
    <div class="card stack"><div class="section-head"><h3>Needs a refill</h3><span class="small muted">${D.alerts.length} item${D.alerts.length === 1 ? '' : 's'}</span></div>
      ${alerts.length ? `<div class="tbl" id="refill-list"><div class="trow thead r4"><span class="l">Item</span><span class="l">Category</span><span>Refill at</span><span>Stock</span></div>
        ${alerts.map((it) => {
          const s = D.st(it), cat = it.type === 'packaging' ? 'Packaging' : str(it.category) || 'Other', stk = n(D.stock[it.id]);
          return `<button class="li trow r4" data-act="editItem" data-id="${esc(it.id)}" aria-label="${esc(`${nameOf(it)}. ${cat}. Refill at ${D.lowAt(it)}. ${stk} in stock, ${SHORT[s][1]}.`)}">
        <span data-col="name"><span class="name">${esc(nameOf(it))}</span></span>
        <span data-col="type" class="ttype">${esc(cat)}</span>
        <span data-col="refill" class="tc">${esc(D.lowAt(it))}</span>
        <span data-col="stock" class="tc tstock"><span class="stockno st-${s}">${esc(stk)}</span>${chipXs(s)}</span></button>`;
        }).join('')}</div>
        ${D.alerts.length > alerts.length ? `<button class="btn ghost sm" data-act="gotoLow">See all ${D.alerts.length}</button>` : ''}`
        : '<p class="muted">Everything is above its refill level.</p>'}</div>
    <div class="card stack"><div class="section-head"><h3>Bags you can make now</h3></div>
      ${D.capacity.length ? `<div class="list">${D.capacity.map((c) => `<button class="li" data-act="editBag" data-id="${esc(c.bag.id)}">
        <div class="grow"><div class="name">${esc(nameOf(c.bag))}</div><div class="meta">${c.missing.length ? `Missing: ${esc(c.missing.map(itemName).join(', '))}` : c.limitingItemId ? `Limited by ${esc(itemName(c.limitingItemId))}` : ''}</div></div>
        <div class="right"><span class="stockno">${c.count}</span>${c.count === 0 ? '<span class="chip out">Can’t make</span>' : c.count <= 2 ? '<span class="chip low">Low</span>' : '<span class="chip ok">OK</span>'}</div></button>`).join('')}</div>`
        : '<p class="muted">No gift bags set up yet. Add them under More → Gift bags.</p>'}</div>
  </div></div>`;
}

// ---------------------------------------------------------------- STOCK
function viewStock() {
  fixStockCat(); // e.g. after moving every item out of the chosen category
  const f = S.stock;
  const ofType = S.items.filter((i) => i.type === f.type && !i.archived);
  const count = (k) => ofType.filter((i) => (k === 'check' ? i.check : D.st(i) === k)).length;
  return `<div class="stack">
  <div class="section-head"><div><div class="eyebrow">Inventory</div><h2>Stock</h2></div>
    <div class="row">${S.bulk ? '' : '<button class="btn ghost sm" data-act="bulkStart">Select</button>'}<button class="btn primary" data-act="newItem">+ Add item</button></div></div>
  <div class="seg" role="group" aria-label="Item type"><button data-act="stockType" data-v="product" aria-pressed="${f.type === 'product'}">Products</button><button data-act="stockType" data-v="packaging" aria-pressed="${f.type === 'packaging'}">Packaging</button></div>
  <input class="input" type="search" id="stock-q" data-bind="q" data-draft="stockFilter" value="${esc(f.q)}" placeholder="Search by name, category or supplier" aria-label="Search stock">
  <div class="filters" role="group" aria-label="Filter">
    ${[['all', `All ${ofType.length}`], ['refill', `Refill ${ofType.filter((i) => D.st(i) !== 'ok').length}`], ['low', `Low ${count('low')}`], ['out', `Out ${count('out')}`], ['check', `⚠ Check ${count('check')}`]].map(([k, l]) => `<button data-act="stockFilter" data-v="${k}" aria-pressed="${f.filter === k}">${l}</button>`).join('')}
    <button data-act="stockArchived" aria-pressed="${f.archived}">Archived</button>
  </div>
  <div class="sortbar"><label for="stock-cat">Category</label>
    <select class="input" id="stock-cat" data-bind="cat" data-draft="stockFilter">${stockCatOptions()}</select></div>
  <div class="sortbar"><label for="stock-sort">Sort by</label>
    <select class="input" id="stock-sort" data-bind="sort" data-draft="stockFilter">${Object.entries(SORTS).map(([k, l]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <button class="icon-btn" data-act="sortDir" aria-label="Sorted ${dirWords(f.sort, f.dir)}. Tap to reverse">${f.dir === 'asc' ? '↑' : '↓'}</button></div>
  <div class="card tbl-card" id="stock-list">${stockList()}</div>
  ${S.bulk ? `<div class="bulk-space"></div>${bulkBar()}` : ''}
  </div>`;
}
// ---- select several items and move them to one category
function bulkBar() {
  const b = S.bulk, nSel = b.ids.size;
  return `<div id="bulkbar" class="bulkbar" data-draft="bulk" role="region" aria-label="Move selected items">
    <div class="row between"><b class="num" aria-live="polite">${nSel} selected</b>
      <span class="row"><button class="btn ghost sm" data-act="bulkAll">Select all shown</button><button class="btn ghost sm" data-act="bulkCancel">Cancel</button></span></div>
    <div class="bulkmove"><label class="f grow">Move to category${categoryPicker('bulkCat', b.bulkCat, 'bulkNew', b.bulkNew, true)}</label>
      <button class="btn primary" data-act="bulkApply">Move</button></div></div>`;
}
// ---- Stock category filter: the categories of the items on the current tab (Products or Packaging), with counts.
const catKey = (it) => str(it.category).trim().toLowerCase();
const stockTabItems = () => S.items.filter((i) => i.type === S.stock.type && (S.stock.archived ? i.archived : !i.archived));
function stockCats() {
  const counts = new Map(); let none = 0;
  for (const it of stockTabItems()) {
    const c = str(it.category).trim();
    if (!c) { none++; continue; }
    const k = c.toLowerCase(), e = counts.get(k) || { name: c, n: 0 }; e.n++; counts.set(k, e);
  }
  return { cats: [...counts.values()].sort((a, b) => a.name.localeCompare(b.name)), none };
}
function stockCatOptions() {
  const { cats, none } = stockCats(), f = S.stock, all = stockTabItems().length;
  return `<option value="" ${!f.cat ? 'selected' : ''}>All categories (${all})</option>`
    + cats.map((c) => `<option value="${esc(c.name)}" ${f.cat && f.cat.toLowerCase() === c.name.toLowerCase() ? 'selected' : ''}>${esc(c.name)} (${c.n})</option>`).join('')
    + (none ? `<option value="__none" ${f.cat === '__none' ? 'selected' : ''}>No category (${none})</option>` : '');
}
// A chosen category that doesn't exist on this tab (e.g. after switching to Packaging) falls back to All.
function fixStockCat() {
  const f = S.stock; if (!f.cat) return;
  const { cats, none } = stockCats();
  if (f.cat === '__none' ? !none : !cats.some((c) => c.name.toLowerCase() === f.cat.toLowerCase())) f.cat = '';
}
const SORTS = { category: 'Category (A–Z)', name: 'Name (A–Z)', cost: 'Cost', sell: 'Sells', margin: 'Margin', stock: 'Stock' };
const SORT_DIR = { category: 'asc', name: 'asc', cost: 'desc', sell: 'desc', margin: 'desc', stock: 'asc' }; // the direction most useful first
const TEXT_SORT = { category: true, name: true };
const dirWords = (key, dir) => (TEXT_SORT[key] ? (dir === 'asc' ? 'A–Z' : 'Z–A') : dir === 'asc' ? 'lowest first' : 'highest first');
// The numbers shown in an item's row; null means not set. Values written elsewhere may be text, so coerce.
function rowVals(it) {
  const c = D.costs[it.id], cost = Number.isFinite(c) ? c : null, sell = nOrNull(it.sellPrice);
  return { cost, sell, margin: sell > 0 && cost != null ? (sell - cost) / sell : null, stock: n(D.stock[it.id]) };
}
function sortItems(list, key, dir) {
  const sign = dir === 'asc' ? 1 : -1;
  if (key === 'name') return list.sort((a, b) => sign * byName(a, b));
  if (key === 'category') {
    return list.sort((a, b) => {
      const x = str(a.category), y = str(b.category);
      if (!x !== !y) return x ? -1 : 1; // no category ("Other") goes last either way
      return sign * x.localeCompare(y) || byName(a, b);
    });
  }
  // Items without a value always go last, whichever direction is chosen.
  return list.sort((a, b) => {
    const x = rowVals(a)[key], y = rowVals(b)[key];
    if (x == null || y == null) return x == null && y == null ? byName(a, b) : x == null ? 1 : -1;
    return sign * (x - y) || byName(a, b);
  });
}
const dash = '<span class="unset" aria-hidden="true">–</span>';
const money2 = (v) => inr(v, v < 100 && v % 1 ? 2 : 0); // paise shown only where they matter
const costText = (v) => (v == null ? dash : inr(v, v < 100 ? 2 : 0));
const marginText = (m) => {
  if (m == null) return dash;
  const r = Math.round(m * 100); // colour follows the number shown
  return `<span class="${r < 0 ? 'neg' : r < 30 ? 'warnc' : 'pos'}">${r}%</span>`;
};
// What a screen reader says for a row (the visible row has no column names).
const rowLabel = (it, v, s) => `${nameOf(it)}. Cost ${v.cost == null ? 'not set' : costPlain(v.cost)}. Sells ${v.sell == null ? 'not set' : money2(v.sell)}. Margin ${v.margin == null ? 'not set' : `${Math.round(v.margin * 100)}%`}. ${v.stock} in stock, ${SHORT[s][1]}.${it.check ? ' Needs checking.' : ''}`;
const costPlain = (v) => inr(v, v < 100 ? 2 : 0);
const SHORT = { ok: ['ok', 'OK'], low: ['low', 'Low'], out: ['out', 'Out'] };
const chipXs = (s) => `<span class="chip xs ${SHORT[s][0]}">${SHORT[s][1]}</span>`;
// The table alone, so typing in search updates it without rebuilding the search box.
// The items the Stock table currently shows (tab, search, filters, category), in display order.
function shownStockItems() {
  const f = S.stock, q = f.q.trim().toLowerCase();
  let list = S.items.filter((i) => i.type === f.type && (f.archived ? i.archived : !i.archived));
  if (q) list = list.filter((i) => `${str(i.name)} ${str(i.category)} ${str(i.supplier)}`.toLowerCase().includes(q));
  if (f.filter === 'low') list = list.filter((i) => D.st(i) === 'low');
  if (f.filter === 'out') list = list.filter((i) => D.st(i) === 'out');
  if (f.filter === 'refill') list = list.filter((i) => D.st(i) !== 'ok');
  if (f.cat === '__none') list = list.filter((i) => !catKey(i));
  else if (f.cat) list = list.filter((i) => catKey(i) === f.cat.toLowerCase());
  if (f.filter === 'check') list = list.filter((i) => i.check);
  return sortItems(list, f.sort, f.dir);
}
function stockList() {
  const f = S.stock, list = shownStockItems(), bulk = S.bulk;
  if (!list.length) return `<div class="empty"><h3>${S.items.length ? 'Nothing matches' : 'No items yet'}</h3><p>${S.items.length ? 'Try a different search or filter.' : 'Tap “+ Add item” or record a purchase under Buy.'}</p></div>`;
  const hcell = (k, label, cls = '') => {
    const on = f.sort === k, arrow = on ? (f.dir === 'asc' ? '↑' : '↓') : '';
    const spoken = on ? `${label}, sorted ${dirWords(k, f.dir)}. Tap to reverse` : `Sort by ${label}`;
    return `<button class="${cls}" data-act="sortBy" data-v="${k}" aria-pressed="${on}" aria-label="${spoken}">${label}${arrow ? `<span class="arr" aria-hidden="true">${arrow}</span>` : ''}</button>`;
  };
  const head = `<div class="trow thead">${hcell('name', 'Item', 'l')}${hcell('cost', 'Cost')}${hcell('sell', 'Sells')}${hcell('margin', 'Margin')}${hcell('stock', 'Stock')}</div>`;
  const grouped = f.sort === 'category' && f.type === 'product';
  let lastCat = null;
  return `<div class="tbl">${head}${list.map((it) => {
    const cat = str(it.category), v = rowVals(it), s = D.st(it);
    const catHead = grouped && cat !== lastCat ? `<div class="cathead eyebrow">${esc((lastCat = cat) || 'Other')}</div>` : '';
    const cells = `<span data-col="cost" class="tc">${costText(v.cost)}</span>
      <span data-col="sell" class="tc">${v.sell == null ? dash : money2(v.sell)}</span>
      <span data-col="margin" class="tc">${marginText(v.margin)}</span>
      <span data-col="stock" class="tc tstock"><span class="stockno st-${s}">${esc(v.stock)}</span>${chipXs(s)}</span>`;
    const name = `<span class="name">${esc(nameOf(it))}</span>${it.check ? '<span class="chip check xs">⚠ check</span>' : ''}`;
    if (bulk) { // select mode: the row ticks/unticks instead of opening the editor
      const on = bulk.ids.has(it.id);
      return `${catHead}<div class="li trow pick${on ? ' on' : ''}" role="checkbox" aria-checked="${on}" tabindex="0" data-act="bulkToggle" data-id="${esc(it.id)}" aria-label="${esc(nameOf(it))}">
        <span data-col="name" class="pickname"><input type="checkbox" tabindex="-1" aria-hidden="true" ${on ? 'checked' : ''}><span>${name}</span></span>${cells}</div>`;
    }
    return `${catHead}<button class="li trow" data-act="editItem" data-id="${esc(it.id)}" aria-label="${esc(rowLabel(it, v, s))}">
      <span data-col="name">${name}</span>${cells}</button>`;
  }).join('')}</div>`;
}

function openItemSheet(id) {
  const it = id ? D.itemsById[id] : null;
  S.sheet = { kind: 'item', id, draft: it ? {
    name: it.name || '', type: it.type || 'product', category: str(it.category).trim(), newCat: '', unit: it.unit || 'pcs', sellPrice: it.sellPrice ?? '', lowAt: it.lowAt ?? '',
    costOverride: it.costOverride ?? '', supplier: it.supplier || '', note: it.note || '', check: !!it.check, stockCount: D.stock[id] ?? 0, stockAtOpen: D.stock[id] ?? 0,
  } : { name: '', type: S.stock.type, category: '', newCat: '', unit: 'pcs', sellPrice: '', lowAt: '', costOverride: '', supplier: '', note: '', check: false, stockCount: 0, stockAtOpen: 0 } };
  S.sheet.orig = JSON.stringify(S.sheet.draft);
  renderSheet();
}
function sheetItem() {
  const { id, draft: d } = S.sheet, it = id ? D.itemsById[id] : null;
  const avg = id ? avgCosts([{ id }], S.purchases)[id] : null;
  // Its own stock entries (opening stock, manual counts) don't block deleting a mistaken item;
  // purchases, sales, bags and kits do, because past money depends on them.
  const ownAdj = id ? S.adjustments.filter((a) => a.itemId === id).length : 0;
  const refs = id ? refsOf(id) - ownAdj : 0;
  return `<div class="section-head"><h2>${it ? 'Edit item' : 'New item'}</h2><button class="icon-btn" data-act="closeSheet" aria-label="Close">×</button></div>
  ${it?.check && it.note ? `<div class="warn">⚠ ${esc(it.note)}</div>` : ''}
  ${field('Name', 'name', d.name, { ph: 'e.g. Rabbit Eraser', attrs: 'id="item-name" autocomplete="off"' })}
  <div class="seg" role="group" aria-label="Type"><button data-act="setDraft" data-k="type" data-v="product" aria-pressed="${d.type === 'product'}">Product</button><button data-act="setDraft" data-k="type" data-v="packaging" aria-pressed="${d.type === 'packaging'}">Packaging</button></div>
  <label class="f catf">Category${categoryPicker('category', d.category, 'newCat', d.newCat)}</label>
  <div class="grid2">
    ${field(it ? 'Stock count now' : 'Stock you have now', 'stockCount', d.stockCount, { type: 'number' })}
    ${field(`Refill when at or below`, 'lowAt', d.lowAt, { type: 'number', ph: `default ${d.type === 'packaging' ? S.settings.lowPackaging ?? 10 : S.settings.lowProduct ?? 5}` })}
    ${field('Selling price', 'sellPrice', d.sellPrice, { type: 'number', rupee: true, ph: d.type === 'packaging' ? 'not sold' : 'not set' })}
    ${avg == null ? field('Cost per piece', 'costOverride', d.costOverride, { type: 'number', rupee: true, ph: 'not bought yet' })
      : `<label class="f">Cost per piece<span class="input num" aria-readonly="true">${inr(avg, 2)}</span></label>`}
    ${field('Unit', 'unit', d.unit, { ph: 'pcs' })}
  </div>
  <p class="small muted">${avg == null ? 'Cost is used until you record a purchase of this item.' : 'Cost comes from your purchases, including GST and shipping.'} Changing the stock count saves a “Manual count” entry in History.</p>  ${field('Supplier', 'supplier', d.supplier, { ph: 'optional' })}
  <label class="f">Note<textarea class="input" rows="2" data-bind="note">${esc(d.note)}</textarea></label>
  <label class="switch"><input type="checkbox" data-bind="check" ${d.check ? 'checked' : ''}> Mark “⚠ check” (needs my review)</label>
  <button class="btn primary block" data-act="saveItem">Save item</button>
  ${it ? `<div class="row">
    <button class="btn ghost grow" data-act="archiveItem">${it.archived ? 'Restore from archive' : 'Archive (hide)'}</button>
    ${refs ? '' : `<button class="btn danger grow" data-act="deleteItem" data-confirm="Tap again to delete for good">Delete</button>`}</div>
    ${!refs && ownAdj ? `<p class="small muted">Deleting also removes its ${ownAdj} stock entr${ownAdj === 1 ? 'y' : 'ies'} (opening stock or counts).</p>` : ''}
    ${refs ? `<p class="small muted">Used in ${refs} record${refs === 1 ? '' : 's'}, so it can be archived but not deleted. Archiving keeps your past profit correct.</p>` : ''}` : ''}`;
}
function refsOf(id) {
  let c = 0;
  for (const p of S.purchases) if (p.lines?.some((l) => l.itemId === id)) c++;
  for (const s of S.sales) if (expandSale(s, S.bags).some((l) => l.itemId === id) || s.consumed?.some((l) => l.itemId === id) || s.packaging?.pieces?.some((l) => l.itemId === id)) c++;
  for (const a of S.adjustments) if (a.itemId === id) c++;
  for (const b of S.bags) if (b.contents?.some((l) => l.itemId === id)) c++;
  if ([...(S.settings.giftKit || []), ...(S.settings.pouchKit || [])].some((l) => l.itemId === id)) c++;
  return c;
}

// ---------------------------------------------------------------- SELL
const blankSell = () => ({ date: today(), lines: [], shippingCharged: '', courierCost: '', pack: 'none', customPieces: [], customer: '', note: '' });
const unitPriceOf = (l) => (l.t === 'bag' ? D.bagsById[l.id]?.price : D.itemsById[l.id]?.sellPrice) ?? 0;
function sellModel(d) {
  const lines = d.lines.filter((l) => l.id && n(l.qty) > 0).map((l) => (l.t === 'bag'
    ? { bagId: l.id, qty: n(l.qty), price: n(l.price), name: bagName(l.id) }
    : { itemId: l.id, qty: n(l.qty), price: n(l.price), name: itemName(l.id) }));
  // Unknown costs stay null so the app can fill them in later instead of freezing ₹0.
  const snap = (c) => (c == null ? null : +(+c).toFixed(4));
  const consumed = expandSale({ lines }, S.bags).map((c) => ({ ...c, cost: snap(D.costs[c.itemId]) }));
  const kit = d.pack === 'gift' ? S.settings.giftKit : d.pack === 'pouch' ? S.settings.pouchKit : d.pack === 'custom' ? d.customPieces.filter((p) => p.itemId && n(p.qty) > 0) : [];
  const pieces = kitPieces(kit, D.costs).map((p) => ({ ...p, cost: snap(p.cost) }));
  const noCost = [...new Set([...consumed, ...pieces].filter((c) => c.cost == null).map((c) => itemName(c.itemId)))];
  const kinds = new Set(lines.map((l) => (l.bagId ? 'bag' : 'item')));
  const sale = { date: d.date || today(), kind: kinds.size > 1 ? 'custom' : kinds.has('bag') ? 'bag' : 'items', lines, consumed,
    packaging: { mode: d.pack, pieces }, shippingCharged: n(d.shippingCharged), courierCost: n(d.courierCost), customer: d.customer.trim(), note: d.note.trim() };
  const need = {};
  for (const c of [...consumed, ...pieces]) need[c.itemId] = (need[c.itemId] || 0) + c.qty;
  const short = Object.entries(need).filter(([id, q]) => (D.stock[id] ?? 0) < q).map(([id, q]) => `${itemName(id)} (need ${q}, have ${D.stock[id] ?? 0})`);
  const noPrice = d.lines.filter((l) => l.t === 'item' && l.id && !l.priceEdited && D.itemsById[l.id]?.sellPrice == null).map((l) => itemName(l.id));
  return { sale, totals: saleTotals(sale, D.costs, S.bags), short, noCost, noPrice, orderValue: lines.reduce((a, l) => a + l.price, 0) };
}
function viewSell() {
  const d = (S.sell ||= blankSell());
  const m = sellModel(d), t = m.totals;
  const sug = suggestPackaging(m.orderValue, S.settings.threshold);
  return `<div class="stack" data-draft="sell">
  <div class="section-head"><div><div class="eyebrow">New order</div><h2>Record a sale</h2></div><button class="btn ghost sm" data-act="resetSell">Clear</button></div>
  <div class="two-col">
   <div class="stack">
    <div class="card stack"><h3>What did they buy?</h3>
      ${d.lines.map((l, i) => `<div class="line">
        <div class="row"><span class="chip plain">${l.t === 'bag' ? 'Gift bag' : 'Item'}</span><span class="grow"></span><button class="icon-btn" data-act="rmLine" data-path="lines" data-i="${i}" aria-label="Remove line">×</button></div>
        <select class="input" data-bind="lines.${i}.id" data-rerender aria-label="${l.t === 'bag' ? 'Gift bag' : 'Item'}">${l.t === 'bag' ? bagOptions(l.id) : itemOptions(l.id, { type: 'product' })}</select>
        <div class="row"><div class="qty"><button class="icon-btn" data-act="step" data-i="${i}" data-d="-1" aria-label="One less">−</button><input class="input" type="number" inputmode="numeric" min="1" data-bind="lines.${i}.qty" value="${esc(l.qty)}" aria-label="Quantity"><button class="icon-btn" data-act="step" data-i="${i}" data-d="1" aria-label="One more">+</button></div>
        <label class="f grow">Price for ${l.qty || 0}<span class="prefix"><input class="input" type="number" inputmode="decimal" step="any" min="0" data-bind="lines.${i}.price" value="${esc(l.price)}"></span></label></div>
      </div>`).join('') || '<p class="muted">Add a gift bag or single items. Mix both for a “Curate Your Own” order.</p>'}
      <div class="row"><button class="btn ghost grow" data-act="addSellLine" data-t="bag">+ Gift bag</button><button class="btn ghost grow" data-act="addSellLine" data-t="item">+ Single item</button></div>
    </div>
    <div class="card stack"><h3>Delivery</h3><div class="grid2">
      ${field('Shipping charged to customer', 'shippingCharged', d.shippingCharged, { type: 'number', rupee: true, ph: '0' })}
      ${field('Courier cost you paid', 'courierCost', d.courierCost, { type: 'number', rupee: true, ph: '0' })}</div></div>
    <div class="card stack"><div class="section-head"><h3>Packaging used</h3>${sug !== 'none' && sug !== d.pack ? `<button class="chip check" data-act="setPack" data-v="${sug}" style="border:0;cursor:pointer">Suggested: ${sug === 'gift' ? 'Gift kit' : 'Pouch'} · use</button>` : ''}</div>
      <div class="seg" role="group" aria-label="Packaging">${[['none', 'None'], ['gift', 'Gift kit'], ['pouch', 'Pouch'], ['custom', 'Custom']].map(([k, l]) => `<button data-act="setPack" data-v="${k}" aria-pressed="${d.pack === k}">${l}</button>`).join('')}</div>
      ${d.pack === 'gift' || d.pack === 'pouch' ? `<p class="small muted">Uses ${esc((d.pack === 'gift' ? S.settings.giftKit : S.settings.pouchKit).map((k) => `${k.qty} × ${itemName(k.itemId)}`).join(', ') || 'nothing yet: set the kit under More → Settings')}.</p>` : ''}
      ${d.pack === 'custom' ? kitLines('sell', 'customPieces', d.customPieces, 'packaging') : ''}
      ${S.settings.threshold == null ? '<p class="small muted">Set a gift-kit threshold under More → Settings to get a suggestion here.</p>' : ''}
    </div>
    <div class="card stack"><h3>Details</h3><div class="grid2">
      ${field('Date', 'date', d.date, { type: 'date' })}
      ${field('Customer', 'customer', d.customer, { ph: 'optional' })}</div>
      <label class="f">Note<input class="input" data-bind="note" value="${esc(d.note)}" placeholder="optional, e.g. Instagram order"></label></div>
   </div>
   <div class="card stack sticky" id="sell-preview">${sellPreview(m, t)}</div>
  </div></div>`;
}
function sellPreview(m, t) {
  return `<h3>This sale</h3>
    <div class="sum-row"><span>Revenue</span><span>${inr(t.revenue)}</span></div>
    <div class="sum-row muted"><span>Item cost</span><span>−${inr(t.itemCost)}</span></div>
    <div class="sum-row muted"><span>Packaging</span><span>−${inr(t.packCost)}</span></div>
    <div class="sum-row muted"><span>Courier</span><span>−${inr(t.courier)}</span></div>
    <div class="sum-row total"><span>Profit</span><span class="${t.profit >= 0 ? 'pos' : 'neg'}">${inr(t.profit)}</span></div>
    ${t.revenue > 0 ? `<p class="small muted">${pct(t.profit / t.revenue)} margin</p>` : ''}
    ${m.short.length ? `<div class="warn">Not enough stock: ${esc(m.short.join('; '))}. You can still save; stock will show as Out.</div>` : ''}
    ${m.noPrice.length ? `<div class="warn">No selling price for ${esc(m.noPrice.join(', '))}. Type the price on the line, or set it in Stock.</div>` : ''}
    ${m.noCost.length ? `<div class="warn">No cost set yet for ${esc(m.noCost.join(', '))}. Profit counts them as ₹0 until you add a cost in Stock; this sale updates when you do.</div>` : ''}
    <button class="btn primary block" data-act="saveSale" ${S.saving ? 'disabled' : ''}>Save sale</button>`;
}
function syncSell() {
  const d = S.sell;
  d.lines.forEach((l, i) => {
    if (!l.priceEdited) {
      l.price = +(unitPriceOf(l) * n(l.qty)).toFixed(2);
      const el = $(`[data-bind="lines.${i}.price"]`); if (el) el.value = l.price;
    }
  });
  const box = $('#sell-preview'); if (box) { const m = sellModel(d); box.innerHTML = sellPreview(m, m.totals); }
}

// ---------------------------------------------------------------- ORDERS (website)
// Every order sent from the website's WhatsApp button ends with one machine-readable line:
//   Order code (please keep): TB1|TB-261013-AB12|b:cat-kuromi:1:1:259,i:it-labubu-gel-pen:2:1:20
// Each part is kind:stockroomId:qty:unitsPerQty:unitPrice (b = gift bag, i = single item; a box of
// 12 pencils is i:<pencil id>:1:12:109). Pasting the message here saves the order; confirming it
// records a normal sale, so stock and profit update exactly as for a sale typed on the Sell screen.
const ORDER_STEPS = [['new', 'New'], ['confirmed', 'Confirmed'], ['packed', 'Packed'], ['dispatched', 'Dispatched'], ['delivered', 'Delivered']];
const ORDER_LABEL = { ...Object.fromEntries(ORDER_STEPS), cancelled: 'Cancelled' };
const ORDER_NEXT = { confirmed: ['packed', 'Mark packed'], packed: ['dispatched', 'Mark dispatched'], dispatched: ['delivered', 'Mark delivered'] };
const orderChip = (s) => `<span class="chip ${s === 'new' ? 'check' : s === 'cancelled' ? 'out' : s === 'delivered' ? 'ok' : 'low'}">${esc(ORDER_LABEL[s] || s)}</span>`;
const blankOrd = () => ({ paste: '', parsed: null, filter: 'active' });
const orderCount = (lines = []) => {
  const b = lines.filter((l) => l.kind === 'bag').reduce((a, l) => a + n(l.qty), 0), i = lines.filter((l) => l.kind !== 'bag').reduce((a, l) => a + n(l.qty), 0);
  return [b && `${b} gift bag${b === 1 ? '' : 's'}`, i && `${i} item${i === 1 ? '' : 's'}`].filter(Boolean).join(' · ') || 'empty';
};
const ORDER_PREV = { packed: 'confirmed', dispatched: 'packed', delivered: 'dispatched' };
let orderStepAt = 0; // a status button that appears under the finger right after a change ignores that tap
// After a status change the sheet redraws: keep focus on its next button and say what happened.
const afterOrderStep = (msg) => setTimeout(() => { ($('.sheet .btn.primary') || $('.sheet'))?.focus({ preventScroll: true }); $('#sr').textContent = msg; }, 60);
// Website stock is out of date once an order is confirmed or cancelled after the last stock file.
const stockStale = () => { const last = str(S.web?.stockExportedAt); return S.orders.filter((o) => ['confirmed', 'cancelled'].some((st) => (o.history || []).some((h) => h.status === st && str(h.at) > last))).length; };

function parseOrder(text) {
  const t = str(text);
  // WhatsApp can wrap the long code line; take everything after "TB1|" up to a blank line, minus spaces.
  const at = t.indexOf('TB1|'), codeText = at < 0 ? '' : t.slice(at).split(/\n\s*\n/)[0].replace(/\s+/g, '');
  const m = /^TB1\|(TB-\d{6}-[A-Z0-9]{4})\|([^\s]+)/.exec(codeText);
  if (!m) return { error: 'No TadaBoo order code found. Paste the whole WhatsApp message, including the line that starts “Order code”.' };
  const lines = [];
  for (const part of m[2].split(',')) {
    const f = part.split(':');
    const qty = Math.floor(n(f[2])), units = Math.max(1, Math.floor(n(f[3]))), price = n(f[4]);
    if (f.length !== 5 || !/^[bi]$/.test(f[0]) || !f[1] || !(qty > 0) || price < 0) return { error: `Part of the order code can’t be read: “${part}”. Ask the customer to resend the order from the website.` };
    lines.push({ kind: f[0] === 'b' ? 'bag' : 'item', ref: f[1], qty, units, price });
  }
  const line = (label) => (new RegExp(`^${label}:[ \\t]*(.+)$`, 'mi').exec(t)?.[1] || '').trim().slice(0, 300);
  return {
    id: m[1], code: m[0], lines,
    customer: { name: line('Name'), phone: line('Phone'), delivery: /door/i.test(line('Delivery')) ? 'door' : 'collect', address: line('Address'), note: line('Gift note') },
    raw: t.slice(0, 4000),
  };
}
// Gift kits default to one per gift bag, plus one for the loose items of a custom bag.
const defaultKits = (lines) => lines.reduce((a, l) => a + (l.kind === 'bag' ? l.qty : 0), 0) + (lines.some((l) => l.kind === 'item') ? 1 : 0);
/** Lines with names and checks, and the sale this order would record. opts: pack, kits, shippingCharged, courierCost. */
function orderModel(o, opts = {}) {
  const lines = (o.lines || []).map((l) => {
    const rec = l.kind === 'bag' ? D.bagsById[l.ref] : D.itemsById[l.ref];
    return { ...l, name: rec ? nameOf(rec) : `Unknown ${l.kind === 'bag' ? 'gift bag' : 'item'} (${l.ref})`, known: !!rec && !rec.archived, total: n(l.qty) * n(l.price),
      priceDiff: !rec ? null : l.kind === 'bag' ? (rec.price != null && n(rec.price) !== n(l.price) ? n(rec.price) : null)
        : rec.sellPrice == null ? null : l.units === 1 ? (n(rec.sellPrice) !== n(l.price) ? n(rec.sellPrice) : null)
        : (n(l.price) / l.units < n(rec.sellPrice) / 2 || n(l.price) / l.units > n(rec.sellPrice) * 2 ? n(rec.sellPrice) * l.units : null) };
  });
  const snap = (c) => (c == null ? null : +(+c).toFixed(4));
  const saleLines = lines.filter((l) => l.known).map((l) => (l.kind === 'bag'
    ? { bagId: l.ref, qty: l.qty, price: l.total, name: l.name }
    : { itemId: l.ref, qty: l.qty * l.units, price: l.total, name: l.units > 1 ? `${l.name} (${l.qty} × box of ${l.units})` : l.name }));
  const consumed = expandSale({ lines: saleLines }, S.bags).map((c) => ({ ...c, cost: snap(D.costs[c.itemId]) }));
  const pack = opts.pack || 'gift', kits = Math.max(0, Math.floor(n(opts.kits ?? defaultKits(lines))));
  const kit = pack === 'gift' ? S.settings.giftKit : pack === 'pouch' ? S.settings.pouchKit : [];
  const pieces = kitPieces(kit, D.costs).filter((p) => p.itemId).map((p) => ({ ...p, qty: p.qty * kits, cost: snap(p.cost) })).filter((p) => p.qty > 0);
  const kinds = new Set(saleLines.map((l) => (l.bagId ? 'bag' : 'item')));
  const sale = { date: today(), kind: kinds.size > 1 ? 'custom' : kinds.has('bag') ? 'bag' : 'items', lines: saleLines, consumed,
    packaging: { mode: kits ? pack : 'none', pieces }, shippingCharged: n(opts.shippingCharged), courierCost: n(opts.courierCost),
    customer: str(o.customer?.name).trim(), note: `Website order ${o.id}`, orderId: o.id };
  const need = {};
  for (const c of [...consumed, ...pieces]) need[c.itemId] = (need[c.itemId] || 0) + c.qty;
  const short = Object.entries(need).filter(([id, q]) => (D.stock[id] ?? 0) < q).map(([id, q]) => `${itemName(id)} (need ${q}, have ${D.stock[id] ?? 0})`);
  return { lines, sale, totals: saleTotals(sale, D.costs, S.bags), short, unknown: lines.filter((l) => !l.known), total: lines.reduce((a, l) => a + l.total, 0), kits, pack };
}
const orderLinesHtml = (m) => `<div class="list">${m.lines.map((l) => `<div class="li" style="cursor:default">
    <div class="grow"><div class="name">${esc(l.qty)} × ${esc(l.name)}</div>
      <div class="meta">${l.kind === 'bag' ? 'Gift bag' : l.units > 1 ? `Box of ${esc(l.units)}` : 'Item'} · ${inr(l.price)} each${l.priceDiff != null ? ` · <span class="warnc">Stockroom price ${inr(l.priceDiff)}${l.units > 1 ? ` (₹${esc(n(l.priceDiff) / l.units)} a piece)` : ''}</span>` : ''}</div></div>
    <div class="right"><span class="num">${inr(l.total)}</span>${l.known ? '' : '<span class="chip out">Not found</span>'}</div></div>`).join('')}</div>`;
const customerHtml = (c) => `<div class="small muted">${[c?.name && `<b>${esc(c.name)}</b>`, c?.phone && esc(c.phone), c?.delivery === 'door' ? `Door-to-door${c.address ? `: ${esc(c.address)}` : ''}` : 'Collect / discuss', c?.note && `Gift note: “${esc(c.note)}”`].filter(Boolean).join(' · ')}</div>`;

function viewOrders() {
  const d = (S.ord ||= blankOrd());
  const p = d.parsed, m = p && !p.error ? orderModel(p) : null, dup = p && !p.error && S.orders.find((o) => o.id === p.id);
  const groups = { active: (o) => !['delivered', 'cancelled'].includes(o.status), delivered: (o) => o.status === 'delivered', cancelled: (o) => o.status === 'cancelled', all: () => true };
  const list = S.orders.filter(groups[d.filter] || groups.active).sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)));
  const waiting = S.orders.filter((o) => o.status === 'new').length;
  return `<div class="stack" data-draft="orders">
  <div class="section-head"><div><div class="eyebrow">Website</div><h2>Orders</h2></div>
    <button class="btn ghost sm" data-act="stockFile" ${S.downloads ? '' : 'hidden'}>Website stock file</button></div>
  ${stockStale() ? `<div class="warn" role="status">Website stock is out of date: ${stockStale()} order${stockStale() === 1 ? '' : 's'} changed since the last stock file. ${S.downloads ? 'Tap “Website stock file” and upload it with the website, or a' : 'A'}sk Tadaboo to “refresh the website stock”.</div>` : ''}
  <div class="card stack"><h3>Add an order from WhatsApp</h3>
    <label class="f">Paste the customer’s whole WhatsApp message<textarea class="input" rows="4" data-bind="paste" placeholder="Hi TadaBoo! I'd like to order (TB-…)">${esc(d.paste)}</textarea></label>
    <div class="row"><button class="btn primary grow" data-act="ordRead">Read order</button>${d.paste || p ? '<button class="btn ghost" data-act="ordClear">Clear</button>' : ''}</div>
    ${p?.error ? `<div class="err" role="alert">${esc(p.error)}</div>` : ''}
    ${m ? `<div class="stack">
      <div class="section-head"><h3>${esc(p.id)}</h3><span class="num"><b>${inr(m.total)}</b></span></div>
      ${customerHtml(p.customer)}
      ${orderLinesHtml(m)}
      ${dup ? `<div class="warn">This order is already saved (${esc(ORDER_LABEL[dup.status] || dup.status)}). <button class="btn ghost sm" data-act="openOrder" data-id="${esc(dup.id)}">Open it</button></div>` : ''}
      ${m.unknown.length ? `<div class="err">Not in the Stockroom: ${esc(m.unknown.map((l) => l.ref).join(', '))}. Add or restore them before confirming.</div>` : ''}
      ${m.short.length ? `<div class="warn">Not enough stock right now: ${esc(m.short.join('; '))}.</div>` : ''}
      ${m.lines.some((l) => l.priceDiff != null) ? '<div class="warn" role="alert">A price in this message differs from the Stockroom. Check it before confirming.</div>' : ''}
      ${dup ? '' : '<button class="btn primary block" data-act="saveOrder">Save order</button>'}
    </div>` : ''}
  </div>
  <div class="section-head"><h3>${waiting ? `${waiting} waiting to confirm` : 'All orders'}</h3></div>
  <div class="filters" role="group" aria-label="Show orders">${[['active', 'Open'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['all', 'All']].map(([k, l]) => `<button data-act="ordFilter" data-v="${k}" aria-pressed="${d.filter === k}">${l}</button>`).join('')}</div>
  ${list.length ? `<div class="card" style="padding-block:4px"><div class="list">${list.map((o) => `<button class="li" data-act="openOrder" data-id="${esc(o.id)}">
      <div class="grow"><div class="name">${esc(o.customer?.name || 'Customer')} · ${esc(o.id)}</div><div class="meta">${fmtDate(str(o.createdAt).slice(0, 10))} · ${orderCount(o.lines)}</div></div>
      <div class="right"><span class="num">${inr(o.total)}</span>${orderChip(o.status)}</div></button>`).join('')}</div></div>`
    : `<div class="card empty"><h3>No ${d.filter === 'all' ? '' : esc({ active: 'open', delivered: 'delivered', cancelled: 'cancelled' }[d.filter] || '') + ' '}orders</h3><p>Paste a WhatsApp order above to add it.</p></div>`}
</div>`;
}
function openOrderSheet(id) {
  const o = S.orders.find((x) => x.id === id); if (!o) return toast('This order was removed elsewhere.', true);
  const draft = { shippingCharged: o.shippingCharged ?? '', courierCost: o.courierCost ?? '', pack: o.pack || 'gift', kits: o.kits ?? defaultKits(o.lines || []), tracking: o.tracking || '' };
  S.sheet = { kind: 'order', id, draft, orig: JSON.stringify(draft) }; renderSheet();
}
function sheetOrder() {
  const { id, draft: d } = S.sheet, o = S.orders.find((x) => x.id === id);
  if (!o) return `<div class="section-head"><h2>Order</h2><button class="icon-btn" data-act="closeSheet" aria-label="Close">×</button></div><p class="muted">This order was removed elsewhere.</p>`;
  const m = orderModel(o, d), t = m.totals, st = o.status, done = st === 'delivered' || st === 'cancelled';
  const stepAt = ORDER_STEPS.findIndex(([k]) => k === st);
  return `<div class="section-head"><h2>${esc(o.id)}</h2><button class="icon-btn" data-act="closeSheet" aria-label="Close">×</button></div>
  <div class="row">${orderChip(st)}<span class="small muted">${st === 'cancelled' ? 'Stock was put back.' : ORDER_STEPS.map(([k, l], i) => `<span style="${i <= stepAt ? 'color:var(--ink);font-weight:700' : ''}">${l}</span>`).join(' → ')}</span></div>
  ${customerHtml(o.customer)}
  <div class="card" style="padding-block:4px">${orderLinesHtml(m)}</div>
  ${st === 'new' ? `
    ${m.unknown.length ? `<div class="err">Not in the Stockroom: ${esc(m.unknown.map((l) => l.ref).join(', '))}. Add or restore them, then confirm.</div>` : ''}
    ${m.short.length ? `<div class="warn">Not enough stock: ${esc(m.short.join('; '))}. You can still confirm; stock will show as Out.</div>` : ''}
    <div class="card stack"><h3>Packing and delivery</h3>
      <div class="seg" role="group" aria-label="Packaging">${[['gift', 'Gift kit'], ['pouch', 'Pouch'], ['none', 'None']].map(([k, l]) => `<button data-act="setDraft" data-k="pack" data-v="${k}" aria-pressed="${d.pack === k}">${l}</button>`).join('')}</div>
      <div class="grid3">
        ${d.pack === 'none' ? '' : field('How many kits', 'kits', d.kits, { type: 'number' })}
        ${field('Shipping charged', 'shippingCharged', d.shippingCharged, { type: 'number', rupee: true, ph: '0' })}
        ${field('Courier cost', 'courierCost', d.courierCost, { type: 'number', rupee: true, ph: '0' })}</div></div>
    <div class="card stack" id="order-preview">${orderPreview(m, t)}</div>
    <button class="btn primary block" data-act="saveOrderConfirm" ${m.unknown.length ? 'disabled' : ''}>Confirm order and update stock</button>`
  : `<div class="card stack"><div class="sum-row"><span>Order total</span><b>${inr(o.total)}</b></div>
      ${o.saleId && !S.sales.some((x) => x.id === o.saleId) && st !== 'cancelled' ? '<div class="warn">This order’s sale was deleted in History, so its stock is no longer taken off.</div>' : ''}
      ${o.saleId ? `<div class="sum-row muted"><span>Recorded as a sale</span><button class="btn ghost sm" data-act="openEntry" data-k="sales" data-id="${esc(o.saleId)}">Open sale</button></div>` : ''}</div>
    ${st === 'packed' ? field('Courier / tracking (optional)', 'tracking', d.tracking, { ph: 'e.g. DTDC 7X123…' }) : o.tracking ? `<p class="small muted">Tracking: ${esc(o.tracking)}</p>` : ''}
    ${ORDER_NEXT[st] ? `<button class="btn primary block" data-act="saveOrderStatus" data-v="${ORDER_NEXT[st][0]}">${ORDER_NEXT[st][1]}</button>` : ''}
    ${ORDER_PREV[st] ? `<button class="btn ghost sm" data-act="saveOrderBack">Undo: back to ${esc(ORDER_LABEL[ORDER_PREV[st]])}</button>` : ''}`}
  ${done ? '' : `<button class="btn danger block" data-act="deleteOrderCancel" data-confirm="${o.saleId ? 'Tap again to cancel and put the stock back' : 'Tap again to cancel this order'}">Cancel order</button>`}`;
}
function orderPreview(m, t) {
  return `<h3>If you confirm</h3>
    <div class="sum-row"><span>Revenue</span><span>${inr(t.revenue)}</span></div>
    <div class="sum-row muted"><span>Item cost</span><span>−${inr(t.itemCost)}</span></div>
    <div class="sum-row muted"><span>Packaging (${m.kits} ${m.pack === 'pouch' ? 'pouch' : 'kit'}${m.kits === 1 ? '' : 's'})</span><span>−${inr(t.packCost)}</span></div>
    <div class="sum-row muted"><span>Courier</span><span>−${inr(t.courier)}</span></div>
    <div class="sum-row total"><span>Profit</span><span class="${t.profit >= 0 ? 'pos' : 'neg'}">${inr(t.profit)}</span></div>
    <p class="small muted">Confirming records this as a sale: stock goes down and it appears in History and on Home.</p>`;
}
/** The website's stock file: units per item and how many of each gift bag can be packed. */
function stockFileJson() {
  const items = {}, bags = {};
  for (const it of S.items) if (!it.archived) items[it.id] = Math.max(0, Math.floor(n(D.stock[it.id])));
  for (const c of D.capacity) bags[c.bag.id] = c.count;
  return JSON.stringify({ asOf: nowIso(), items, bags });
}

// ---------------------------------------------------------------- BUY
const blankBuy = () => ({ date: today(), supplier: '', ref: '', lines: [blankBuyLine()], extras: { gst: '', shipping: '', other: '' }, note: '' });
const blankBuyLine = () => ({ itemId: '', newName: '', newType: 'product', newCategory: '', newCatText: '', qty: '', unitPrice: '' });
function buyModel(d) {
  // Only lines with an item chosen count, exactly as saveBuy saves them.
  const used = d.lines.filter((l) => l.itemId);
  const lines = used.map((l) => ({ itemId: l.itemId, qty: n(l.qty), unitPrice: n(l.unitPrice) }));
  const landed = landedLines({ lines, extras: d.extras });
  const itemsTotal = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  const extras = n(d.extras.gst) + n(d.extras.shipping) + n(d.extras.other);
  return { used, landed, itemsTotal, extras, total: itemsTotal + extras };
}
function viewBuy() {
  const d = (S.buy ||= blankBuy());
  const sups = [...new Set([...S.purchases.map((p) => p.supplier), ...S.items.map((i) => i.supplier)].filter(Boolean))].sort();
  return `<div class="stack" data-draft="buy">
  <div class="section-head"><div><div class="eyebrow">Restock</div><h2>Record a purchase</h2></div><button class="btn ghost sm" data-act="resetBuy">Clear</button></div>
  <div class="two-col"><div class="stack">
    <div class="card stack"><div class="grid2">
      <label class="f">Supplier<input class="input" list="sups" data-bind="supplier" value="${esc(d.supplier)}" placeholder="e.g. 91Supplies"></label>
      ${field('Date', 'date', d.date, { type: 'date' })}</div>
      ${field('Invoice / order no.', 'ref', d.ref, { ph: 'optional' })}
      <datalist id="sups">${sups.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></div>
    <div class="card stack"><h3>Items bought</h3><p class="small muted">Enter quantities in pieces you sell. Bought a box of 12 pens for ₹120? Enter 12 at ₹10.</p>
      ${d.lines.map((l, i) => `<div class="line">
        <div class="row"><select class="input grow" data-bind="lines.${i}.itemId" data-rerender aria-label="Item">${itemOptions(l.itemId, { includeNew: true })}</select>
        <button class="icon-btn" data-act="rmLine" data-path="lines" data-i="${i}" aria-label="Remove line">×</button></div>
        ${l.itemId === '__new' ? `<div class="stack">${field('New item name', `lines.${i}.newName`, l.newName, { ph: 'e.g. Panda Eraser' })}
          <label class="f">Category${categoryPicker(`lines.${i}.newCategory`, l.newCategory, `lines.${i}.newCatText`, l.newCatText)}</label></div>
          <div class="seg" role="group" aria-label="Type"><button data-act="buyNewType" data-i="${i}" data-v="product" aria-pressed="${l.newType === 'product'}">Product</button><button data-act="buyNewType" data-i="${i}" data-v="packaging" aria-pressed="${l.newType === 'packaging'}">Packaging</button></div>` : ''}
        <div class="grid2">${field('Quantity', `lines.${i}.qty`, l.qty, { type: 'number', ph: '0' })}${field('Price per piece', `lines.${i}.unitPrice`, l.unitPrice, { type: 'number', rupee: true, ph: '0' })}</div>
      </div>`).join('')}
      <button class="btn ghost" data-act="addBuyLine">+ Add another item</button></div>
    <div class="card stack"><h3>Extra charges</h3><p class="small muted">Spread across the items by value, so each item’s cost includes its share.</p>
      <div class="grid3">${field('GST', 'extras.gst', d.extras.gst, { type: 'number', rupee: true, ph: '0' })}${field('Shipping', 'extras.shipping', d.extras.shipping, { type: 'number', rupee: true, ph: '0' })}${field('Other', 'extras.other', d.extras.other, { type: 'number', rupee: true, ph: '0' })}</div>
      <label class="f">Note<input class="input" data-bind="note" value="${esc(d.note)}" placeholder="optional, e.g. paid by ICICI card"></label></div>
  </div>
  <div class="card stack sticky" id="buy-preview">${buyPreview(d)}</div></div></div>`;
}
function buyPreview(d) {
  const m = buyModel(d);
  return `<h3>This purchase</h3>
    ${m.landed.map((l, i) => ({ l, src: m.used[i] })).filter(({ l }) => l.qty > 0).map(({ l, src }) => {
      const nm = src.itemId === '__new' ? src.newName || 'New item' : itemName(src.itemId);
      return `<div class="sum-row small"><span class="grow">${esc(nm)} × ${l.qty}</span><span>${inr(l.landed, 2)} each</span></div>`;
    }).join('')}
    <div class="sum-row muted"><span>Items</span><span>${inr(m.itemsTotal)}</span></div>
    <div class="sum-row muted"><span>Extras</span><span>${inr(m.extras)}</span></div>
    <div class="sum-row total"><span>Total paid</span><span>${inr(m.total)}</span></div>
    <button class="btn primary block" data-act="saveBuy">Save purchase</button>`;
}

// ---------------------------------------------------------------- MORE
function viewMore() {
  const sub = [['history', 'History'], ['bags', 'Gift bags'], ['cats', 'Categories'], ['settings', 'Settings'], ['help', 'Ask Claude']];
  return `<div class="stack"><div class="section-head"><div><div class="eyebrow">Manage</div><h2>More</h2></div>
    <button class="btn ghost sm" data-act="export" ${S.downloads ? '' : 'hidden'}>Export to Excel</button></div>
  <div class="seg" role="group" aria-label="Section">${sub.map(([k, l]) => `<button data-act="more" data-v="${k}" aria-pressed="${S.more === k}">${l}</button>`).join('')}</div>
  ${({ history: moreHistory, bags: moreBags, cats: moreCats, settings: moreSettings, help: moreHelp })[S.more]()}</div>`;
}
function historyEntries() {
  const e = [
    ...S.sales.map((s) => ({ kind: 'sale', doc: s, date: s.date, at: s.createdAt })),
    ...S.purchases.map((p) => ({ kind: 'purchase', doc: p, date: p.date, at: p.createdAt })),
    ...S.adjustments.map((a) => ({ kind: 'adjustment', doc: a, date: a.date, at: a.createdAt })),
  ];
  return e.sort((a, b) => str(b.date).localeCompare(str(a.date)) || str(b.at).localeCompare(str(a.at)));
}
const saleTitle = (s) => (s.lines || []).map((l) => `${l.qty} × ${l.name || (l.bagId ? bagName(l.bagId) : itemName(l.itemId))}`).join(', ') || 'Sale';
function moreHistory() {
  const sups = [...new Set(S.purchases.map((p) => str(p.supplier).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const sf = sups.includes(S.histSupplier) ? S.histSupplier : '';
  const all = historyEntries().filter((e) => !sf || (e.kind === 'purchase' && str(e.doc.supplier).trim() === sf)), list = all.slice(0, S.historyLimit);
  const sp = sf ? S.purchases.filter((p) => str(p.supplier).trim() === sf) : [];
  const ex = (k) => sp.reduce((a, p) => a + n(p.extras?.[k]), 0);
  const supHead = sups.length ? `<div class="filters" role="group" aria-label="Filter by supplier"><button data-act="histSupplier" data-v="" aria-pressed="${!sf}">All</button>${sups.map((x) => `<button data-act="histSupplier" data-v="${esc(x)}" aria-pressed="${sf === x}">${esc(x)}</button>`).join('')}</div>` : '';
  const supSum = sf ? `<div class="card stack"><div class="sum-row"><span>${esc(sf)}: ${sp.length} purchase${sp.length === 1 ? '' : 's'}</span><b>${inr(sp.reduce((a, p) => a + D.purchaseTotal(p), 0))}</b></div>
    <div class="sum-row muted small"><span>of which GST ${inr(ex('gst'))} · shipping ${inr(ex('shipping'))} · other ${inr(ex('other'))}</span></div></div>` : '';
  if (!all.length) return supHead + supSum + '<div class="card empty"><h3>No history yet</h3><p>Sales, purchases and stock corrections will be listed here.</p></div>';
  return supHead + supSum + `<div class="card" style="padding-block:4px"><div class="list">${list.map((e) => {
    const d = e.doc;
    if (e.kind === 'sale') { const t = saleTotals(d, D.costs, S.bags); return `<button class="li" data-act="openEntry" data-k="sales" data-id="${esc(d.id)}">
      <div class="grow"><div class="name">${esc(saleTitle(d))}</div><div class="meta">Sale · ${fmtDate(d.date)}${d.customer ? ` · ${esc(d.customer)}` : ''}</div></div>
      <div class="right"><span class="num">${inr(t.revenue)}</span><span class="small ${t.profit >= 0 ? 'pos' : 'neg'}">profit ${inr(t.profit)}</span></div></button>`; }
    if (e.kind === 'purchase') return `<button class="li" data-act="openEntry" data-k="purchases" data-id="${esc(d.id)}">
      <div class="grow"><div class="name">${esc(d.supplier || 'Purchase')}${d.ref ? ` · ${esc(d.ref)}` : ''}</div><div class="meta">Purchase · ${fmtDate(d.date)} · ${(d.lines || []).length} items</div></div>
      <div class="right"><span class="num">${inr(D.purchaseTotal(d))}</span><span class="small muted">spent</span></div></button>`;
    return `<button class="li" data-act="openEntry" data-k="adjustments" data-id="${esc(d.id)}">
      <div class="grow"><div class="name">${esc(itemName(d.itemId))}</div><div class="meta">${esc(d.reason || 'Stock correction')} · ${fmtDate(d.date)}</div></div>
      <div class="right"><span class="num ${d.qty >= 0 ? 'pos' : 'neg'}">${d.qty >= 0 ? '+' : ''}${esc(d.qty)}</span></div></button>`;
  }).join('')}</div>${all.length > list.length ? `<button class="btn ghost block" data-act="moreHistory">Show older (${all.length - list.length} more)</button>` : ''}</div>`;
}
function sheetEntry() {
  const { k, id } = S.sheet, d = S[k].find((x) => x.id === id);
  if (!d) return `<div class="section-head"><h2>Entry removed</h2><button class="icon-btn" data-act="closeSheet" aria-label="Close">×</button></div>`;
  let body = '';
  if (k === 'sales') {
    const t = saleTotals(d, D.costs, S.bags);
    body = `<p class="muted">${fmtDate(d.date)}${d.customer ? ` · ${esc(d.customer)}` : ''}${d.note ? ` · ${esc(d.note)}` : ''}</p>
      ${(d.lines || []).map((l) => `<div class="sum-row"><span>${esc(l.qty)} × ${esc(l.name || (l.bagId ? bagName(l.bagId) : itemName(l.itemId)))}</span><span>${inr(l.price)}</span></div>`).join('')}
      <div class="sum-row muted"><span>Shipping charged</span><span>${inr(d.shippingCharged)}</span></div>
      <div class="sum-row muted"><span>Item cost</span><span>−${inr(t.itemCost)}</span></div>
      <div class="sum-row muted"><span>Packaging (${esc(d.packaging?.mode || 'none')})</span><span>−${inr(t.packCost)}</span></div>
      <div class="sum-row muted"><span>Courier</span><span>−${inr(t.courier)}</span></div>
      <div class="sum-row total"><span>Profit</span><span class="${t.profit >= 0 ? 'pos' : 'neg'}">${inr(t.profit)}</span></div>
      <p class="small muted">Deleting this sale puts its items and packaging back in stock.</p>`;
  } else if (k === 'purchases') {
    body = `<p class="muted">${fmtDate(d.date)}${d.ref ? ` · ${esc(d.ref)}` : ''}</p>${d.note ? `<p class="small">${esc(d.note)}</p>` : ''}
      ${landedLines(d).map((l) => `<div class="sum-row small"><span class="grow">${l.qty} × ${esc(itemName(l.itemId))} @ ${inr(l.unitPrice, 2)}</span><span>${inr(l.landed, 2)} landed</span></div>`).join('')}
      <div class="sum-row muted"><span>Extras (GST ${inr(d.extras?.gst)}, shipping ${inr(d.extras?.shipping)}, other ${inr(d.extras?.other)})</span></div>
      <div class="sum-row total"><span>Total</span><span>${inr(D.purchaseTotal(d))}</span></div>
      <button class="btn primary block" data-act="editPurchase" data-id="${esc(d.id)}">Edit costs &amp; details</button>
      <p class="small muted">Deleting this purchase removes its items from stock.</p>`;
  } else {
    body = `<p>${d.qty >= 0 ? '+' : ''}${esc(d.qty)} × ${esc(itemName(d.itemId))}</p><p class="muted">${esc(d.reason || '')} · ${fmtDate(d.date)}</p>`;
  }
  const title = { sales: 'Sale', purchases: d.supplier || 'Purchase', adjustments: 'Stock correction' }[k];
  return `<div class="section-head"><h2>${esc(title)}</h2><button class="icon-btn" data-act="closeSheet" aria-label="Close">×</button></div>${body}
    <button class="btn danger block" data-act="deleteEntry" data-confirm="Tap again to delete">Delete entry</button>`;
}

// ---- purchase editor: supplier, date, ref, GST / shipping / other, line quantities and prices
function openPurchaseSheet(id) {
  const p = S.purchases.find((x) => x.id === id); if (!p) return toast('This purchase was removed elsewhere.', true);
  const x = p.extras || {};
  S.sheet = { kind: 'purchase', id, draft: { supplier: str(p.supplier), date: str(p.date), ref: str(p.ref), note: str(p.note),
    extras: { gst: x.gst ?? '', shipping: x.shipping ?? '', other: x.other ?? '' },
    lines: (p.lines || []).map((l) => ({ itemId: l.itemId, qty: l.qty ?? '', unitPrice: l.unitPrice ?? '' })) } };
  S.sheet.orig = JSON.stringify(S.sheet.draft);
  renderSheet();
}
const purchaseFields = (x) => ({ supplier: x.supplier.trim(), date: x.date, ref: x.ref.trim(), note: x.note.trim(),
  extras: { gst: n(x.extras.gst), shipping: n(x.extras.shipping), other: n(x.extras.other) },
  lines: x.lines.filter((l) => l.itemId && n(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: n(l.qty), unitPrice: n(l.unitPrice) })) });
function purchaseEditPreview(d) {
  const f = purchaseFields(d), items = f.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0), ex = f.extras.gst + f.extras.shipping + f.extras.other;
  return `<div class="sum-row muted"><span>Items</span><span>${inr(items)}</span></div><div class="sum-row muted"><span>GST + shipping + other</span><span>${inr(ex)}</span></div>
    <div class="sum-row total"><span>Total</span><span>${inr(items + ex)}</span></div>`;
}
function sheetPurchase() {
  const { draft: d } = S.sheet;
  const sups = [...new Set(S.purchases.map((p) => str(p.supplier).trim()).filter(Boolean))].sort();
  return `<div class="section-head"><h2>Edit purchase</h2><button class="icon-btn" data-act="closeSheet" aria-label="Close">×</button></div>
  <div class="grid2"><label class="f">Supplier<input class="input" list="sups-edit" data-bind="supplier" value="${esc(d.supplier)}"></label>${field('Date', 'date', d.date, { type: 'date' })}</div>
  <datalist id="sups-edit">${sups.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
  ${field('Invoice / order no.', 'ref', d.ref, { ph: 'optional' })}
  <h3>Cost components</h3>
  <div class="grid3">${field('GST', 'extras.gst', d.extras.gst, { type: 'number', rupee: true, ph: '0' })}${field('Shipping', 'extras.shipping', d.extras.shipping, { type: 'number', rupee: true, ph: '0' })}${field('Other', 'extras.other', d.extras.other, { type: 'number', rupee: true, ph: '0' })}</div>
  <h3>Items</h3>
  ${d.lines.map((l, i) => `<div class="line"><div class="row"><select class="input grow" data-bind="lines.${i}.itemId" aria-label="Item">${itemOptions(l.itemId)}</select>
    <button class="icon-btn" data-act="rmLine" data-path="lines" data-i="${i}" aria-label="Remove line">×</button></div>
    <div class="grid2">${field('Quantity', `lines.${i}.qty`, l.qty, { type: 'number', ph: '0' })}${field('Price per piece', `lines.${i}.unitPrice`, l.unitPrice, { type: 'number', rupee: true, ph: '0' })}</div></div>`).join('')}
  <button class="btn ghost" data-act="addLine" data-path="lines">+ Add another item</button>
  <label class="f">Note<input class="input" data-bind="note" value="${esc(d.note)}"></label>
  <div class="tip" id="pur-preview">${purchaseEditPreview(d)}</div>
  <p class="small muted">Stock and average costs update from the edited quantities and landed prices. Past sales keep the cost they were recorded with.</p>
  <button class="btn primary block" data-act="savePurchase">Save changes</button>`;
}
function moreBags() {
  const rows = S.bags.filter((b) => !b.archived).sort((a, b) => byName(a, b)), archived = S.bags.filter((b) => b.archived);
  const bagCost = (b) => (b.contents || []).reduce((a, c) => a + n(c.qty) * (D.costs[c.itemId] || 0), 0);
  return `<div class="row between"><p class="muted small grow">Price, contents and cost of each gift bag. Selling a bag takes its contents out of stock.</p><button class="btn primary sm" data-act="newBag">+ New bag</button></div>
  <div class="card" style="padding-block:4px"><div class="list">${rows.map((b) => { const c = bagCost(b), cap = D.capacity.find((x) => x.bag.id === b.id);
    return `<button class="li" data-act="editBag" data-id="${esc(b.id)}"><div class="grow"><div class="name">${esc(nameOf(b))}</div>
      <div class="meta">${(b.contents || []).length} items · cost ${inr(c)} · ${b.price ? pct((b.price - c) / b.price) : '–'} margin · can make ${cap?.count ?? 0}</div></div>
      <div class="right"><span class="stockno">${inr(b.price)}</span></div></button>`; }).join('') || '<div class="empty"><h3>No gift bags yet</h3></div>'}
    ${archived.map((b) => `<button class="li" data-act="editBag" data-id="${esc(b.id)}"><div class="grow"><div class="name muted">${esc(nameOf(b))}</div><div class="meta">Archived</div></div></button>`).join('')}</div></div>`;
}
function openBagSheet(id) {
  const b = id ? D.bagsById[id] : null;
  S.sheet = { kind: 'bag', id, draft: b ? { name: b.name || '', price: b.price ?? '', contents: clone(b.contents || []) } : { name: '', price: '', contents: [{ itemId: '', qty: 1 }] } };
  S.sheet.orig = JSON.stringify(S.sheet.draft);
  renderSheet();
}
function sheetBag() {
  const { id, draft: d } = S.sheet, b = id ? D.bagsById[id] : null;
  const cost = d.contents.reduce((a, c) => a + n(c.qty) * (D.costs[c.itemId] || 0), 0);
  const cap = bagCapacity({ contents: d.contents.filter((c) => c.itemId) }, D.stock, D.itemsById);
  return `<div class="section-head"><h2>${b ? 'Edit gift bag' : 'New gift bag'}</h2><button class="icon-btn" data-act="closeSheet" aria-label="Close">×</button></div>
  <div class="grid2">${field('Bag name', 'name', d.name, { ph: 'e.g. Sweet Treats' })}${field('Selling price', 'price', d.price, { type: 'number', rupee: true })}</div>
  <h3>Contents</h3>${kitLines('sheet', 'contents', d.contents, 'product')}
  <div class="tip" id="bag-preview"><div class="sum-row"><span>Cost of contents</span><b>${inr(cost)}</b></div><div class="sum-row"><span>Margin</span><b>${n(d.price) ? `${inr(n(d.price) - cost)} (${pct((n(d.price) - cost) / n(d.price))})` : '–'}</b></div><div class="sum-row"><span>Can make now</span><b>${cap.count}</b></div></div>
  <button class="btn primary block" data-act="saveBag">Save bag</button>
  ${b ? `<button class="btn ghost block" data-act="archiveBag">${b.archived ? 'Restore bag' : 'Archive bag'}</button>` : ''}`;
}
// ---- More → Categories: the category list, with rename / merge / remove applied to every item in it
const itemsInCat = (name) => S.items.filter((i) => catKey(i) === str(name).trim().toLowerCase()); // archived included
const savedCats = () => (Array.isArray(S.settings.categories) ? S.settings.categories.map((x) => str(x).trim()).filter(Boolean) : []);
function moreCats() {
  const cats = categoryList();
  return `<div class="row between"><p class="muted small grow">Rename a category to update every item in it, or remove it and move its items elsewhere.</p>
    <button class="btn primary sm" data-act="newCat">+ New category</button></div>
  <div class="card" style="padding-block:4px">${cats.length ? `<div class="list">${cats.map((c) => {
    const its = itemsInCat(c), arch = its.filter((i) => i.archived).length;
    return `<button class="li" data-act="editCat" data-cat="${esc(c)}"><div class="grow"><div class="name">${esc(c)}</div>
      <div class="meta">${its.length} item${its.length === 1 ? '' : 's'}${arch ? ` (${arch} archived)` : ''}</div></div><span class="muted" aria-hidden="true">›</span></button>`;
  }).join('')}</div>` : '<div class="empty"><h3>No categories yet</h3><p>Tap “+ New category”, or give an item a category in Stock.</p></div>'}</div>`;
}
function openCatSheet(name) {
  S.sheet = { kind: 'cat', id: name || null, draft: { name: name || '', moveTo: '__choose', moveNew: '' } };
  S.sheet.orig = JSON.stringify(S.sheet.draft);
  renderSheet();
}
// What saving would do: nothing, add, rename, or merge into an existing category.
function catPlan(d, old) {
  const name = str(d.name).trim().replace(/\s+/g, ' ');
  const other = categoryList().find((c) => c.toLowerCase() === name.toLowerCase() && c.toLowerCase() !== str(old).toLowerCase());
  return { name, other };
}
const catMergeNote = (d, old) => {
  const { name, other } = catPlan(d, old);
  return old && name && other ? `This will merge “${old}” into the existing category “${other}”.` : '';
};
function sheetCat() {
  const { id: old, draft: d } = S.sheet, its = old ? itemsInCat(old) : [];
  return `<div class="section-head"><h2>${old ? 'Edit category' : 'New category'}</h2><button class="icon-btn" data-act="closeSheet" aria-label="Close">×</button></div>
  ${field('Category name', 'name', d.name, { ph: 'e.g. Party Packs', attrs: 'autocomplete="off"' })}
  ${old ? `<p class="small muted">${its.length} item${its.length === 1 ? '' : 's'} in this category. Renaming updates all of them.</p>` : ''}
  <div class="warn" id="cat-merge" ${catMergeNote(d, old) ? '' : 'hidden'}>${esc(catMergeNote(d, old))}</div>
  <button class="btn primary block" data-act="saveCat">${old ? 'Save name' : 'Add category'}</button>
  ${old ? `<div class="card stack"><h3>Remove this category</h3>
    ${its.length ? `<label class="f">Move its ${its.length} item${its.length === 1 ? '' : 's'} to${categoryPicker('moveTo', d.moveTo, 'moveNew', d.moveNew, true, old)}</label>` : '<p class="small muted">No items use it.</p>'}
    <button class="btn danger block" data-act="removeCat" data-confirm="Tap again to remove">Remove category</button></div>` : ''}`;
}
// Move every item in `from` to `to` (category field only). Returns how many failed.
async function moveCategoryItems(from, to) {
  let failed = 0;
  for (const it of itemsInCat(from)) {
    if (str(it.category).trim() === to) continue;
    if (!(await write(() => S.db.collection('items').doc(it.id).update({ category: to })))) failed++;
  }
  return failed;
}
async function writeSavedCats(list) {
  const uniq = []; for (const c of list) if (c && !uniq.some((u) => u.toLowerCase() === c.toLowerCase())) uniq.push(c);
  if (JSON.stringify(uniq) === JSON.stringify(savedCats())) return true;
  return write(() => S.db.doc('settings/main').set({ ...S.settings, categories: uniq }));
}
function moreSettings() {
  const d = (S.setDraft ||= { threshold: S.settings.threshold ?? '', lowProduct: S.settings.lowProduct ?? 5, lowPackaging: S.settings.lowPackaging ?? 10, giftKit: clone(S.settings.giftKit || []), pouchKit: clone(S.settings.pouchKit || []) });
  return `<div class="stack" data-draft="settings">
   <div class="card stack"><h3>Packaging suggestion</h3>
    ${field('Suggest the gift kit for orders of at least', 'threshold', d.threshold, { type: 'number', rupee: true, ph: 'not decided yet' })}
    <p class="small muted">Packaging is never used automatically. When this is set, the Sell screen suggests Gift kit at or above it and Pouch below it.</p></div>
   <div class="card stack"><h3>Gift kit contents</h3>${kitLines('settings', 'giftKit', d.giftKit, 'packaging')}</div>
   <div class="card stack"><h3>Pouch contents</h3>${kitLines('settings', 'pouchKit', d.pouchKit, 'packaging')}</div>
   <div class="card stack"><h3>Refill levels</h3><div class="grid2">${field('Products: refill at', 'lowProduct', d.lowProduct, { type: 'number' })}${field('Packaging: refill at', 'lowPackaging', d.lowPackaging, { type: 'number' })}</div>
    <p class="small muted">Defaults for items without their own level.</p></div>
   <button class="btn primary block" data-act="saveSettings">Save settings</button></div>`;
}
function moreHelp() {
  return `<div class="card stack"><h3>Let Claude update this for you</h3>
    <p>This stockroom is stored in your Claude account, so Claude can read and update it. In the Claude app on your computer, say things like:</p>
    <div class="tip"><span>“<b>TadaBoo:</b> sold 2 Sweet Treats bags to Riya, she paid ₹60 shipping, courier was ₹70, gift kit”</span></div>
    <div class="tip"><span>“<b>TadaBoo:</b> bought 100 paper bags for ₹450 from Amazon”</span></div>
    <div class="tip"><span>“<b>TadaBoo:</b> what’s running low?” or “how much profit this month?”</span></div>
    <div class="tip"><span>“<b>TadaBoo:</b> here’s a WhatsApp order, record it” or “refresh the website stock”</span></div>
    <p class="small muted">Claude shows you what it is about to record and waits for your OK before saving. Everything it adds appears in History and can be deleted.</p></div>`;
}

// ---------------------------------------------------------------- sheet + toast
let sheetOpener = null; // where keyboard focus goes back to when the panel closes
function renderSheet() { keepFocus(renderSheetNow); }
function renderSheetNow() {
  const host = $('#sheet');
  if (!S.sheet) {
    const was = !!host.dataset.key;
    host.innerHTML = ''; host.dataset.key = '';
    $('.app').inert = false;
    if (was && sheetOpener) { document.querySelector(sheetOpener.sel)?.focus({ preventScroll: true }); sheetOpener = null; }
    return;
  }
  // Redrawing the same panel (e.g. a background sync) keeps its scroll and skips the slide-in.
  const key = `${S.sheet.kind}:${S.sheet.k || ''}:${S.sheet.id || 'new'}`;
  const same = host.dataset.key === key, prevTop = same ? host.querySelector('.sheet')?.scrollTop || 0 : 0;
  if (!host.dataset.key) sheetOpener = focusKey();
  $('.app').inert = true; // the page behind an open panel can't be reached by keyboard or screen reader
  const body = { item: sheetItem, bag: sheetBag, entry: sheetEntry, purchase: sheetPurchase, cat: sheetCat, order: sheetOrder }[S.sheet.kind]();
  host.innerHTML = `<div class="scrim" data-act="scrim"><div class="sheet${same ? ' still' : ''}" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1" data-draft="sheet">${body}</div></div>`;
  const h = host.querySelector('.sheet h2'); if (h) h.id = 'sheet-title';
  host.dataset.key = key;
  if (prevTop) host.querySelector('.sheet').scrollTop = prevTop;
  if (!same) host.querySelector('.sheet').focus({ preventScroll: true });
  reapplyArmed(host);
}
let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), bad ? 6000 : 3000);
}

// ---------------------------------------------------------------- binding
const draftOf = (key) => ({ sell: S.sell, buy: S.buy, sheet: S.sheet?.draft, settings: S.setDraft, stockFilter: S.stock, bulk: S.bulk, orders: S.ord }[key]);
function setPath(obj, path, val) {
  const ks = path.split('.'); let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks.at(-1)] = val;
}
function getPath(obj, path) { return path.split('.').reduce((o, k) => o?.[k], obj); }
function onInput(e) {
  const el = e.target.closest('[data-bind]'); if (!el) return;
  // Text boxes already update on 'input'. Their 'change' fires when the user taps elsewhere,
  // and redrawing then would swallow that tap, so only selects and checkboxes use 'change'.
  // Date boxes are let through because older iPhones only report them on 'change'.
  if (e.type === 'change' && el.tagName !== 'SELECT' && el.type !== 'checkbox' && el.type !== 'date') return;
  if (e.type === 'input' && el.tagName === 'SELECT') return; // selects act once, on 'change'
  const key = el.dataset.draft || el.closest('[data-draft]')?.dataset.draft; const d = draftOf(key); if (!d) return;
  const path = el.dataset.bind;
  const val = el.type === 'checkbox' ? el.checked : el.value;
  setPath(d, path, val);
  if (key === 'sell') {
    const m = path.match(/^lines\.(\d+)\.(price|id)$/);
    if (m && m[2] === 'price') d.lines[+m[1]].priceEdited = true;
    if (m && m[2] === 'id') d.lines[+m[1]].priceEdited = false;
    syncSell();
  }
  if (key === 'buy') { const box = $('#buy-preview'); if (box) box.innerHTML = buyPreview(d); }
  if (key === 'bulk' && path === 'bulkCat') { renderView(); if (val === '__new') $('#bulkbar [data-bind="bulkNew"]')?.focus(); }
  if (key === 'stockFilter' && path === 'cat') renderView();
  else if (key === 'stockFilter' && path === 'sort') { S.stock.dir = SORT_DIR[S.stock.sort] || 'asc'; renderView(); }
  else if (key === 'stockFilter') { const box = $('#stock-list'); if (box) box.innerHTML = stockList(); }
  if (key === 'settings') S.setDirty = true;
  // Picking "+ New category…" (or back) shows/hides the name box; put the cursor in it straight away.
  if (key === 'sheet' && S.sheet.kind === 'item' && path === 'category') { renderSheet(); if (val === '__new') $('[data-draft="sheet"] [data-bind="newCat"]')?.focus(); }
  if (key === 'buy' && /^lines\.\d+\.newCategory$/.test(path)) { renderView(); if (val === '__new') $(`[data-bind="${path.replace('newCategory', 'newCatText')}"]`)?.focus(); }
  if (key === 'sheet' && S.sheet.kind === 'cat') {
    if (path === 'name') { const m = $('#cat-merge'), note = catMergeNote(d, S.sheet.id); if (m) { m.textContent = note; m.hidden = !note; } }
    if (path === 'moveTo') { renderSheet(); if (val === '__new') $('[data-draft="sheet"] [data-bind="moveNew"]')?.focus(); }
  }
  if (key === 'sheet' && S.sheet.kind === 'bag') { if (el.tagName === 'SELECT') renderSheet(); else updateBagPreview(); }
  if (key === 'sheet' && S.sheet.kind === 'purchase') { if (el.tagName === 'SELECT') renderSheet(); else { const b = $('#pur-preview'); if (b) b.innerHTML = purchaseEditPreview(d); } }
  if (key === 'sheet' && S.sheet.kind === 'order') { const o = S.orders.find((x) => x.id === S.sheet.id), b = $('#order-preview'); if (o && b) { const m = orderModel(o, d); b.innerHTML = orderPreview(m, m.totals); } }
  if (el.hasAttribute('data-rerender') && e.type === 'change') renderAll();
}
function updateBagPreview() {
  const d = S.sheet.draft, cost = d.contents.reduce((a, c) => a + n(c.qty) * (D.costs[c.itemId] || 0), 0);
  const cap = bagCapacity({ contents: d.contents.filter((c) => c.itemId) }, D.stock, D.itemsById);
  const box = $('#bag-preview'); if (box) box.innerHTML = `<div class="sum-row"><span>Cost of contents</span><b>${inr(cost)}</b></div><div class="sum-row"><span>Margin</span><b>${n(d.price) ? `${inr(n(d.price) - cost)} (${pct((n(d.price) - cost) / n(d.price))})` : '–'}</b></div><div class="sum-row"><span>Can make now</span><b>${cap.count}</b></div>`;
}
function renderView() { keepFocus(renderViewNow); }
function renderViewNow() { derive(); $('#view').innerHTML =({ home: viewHome, orders: viewOrders, stock: viewStock, sell: viewSell, buy: viewBuy, more: viewMore })[S.tab](); }
document.addEventListener('input', onInput);
document.addEventListener('change', onInput);
// A mouse wheel over an active number box changes its value in desktop browsers; let go of the box instead.
document.addEventListener('wheel', (e) => { if (e.target === document.activeElement && e.target.type === 'number') e.target.blur(); }, { passive: true });

// ---------------------------------------------------------------- actions
// Two-tap confirm, keyed by action + record so it survives background re-renders.
const CONFIRM_MS = 6000, CONFIRM_GAP_MS = 400;
let armed = { key: null, at: 0 };
const armKey = (el) => `${el.dataset.act}:${S.sheet?.k || ''}:${S.sheet?.id || ''}`;
function needsConfirm(el) {
  if (!el.dataset.confirm) return false;
  const age = Date.now() - armed.at;
  if (armed.key === armKey(el) && age < CONFIRM_MS) {
    if (age < CONFIRM_GAP_MS) return true; // a double-tap or ghost click is not a confirmation
    armed = { key: null, at: 0 }; $('#sr').textContent = ''; return false;
  }
  armed = { key: armKey(el), at: Date.now() }; el.textContent = el.dataset.confirm;
  $('#sr').textContent = el.dataset.confirm; // announced by screen readers; cleared when the prompt ends
  const mine = armed;
  setTimeout(() => {
    if (armed !== mine) return; // confirmed, cancelled or re-armed since
    armed = { key: null, at: 0 }; $('#sr').textContent = '';
    if (!editing() && document.querySelector('#sheet [data-confirm]')) renderSheet(); // reset the label without stealing the keyboard
  }, CONFIRM_MS + 100);
  return true;
}
function reapplyArmed(root) {
  if (!armed.key || Date.now() - armed.at >= CONFIRM_MS) return;
  for (const b of root.querySelectorAll('[data-confirm]')) if (armKey(b) === armed.key) b.textContent = b.dataset.confirm;
}
const A = {
  tab: (el) => { dropSettingsDraft(); S.bulk = null; S.tab = el.dataset.v; S.sheet = null; renderAll(); window.scrollTo(0, 0); },
  newCat: () => openCatSheet(''),
  editCat: (el) => openCatSheet(el.dataset.cat),
  // Add a new (empty) category, or rename/merge an existing one across all its items.
  saveCat: async () => {
    const { id: old, draft: d } = S.sheet, { name, other } = catPlan(d, old);
    if (!name) return toast('Give the category a name.', true);
    if (!old) {
      if (other) return toast(`“${other}” already exists.`, true);
      if (await writeSavedCats([...savedCats(), name])) { toast(`Added “${name}”`); S.sheet = null; renderAll(); }
      return;
    }
    const target = other || name;
    if (target === old) { S.sheet = null; return renderAll(); }
    const total = itemsInCat(old).length, failed = await moveCategoryItems(old, target);
    if (failed) { toast(`Updated ${total - failed} of ${total} items. ${failed} couldn’t be saved: tap Save again to finish.`, true); return renderAll(); }
    const list = savedCats(), had = list.some((c) => c.toLowerCase() === old.toLowerCase());
    await writeSavedCats(had ? [...list.filter((c) => c.toLowerCase() !== old.toLowerCase()), target] : list);
    toast(other ? `Merged “${old}” into “${other}”` : `Renamed to “${target}”`);
    S.sheet = null; renderAll();
  },
  // Remove a category: its items go to the chosen destination first (two taps to confirm).
  removeCat: async (el) => {
    const { id: old, draft: d } = S.sheet, count = itemsInCat(old).length;
    if (count && d.moveTo === '__choose') return toast('Choose where its items should go first.', true);
    if (count && d.moveTo === '__new' && !str(d.moveNew).trim()) return toast('Type a name for the new category, or pick one from the list.', true);
    if (needsConfirm(el)) return;
    if (count) {
      const to = resolveCategory(d.moveTo, d.moveNew), failed = await moveCategoryItems(old, to);
      if (failed) { toast(`Moved ${count - failed} of ${count} items. ${failed} couldn’t be saved: tap Remove again to finish.`, true); return renderAll(); }
    }
    await writeSavedCats(savedCats().filter((c) => c.toLowerCase() !== old.toLowerCase()));
    toast(`Removed “${old}”`); S.sheet = null; renderAll();
  },
  bulkStart: () => { S.bulk = { ids: new Set(), bulkCat: '__choose', bulkNew: '' }; renderView(); },
  bulkCancel: () => { S.bulk = null; renderView(); },
  bulkToggle: (el) => { const id = el.dataset.id, ids = S.bulk?.ids; if (!ids) return; ids.has(id) ? ids.delete(id) : ids.add(id); renderView(); },
  bulkAll: () => { for (const it of shownStockItems()) S.bulk.ids.add(it.id); renderView(); },
  // Moves each ticked item with its own small update (category only). Items that fail stay ticked for a retry.
  bulkApply: async () => {
    const b = S.bulk; if (!b) return;
    if (!b.ids.size) return toast('Tick at least one item first.', true);
    if (b.bulkCat === '__choose') return toast('Choose a category to move them to.', true);
    if (b.bulkCat === '__new' && !str(b.bulkNew).trim()) return toast('Type a name for the new category, or pick one from the list.', true);
    const target = resolveCategory(b.bulkCat, b.bulkNew), label = target || 'No category';
    const ids = [...b.ids], failed = [];
    for (const id of ids) {
      const it = D.itemsById[id];
      if (!it) { b.ids.delete(id); continue; } // removed elsewhere meanwhile
      if (str(it.category).trim() === target) { b.ids.delete(id); continue; }
      if (await write(() => S.db.collection('items').doc(id).update({ category: target }))) b.ids.delete(id); else failed.push(id);
    }
    const done = ids.length - failed.length;
    if (!failed.length) { S.bulk = null; toast(`Moved ${done} item${done === 1 ? '' : 's'} to ${label}`); }
    else toast(`Moved ${done} of ${ids.length}. ${failed.length} couldn’t be saved and ${failed.length === 1 ? 'is' : 'are'} still ticked: tap Move to try again.`, true);
    renderAll();
  },
  period: (el) => { S.period = el.dataset.v; renderAll(); },
  editPurchase: (el) => openPurchaseSheet(el.dataset.id),
  histSupplier: (el) => { S.histSupplier = el.dataset.v; S.historyLimit = 60; renderAll(); },
  // "See all" on Home: everything Low or Out, starting with products (packaging if only packaging needs a refill).
  gotoLow: () => {
    const prod = D.alerts.some((i) => i.type === 'product');
    Object.assign(S.stock, { type: prod ? 'product' : 'packaging', q: '', archived: false, filter: 'refill', sort: 'stock', dir: 'asc', cat: '' });
    S.tab = 'stock'; renderAll(); window.scrollTo(0, 0);
  },
  stockType: (el) => { S.stock.type = el.dataset.v; S.stock.filter = 'all'; fixStockCat(); renderAll(); },
  stockFilter: (el) => { S.stock.filter = el.dataset.v; renderAll(); },
  sortDir: () => { S.stock.dir = S.stock.dir === 'asc' ? 'desc' : 'asc'; renderView(); },
  // Tapping a column header sorts by it; tapping the same header again flips the direction.
  sortBy: (el) => {
    const k = el.dataset.v;
    if (S.stock.sort === k) S.stock.dir = S.stock.dir === 'asc' ? 'desc' : 'asc';
    else { S.stock.sort = k; S.stock.dir = SORT_DIR[k] || 'asc'; }
    renderView();
  },
  stockArchived: () => { S.stock.archived = !S.stock.archived; fixStockCat(); renderAll(); },
  more: (el) => { if (el.dataset.v !== S.more) dropSettingsDraft(); S.more = el.dataset.v; renderAll(); },
  moreHistory: () => { S.historyLimit += 100; renderAll(); },
  newItem: () => openItemSheet(null),
  editItem: (el) => openItemSheet(el.dataset.id),
  newBag: () => openBagSheet(null),
  editBag: (el) => openBagSheet(el.dataset.id),
  openEntry: (el) => { S.sheet = { kind: 'entry', k: el.dataset.k, id: el.dataset.id }; renderSheet(); },
  closeSheet: () => { S.sheet = null; armed = { key: null, at: 0 }; $('#sr').textContent = ''; renderSheet(); },
  // Tapping outside or Escape only closes a panel with nothing unsaved; the × always closes.
  scrim: (el, e) => { if (e.target === el) dismissSheet(); },
  setDraft: (el) => { S.sheet.draft[el.dataset.k] = el.dataset.v; renderSheet(); },
  addLine: (el) => {
    const key = el.closest('[data-draft]').dataset.draft, d = draftOf(key);
    getPath(d, el.dataset.path).push({ itemId: '', qty: 1 });
    if (key === 'settings') S.setDirty = true;
    key === 'sheet' ? renderSheet() : renderView();
  },
  rmLine: (el) => {
    const key = el.closest('[data-draft]').dataset.draft, d = draftOf(key);
    getPath(d, el.dataset.path).splice(+el.dataset.i, 1);
    if (key === 'settings') S.setDirty = true;
    key === 'sheet' ? renderSheet() : renderView();
  },
  // sell
  addSellLine: (el) => { S.sell.lines.push({ t: el.dataset.t, id: '', qty: 1, price: 0, priceEdited: false }); renderView(); },
  step: (el) => { const l = S.sell.lines[+el.dataset.i]; l.qty = Math.max(1, n(l.qty) + +el.dataset.d); syncSell(); renderView(); },
  setPack: (el) => { S.sell.pack = el.dataset.v; if (S.sell.pack === 'custom' && !S.sell.customPieces.length) S.sell.customPieces.push({ itemId: '', qty: 1 }); renderView(); },
  resetSell: () => { S.sell = blankSell(); renderView(); },
  saveSale: async (el) => {
    const m = sellModel(S.sell);
    if (!S.sell.lines.length) return toast('Add at least one bag or item first.', true);
    if (S.sell.lines.some((l) => !l.id)) return toast('Choose a bag or item on every line, or remove the empty line.', true);
    if (S.sell.lines.some((l) => !(n(l.qty) > 0))) return toast('Every line needs a quantity of at least 1.', true);
    if (negative(S.sell.shippingCharged, S.sell.courierCost, ...S.sell.lines.map((l) => l.price))) return toast('Prices and delivery amounts can’t be negative.', true);
    el.disabled = true;
    // The id lives on the draft until the save succeeds, so neither the automatic retry nor the
    // owner tapping Save again after an unclear failure can record the sale twice.
    const sid = (S.sell.id ||= newId('sales')), body = { ...m.sale, createdAt: nowIso() };
    const ok = await write(() => setDoc('sales', sid, body), `Sale saved · profit ${inr(m.totals.profit)}`);
    if (ok) { S.sell = blankSell(); renderAll(); } else el.disabled = false;
  },
  // buy
  addBuyLine: () => { S.buy.lines.push(blankBuyLine()); renderView(); },
  buyNewType: (el) => { S.buy.lines[+el.dataset.i].newType = el.dataset.v; renderView(); },
  resetBuy: () => { S.buy = blankBuy(); renderView(); },
  saveBuy: async (el) => {
    const d = S.buy, lines = d.lines.filter((l) => l.itemId && n(l.qty) > 0);
    if (!lines.length) return toast('Add at least one item with a quantity.', true);
    if (negative(d.extras.gst, d.extras.shipping, d.extras.other, ...d.lines.map((l) => l.unitPrice))) return toast('Prices and charges can’t be negative.', true);
    if (d.lines.some((l) => l.itemId && !(n(l.qty) > 0))) return toast('Every item needs a quantity above 0.', true);
    if (lines.some((l) => l.itemId === '__new' && !l.newName.trim())) return toast('Give each new item a name.', true);
    if (lines.some((l) => l.itemId === '__new' && l.newCategory === '__new' && !str(l.newCatText).trim())) return toast('Type a name for the new category, or pick one from the list.', true);
    el.disabled = true;
    const out = [];
    for (const l of lines) {
      let id = l.itemId;
      if (id === '__new') {
        id = newId('items');
        const ok = await write(() => setDoc('items', id, { name: l.newName.trim(), type: l.newType, category: resolveCategory(l.newCategory, l.newCatText), unit: 'pcs', sellPrice: null, lowAt: null, costOverride: null, supplier: d.supplier.trim(), note: '', check: false, archived: false, createdAt: nowIso() }));
        if (!ok) { el.disabled = false; return; }
        l.itemId = id; // a retry will not create it twice
      }
      out.push({ itemId: id, qty: n(l.qty), unitPrice: n(l.unitPrice) });
    }
    const doc = { date: d.date || today(), supplier: d.supplier.trim(), ref: d.ref.trim(), lines: out,
      extras: { gst: n(d.extras.gst), shipping: n(d.extras.shipping), other: n(d.extras.other) }, note: d.note.trim(), createdAt: nowIso() };
    const pid = (d.id ||= newId('purchases')); // kept on the draft until saved: no duplicate on re-tap
    const ok = await write(() => setDoc('purchases', pid, doc), `Purchase saved · ${inr(buyModel(d).total)}`);
    if (ok) { S.buy = blankBuy(); renderAll(); } else el.disabled = false;
  },
  // item sheet
  saveItem: async (el) => {
    const { id, draft: d } = S.sheet;
    if (!d.name.trim()) return toast('Give the item a name.', true);
    if (negative(d.sellPrice, d.costOverride, d.lowAt)) return toast('Prices, cost and refill level can’t be negative.', true);
    if (d.category === '__new' && !str(d.newCat).trim()) return toast('Type a name for the new category, or pick one from the list.', true);
    el.disabled = true;
    const iid = id || newId('items');
    const fields = (x) => ({ name: x.name.trim(), type: x.type, category: resolveCategory(x.category, x.newCat), unit: x.unit.trim() || 'pcs', sellPrice: nOrNull(x.sellPrice), lowAt: nOrNull(x.lowAt),
      costOverride: nOrNull(x.costOverride), supplier: x.supplier.trim(), note: x.note.trim(), check: !!x.check });
    if (id) {
      // Write only what the owner changed, so edits made meanwhile by Claude or another device survive.
      const changed = changedFields(fields(d), fields(JSON.parse(S.sheet.orig)));
      if (Object.keys(changed).length && !(await write(() => S.db.collection('items').doc(iid).update(changed)))) { el.disabled = false; return; }
    } else if (!(await write(() => setDoc('items', iid, { ...fields(d), archived: false, createdAt: nowIso() })))) { el.disabled = false; return; }
    if (!id) { S.sheet.id = iid; S.sheet.orig = JSON.stringify({ ...d, stockCount: d.stockAtOpen }); } // a retry after a failed stock write must not create the item again
    // Only a count the owner actually changed becomes an adjustment; the delta is taken
    // against live stock so sales synced while the sheet was open are not undone.
    if (Math.abs(n(d.stockCount) - n(d.stockAtOpen)) > 1e-9) {
      const delta = n(d.stockCount) - (D.stock[iid] ?? 0), aid = newId('adjustments');
      if (Math.abs(delta) > 1e-9) {
        const ok = await write(() => setDoc('adjustments', aid, { date: today(), itemId: iid, qty: delta, reason: id ? 'Manual count' : 'Opening stock', createdAt: nowIso() }));
        if (!ok) { el.disabled = false; return; }
      }
    }
    toast(id ? 'Item saved' : 'Item added'); S.sheet = null; renderAll();
  },
  archiveItem: async () => { const it = D.itemsById[S.sheet.id]; if (!it) return toast('This item was removed elsewhere.', true); if (await write(() => S.db.collection('items').doc(it.id).update({ archived: !it.archived }), it.archived ? 'Restored' : 'Archived')) { S.sheet = null; renderAll(); } },
  deleteItem: async (el) => {
    if (needsConfirm(el)) return;
    const id = S.sheet.id, own = S.adjustments.filter((a) => a.itemId === id);
    if (refsOf(id) - own.length) return toast('This item is used in purchases, sales or bags. Archive it instead.', true);
    for (const a of own) {
      // Entries go first, so a failure never leaves stock entries pointing at a deleted item.
      if (!(await write(() => delDoc('adjustments', a.id)))) return toast('Only partly deleted. Tap Delete again to finish.', true);
    }
    if (await write(() => delDoc('items', id), 'Item deleted')) { S.sheet = null; renderAll(); }
  },
  // bags
  saveBag: async (el) => {
    const { id, draft: d } = S.sheet, prev = id ? D.bagsById[id] : null;
    if (!d.name.trim()) return toast('Give the bag a name.', true);
    if (!d.contents.some((c) => c.itemId && n(c.qty) > 0)) return toast('Add at least one item to the bag.', true);
    if (negative(d.price)) return toast('The price can’t be negative.', true);
    el.disabled = true;
    const fields = (x) => ({ name: x.name.trim(), price: n(x.price), contents: x.contents.filter((c) => c.itemId && n(c.qty) > 0).map((c) => ({ itemId: c.itemId, qty: n(c.qty) })) });
    const save = id && prev
      ? (() => { const changed = changedFields(fields(d), fields(JSON.parse(S.sheet.orig))); return Object.keys(changed).length ? S.db.collection('bags').doc(id).update(changed) : Promise.resolve(); })
      : (() => setDoc('bags', id || (S.sheet.newId ||= newId('bags')), { ...fields(d), archived: false, createdAt: nowIso() }));
    if (await write(save, 'Bag saved')) { S.sheet = null; renderAll(); } else el.disabled = false;
  },
  archiveBag: async () => { const b = D.bagsById[S.sheet.id]; if (!b) return toast('This bag was removed elsewhere.', true); if (await write(() => S.db.collection('bags').doc(b.id).update({ archived: !b.archived }), b.archived ? 'Bag restored' : 'Bag archived')) { S.sheet = null; renderAll(); } },
  savePurchase: async (el) => {
    const { id, draft: d } = S.sheet;
    if (!S.purchases.some((p) => p.id === id)) return toast('This purchase was removed elsewhere.', true);
    if (negative(d.extras.gst, d.extras.shipping, d.extras.other, ...d.lines.map((l) => l.unitPrice))) return toast('Prices and charges can’t be negative.', true);
    if (d.lines.some((l) => l.itemId && !(n(l.qty) > 0))) return toast('Every item needs a quantity above 0.', true);
    if (!purchaseFields(d).lines.length) return toast('Keep at least one item with a quantity.', true);
    const changed = changedFields(purchaseFields(d), purchaseFields(JSON.parse(S.sheet.orig)));
    if (!Object.keys(changed).length) { S.sheet = null; return renderSheet(); }
    if (await write(() => S.db.collection('purchases').doc(id).update(changed), 'Purchase updated')) { S.sheet = null; renderAll(); }
  },
  // history
  deleteEntry: async (el) => { if (needsConfirm(el)) return; const { k, id } = S.sheet; if (await write(() => delDoc(k, id), 'Deleted. Stock updated.')) { S.sheet = null; renderAll(); } },
  // settings
  saveSettings: async (el) => {
    const d = S.setDraft, kit = (k) => k.filter((x) => x.itemId && n(x.qty) > 0).map((x) => ({ itemId: x.itemId, qty: n(x.qty) }));
    el.disabled = true;
    const body = { giftKit: kit(d.giftKit), pouchKit: kit(d.pouchKit), threshold: nOrNull(d.threshold), lowProduct: nOrNull(d.lowProduct) ?? 5, lowPackaging: nOrNull(d.lowPackaging) ?? 10 };
    if (negative(body.threshold, body.lowProduct, body.lowPackaging)) { el.disabled = false; return toast('Amounts and refill levels can’t be negative.', true); }
    // Keep fields this screen doesn't edit (e.g. the saved category list) instead of replacing the whole record.
    if (await write(() => S.db.doc('settings/main').set({ ...S.settings, ...body }), 'Settings saved')) { S.setDraft = null; S.setDirty = false; renderAll(); } else el.disabled = false;
  },
  // orders (website)
  ordRead: () => { const d = S.ord; d.parsed = str(d.paste).trim() ? parseOrder(d.paste) : { error: 'Paste the customer’s WhatsApp message first.' }; renderView(); },
  ordClear: () => { S.ord = { ...blankOrd(), filter: S.ord.filter }; renderView(); },
  ordFilter: (el) => { S.ord.filter = el.dataset.v; renderView(); },
  openOrder: (el) => openOrderSheet(el.dataset.id),
  saveOrder: async () => {
    const p = S.ord?.parsed; if (!p || p.error) return toast('Read an order first.', true);
    if (S.orders.some((o) => o.id === p.id)) return toast('This order is already saved.', true);
    const m = orderModel(p), at = nowIso();
    const body = { code: p.code, lines: p.lines, customer: p.customer, raw: p.raw, total: m.total, status: 'new', createdAt: at, updatedAt: at, history: [{ status: 'new', at }] };
    if (await write(() => setDoc('orders', p.id, body), `Order ${p.id} saved`)) {
      S.ord = { ...blankOrd(), filter: 'active' }; renderAll();
      if (S.orders.some((o) => o.id === p.id)) openOrderSheet(p.id);
    }
  },
  saveOrderConfirm: async () => {
    const { id, draft: d } = S.sheet, o = S.orders.find((x) => x.id === id);
    if (!o || o.status !== 'new') return toast('This order has already been confirmed or cancelled.', true);
    if (negative(d.shippingCharged, d.courierCost, d.kits)) return toast('Amounts and kit counts can’t be negative.', true);
    const m = orderModel(o, d); if (m.unknown.length) return toast('Some lines are not in the Stockroom. Add them first.', true);
    // The sale id comes from the order id, so a retry or a second tap can never record it twice.
    const saleId = `web-${o.id}`, at = nowIso();
    if (!(await write(() => setDoc('sales', saleId, { ...m.sale, createdAt: at })))) return;
    const ok = await write(() => S.db.collection('orders').doc(id).update({ status: 'confirmed', saleId, pack: m.pack, kits: m.kits, shippingCharged: n(d.shippingCharged), courierCost: n(d.courierCost),
      updatedAt: at, history: [...(Array.isArray(o.history) ? o.history : []), { status: 'confirmed', at }] }), `Confirmed · stock updated · profit ${inr(m.totals.profit)}`);
    if (ok) { orderStepAt = Date.now(); S.sheet.orig = JSON.stringify(S.sheet.draft); renderAll(); afterOrderStep('Order confirmed. Stock updated. Website stock file is now out of date.'); }
  },
  saveOrderStatus: async (el) => {
    if (Date.now() - orderStepAt < 1200) return; // the tap that confirmed or moved the order, landing on the new button
    const { id, draft: d } = S.sheet, o = S.orders.find((x) => x.id === id), to = el.dataset.v, at = nowIso();
    if (!o || ORDER_NEXT[o.status]?.[0] !== to) return toast('This order changed elsewhere. Close and reopen it.', true);
    const body = { status: to, updatedAt: at, history: [...(Array.isArray(o.history) ? o.history : []), { status: to, at }], ...(o.status === 'packed' ? { tracking: str(d.tracking).trim() } : {}) };
    if (await write(() => S.db.collection('orders').doc(id).update(body), `Marked ${ORDER_LABEL[to].toLowerCase()}`)) { orderStepAt = Date.now(); S.sheet.orig = JSON.stringify(S.sheet.draft); renderAll(); afterOrderStep(`Order ${ORDER_LABEL[to].toLowerCase()}`); }
  },
  saveOrderBack: async () => {
    if (Date.now() - orderStepAt < 1200) return;
    const id = S.sheet.id, o = S.orders.find((x) => x.id === id), to = ORDER_PREV[o?.status], at = nowIso(); if (!to) return;
    if (await write(() => S.db.collection('orders').doc(id).update({ status: to, updatedAt: at, history: [...(Array.isArray(o.history) ? o.history : []), { status: to, at, undo: true }] }), `Back to ${ORDER_LABEL[to].toLowerCase()}`)) { orderStepAt = Date.now(); renderAll(); afterOrderStep(`Order back to ${ORDER_LABEL[to].toLowerCase()}`); }
  },
  deleteOrderCancel: async (el) => {
    if (needsConfirm(el)) return;
    const id = S.sheet.id, o = S.orders.find((x) => x.id === id), at = nowIso(); if (!o) return;
    // Deleting the order's sale puts its items and packaging back into stock.
    if (o.saleId && S.sales.some((x) => x.id === o.saleId) && !(await write(() => delDoc('sales', o.saleId)))) return;
    if (await write(() => S.db.collection('orders').doc(id).update({ status: 'cancelled', updatedAt: at, history: [...(Array.isArray(o.history) ? o.history : []), { status: 'cancelled', at }] }),
      o.saleId ? 'Order cancelled · stock put back' : 'Order cancelled')) { orderStepAt = Date.now(); S.sheet.orig = JSON.stringify(S.sheet.draft); renderAll(); afterOrderStep('Order cancelled'); }
  },
  stockFile: async () => {
    if (!S.downloads) return;
    derive();
    try {
      await S.downloads.save({ filename: 'stock.json', data: stockFileJson() });
      await write(() => S.db.doc('settings/web').set({ ...(S.web || {}), stockExportedAt: nowIso() }));
      toast('Saved stock.json. Upload it with the website (next to index.html).');
    }
    catch (e) { if (e?.code !== 'declined') toast('Could not save the stock file.', true); }
  },
  export: () => exportXlsx(),
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const act = el.dataset.act, f = A[act]; if (!f) return;
  if (act !== 'scrim') e.preventDefault();
  // One write action at a time: re-renders during a save redraw enabled buttons,
  // so a second tap must be refused here rather than by el.disabled.
  if (/^(save|delete|archive|bulkApply|removeCat)/.test(act)) {
    if (S.saving) return;
    S.saving = true;
    Promise.resolve(f(el, e)).finally(() => { S.saving = false; });
    return;
  }
  f(el, e);
});
// Leaving Settings without saving discards the draft, so later changes from elsewhere show up.
function dropSettingsDraft() { S.setDraft = null; S.setDirty = false; }
const sheetDirty = () => !!(S.sheet?.draft && S.sheet.orig && JSON.stringify(S.sheet.draft) !== S.sheet.orig);
function dismissSheet() {
  if (sheetDirty()) return toast('You have unsaved changes. Save them, or tap × to discard.');
  A.closeSheet();
}
document.addEventListener('keydown', (e) => {
  // Tick rows in select mode act like checkboxes: Space or Enter toggles.
  const pick = e.target.closest?.('[role="checkbox"][data-act="bulkToggle"]');
  if (pick && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); A.bulkToggle(pick); return; }
  if (!S.sheet) return;
  if (e.key === 'Escape') return dismissSheet();
  if (e.key !== 'Tab') return;
  // Keep Tab cycling inside the open panel.
  const sheet = $('.sheet'); if (!sheet) return;
  const f = [...sheet.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && !x.hidden);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1], at = document.activeElement;
  if (e.shiftKey && (at === first || at === sheet)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
});

// ---------------------------------------------------------------- export
async function exportXlsx() {
  if (!window.XLSX) return toast('Excel export could not load. Check your connection and try again.', true);
  derive();
  const X = window.XLSX, wb = X.utils.book_new();
  const add = (name, rows) => X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows), name);
  const r2 = (v) => Math.round(v * 100) / 100;
  add('Stock', S.items.map((i) => ({ Name: i.name, Type: i.type, Category: i.category, Stock: D.stock[i.id] ?? 0, Status: i.archived ? 'archived' : D.st(i), 'Refill at': D.lowAt(i),
    'Avg cost': r2(D.costs[i.id] || 0), 'Sell price': i.sellPrice ?? '', 'Stock value': r2(Math.max(0, D.stock[i.id] || 0) * (D.costs[i.id] || 0)), Supplier: i.supplier, Check: i.check ? 'yes' : '', Note: i.note })));
  add('Sales', [...S.sales].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).map((s) => { const t = saleTotals(s, D.costs, S.bags); return { Date: s.date, What: saleTitle(s), Customer: s.customer, Packaging: s.packaging?.mode,
    'Item sales': r2(t.revenue - n(s.shippingCharged)), 'Shipping charged': n(s.shippingCharged), Revenue: r2(t.revenue), 'Item cost': r2(t.itemCost), 'Packaging cost': r2(t.packCost), Courier: r2(t.courier), Profit: r2(t.profit), Note: s.note }; }));
  add('Purchases', S.purchases.flatMap((p) => landedLines(p).map((l) => ({ Date: p.date, Supplier: p.supplier, Ref: p.ref, Item: itemName(l.itemId), Qty: l.qty, 'Unit price': r2(l.unitPrice), 'Landed cost': r2(l.landed), 'Line total': r2(l.qty * l.landed) }))));
  add('Stock corrections', S.adjustments.map((a) => ({ Date: a.date, Item: itemName(a.itemId), Change: a.qty, Reason: a.reason })));
  add('Gift bags', S.bags.map((b) => { const c = (b.contents || []).reduce((a, x) => a + n(x.qty) * (D.costs[x.itemId] || 0), 0); return { Bag: nameOf(b), Price: n(b.price), Cost: r2(c), Margin: r2(n(b.price) - c), 'Can make': bagCapacity(b, D.stock, D.itemsById).count, Contents: (b.contents || []).map((x) => `${x.qty} × ${itemName(x.itemId)}`).join('; '), Archived: b.archived ? 'yes' : '' }; }));
  const mon = summary(S.sales, D.costs, S.bags, { from: today().slice(0, 8) + '01', to: today().slice(0, 8) + '31' }), all = summary(S.sales, D.costs, S.bags, {});
  add('Summary', ['revenue', 'itemCost', 'packCost', 'courier', 'profit', 'orders'].map((k) => ({ Measure: { revenue: 'Revenue', itemCost: 'Item cost', packCost: 'Packaging cost', courier: 'Courier', profit: 'Profit', orders: 'Orders' }[k], 'This month': r2(mon[k]), 'All time': r2(all[k]) })));
  const data = X.write(wb, { bookType: 'xlsx', type: 'array' });
  try { await S.downloads.save({ filename: `TadaBoo-stockroom-${today()}.xlsx`, data }); toast('Excel file saved'); }
  catch (e) { if (e?.code !== 'declined') toast('Could not save the Excel file.', true); }
}

// Table headings stick just below the app bar; measure it (it is not sticky on short screens).
function syncBarHeight() {
  const bar = $('.top');
  const h = getComputedStyle(bar).position === 'sticky' ? bar.offsetHeight : 0;
  document.documentElement.style.setProperty('--bar-h', `${h}px`);
}
try { new ResizeObserver(syncBarHeight).observe($('.top')); } catch { /* very old browsers: headings simply scroll */ }
window.addEventListener('resize', syncBarHeight);
syncBarHeight();

// ---------------------------------------------------------------- boot
renderAll();
connect();
