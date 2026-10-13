// Local test double for the claude db capability (used only on localhost; never published).
export function createDevDb() {
  const KEY = 'devdb-state';
  let state = JSON.parse(localStorage.getItem(KEY) || 'null');
  const ready = state ? Promise.resolve() : fetch('./seed.json').then((r) => r.json()).then((s) => { state = s; persist(); });
  const subs = [];
  const persist = () => localStorage.setItem(KEY, JSON.stringify(state));
  const coll = (c) => (state[c] ||= {});
  const snapOf = (c) => ({ docs: Object.entries(coll(c)).map(([id, d]) => ({ id, data: () => JSON.parse(JSON.stringify(d)) })) });
  const notify = () => { persist(); for (const s of subs) s(); };
  let n = 0;
  const docRef = (c, id) => ({
    id,
    set: async (body) => { await ready; coll(c)[id] = JSON.parse(JSON.stringify(body)); notify(); },
    update: async (body) => { await ready; if (!coll(c)[id]) throw { code: 'not_found' }; Object.assign(coll(c)[id], JSON.parse(JSON.stringify(body))); notify(); },
    delete: async () => { await ready; delete coll(c)[id]; notify(); },
    onSnapshot: (cb) => { const f = () => cb({ exists: !!coll(c)[id], data: () => JSON.parse(JSON.stringify(coll(c)[id] || {})) }); subs.push(f); ready.then(f); },
  });
  return {
    collection: (c) => ({
      doc: (id) => docRef(c, id || `dev${Date.now().toString(36)}${(n++).toString(36)}`),
      onSnapshot: (cb) => { const f = () => cb(snapOf(c)); subs.push(f); ready.then(f); },
    }),
    doc: (path) => { const [c, id] = path.split('/'); return docRef(c, id); },
  };
}
