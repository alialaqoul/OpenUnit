/**
 * HMI client core: live data store fed by Server-Sent Events, declarative bindings
 * (data-* attributes on HTML/SVG elements) and the write API.
 *
 * Binding attributes (key = "NODE:TAG"):
 *   data-v="KEY" [data-dp] [data-on-text/data-off-text]  value text
 *   data-st="NODE:DEVICE"                                  device status class (st-run/st-stop/st-trip/st-open)
 *   data-run="KEY" [data-trip="KEY"]                       plant equipment running / tripped
 *   data-on="KEY" [data-invert]                            toggles class "on"
 *   data-bar="KEY" data-min data-max [data-dir=h]          bar graph (rect) fill
 *   data-flow="KEY" [data-th]                              animated pipe when value > threshold
 *   data-rot="KEY" [data-scale] [data-cx data-cy]          rotation (synchroscope)
 *   data-alm="KEY"                                         alarm colouring (alm-1/2/3)
 *   data-mode="NODE:LOOP"                                  loop mode pill
 *   data-showif="KEY" [data-invert]                        visibility
 *   data-fp="kind:NODE:NAME"                               click opens faceplate
 */
export const S = {
  catalog: null,
  values: {},
  comm: {},
  alarms: [],
  counts: { total: 0, unack: 0, p1: 0, p2: 0, p3: 0 },
  events: [],
  diag: {},
  meta: new Map(),
  loops: new Map(),
  stations: new Map(),
  devices: new Map(),
  connected: false,
};

const listeners = new Set();
export const onUpdate = (fn) => (listeners.add(fn), () => listeners.delete(fn));

const scopes = new Set();

export function key(node, tag) {
  return `${node}:${tag}`;
}

function split(k) {
  const i = k.indexOf(':');
  return [k.slice(0, i), k.slice(i + 1)];
}

export function val(k) {
  const [n, t] = split(k);
  return S.values[n]?.[t];
}

export function meta(k) {
  return S.meta.get(k);
}

export function fmt(k, dp) {
  const v = val(k);
  const m = meta(k);
  if (v === undefined || v === null) return '----';
  if (m?.enum && typeof v === 'number') return m.enum[v] ?? String(v);
  if (typeof v === 'boolean') return v ? 'ON' : 'OFF';
  const d = dp ?? m?.dp ?? 1;
  return Number(v).toFixed(d);
}

export function units(k) {
  return meta(k)?.units || '';
}

export function alarmClass(k) {
  let best = 0;
  for (const a of S.alarms) {
    if (`${a.node}:${a.tag}` === k && a.state.startsWith('ACTIVE')) best = best ? Math.min(best, a.pri) : a.pri;
  }
  return best;
}

// ------------------------------------------------------------------ server communication
export async function loadCatalog() {
  const r = await fetch('/api/catalog');
  S.catalog = await r.json();
  for (const [node, c] of Object.entries(S.catalog.nodes)) {
    for (const t of c.tags) S.meta.set(key(node, t.name), t);
    for (const l of c.loops) S.loops.set(key(node, l.name), { node, ...l });
    for (const s of c.stations) S.stations.set(key(node, s.name), { node, ...s });
    for (const d of c.devices) S.devices.set(key(node, d.name), { node, ...d });
  }
  return S.catalog;
}

export function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => {
    S.connected = true;
  };
  es.onerror = () => {
    S.connected = false;
    emit({ connection: true });
  };
  es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    const changed = new Set();
    if (msg.type === 'full') {
      S.values = msg.values;
      for (const [n, vals] of Object.entries(msg.values)) for (const t of Object.keys(vals)) changed.add(key(n, t));
      S.events = msg.events || [];
    } else {
      for (const [n, vals] of Object.entries(msg.values || {})) {
        const dst = (S.values[n] ||= {});
        for (const [t, v] of Object.entries(vals)) {
          dst[t] = v;
          changed.add(key(n, t));
        }
      }
      if (msg.events) S.events = S.events.concat(msg.events).slice(-1000);
    }
    if (msg.comm) S.comm = msg.comm;
    if (msg.diag) S.diag = msg.diag;
    if (msg.counts) S.counts = msg.counts;
    let alarmsChanged = false;
    if (msg.alarms) {
      S.alarms = msg.alarms;
      alarmsChanged = true;
    }
    for (const sc of scopes) sc.update(changed, alarmsChanged);
    emit({ changed, alarmsChanged, events: msg.events, full: msg.type === 'full' });
  };
}

function emit(info) {
  for (const fn of listeners) {
    try {
      fn(info);
    } catch (err) {
      console.error(err);
    }
  }
}

export async function write(node, tag, value, source) {
  const r = await fetch('/api/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node, tag, value, source }),
  });
  const j = await r.json();
  if (!j.ok) toast(j.error || 'Write failed');
  return j.ok;
}

export const pulse = (node, tag) => write(node, tag, true);

export async function ack(id = 'ALL') {
  await fetch('/api/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
}

export function toast(text, kind = 'error') {
  let host = document.querySelector('.toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind === 'info' ? 'info' : ''}`;
  el.textContent = text;
  host.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

// ------------------------------------------------------------------ binding engine
const devState = (node, name) => {
  const d = S.devices.get(key(node, name));
  const g = (t) => S.values[node]?.[`${name}.${t}`];
  if (!d) return 'st-stop';
  if (g('TRIP')) return 'st-trip';
  if (d.type === 'valve') {
    if (g('OPENED')) return 'st-open';
    if (!g('CLOSED')) return 'st-trans';
    return 'st-stop';
  }
  return g('RUN') ? 'st-run' : 'st-stop';
};

const ST_CLASSES = ['st-run', 'st-stop', 'st-trip', 'st-open', 'st-trans'];

export function createScope(root, { onClick } = {}) {
  const byKey = new Map();
  const all = [];
  const add = (k, b) => {
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(b);
    all.push(b);
  };
  const els = root.querySelectorAll('[data-v],[data-st],[data-run],[data-on],[data-bar],[data-flow],[data-rot],[data-alm],[data-mode],[data-showif],[data-cls]');
  for (const el of els) {
    const ds = el.dataset;
    if (ds.v) add(ds.v, { el, type: 'v', k: ds.v });
    if (ds.st) {
      const [n, name] = split(ds.st);
      const b = { el, type: 'st', n, name };
      for (const t of ['RUN', 'TRIP', 'OPENED', 'CLOSED', 'ILK']) add(key(n, `${name}.${t}`), b);
    }
    if (ds.run) {
      const b = { el, type: 'run', k: ds.run, trip: ds.trip };
      add(ds.run, b);
      if (ds.trip) add(ds.trip, b);
    }
    if (ds.on) add(ds.on, { el, type: 'on', k: ds.on });
    if (ds.bar) add(ds.bar, { el, type: 'bar', k: ds.bar });
    if (ds.flow) add(ds.flow, { el, type: 'flow', k: ds.flow });
    if (ds.rot) add(ds.rot, { el, type: 'rot', k: ds.rot });
    if (ds.alm) all.push({ el, type: 'alm', k: ds.alm });
    if (ds.mode?.includes(':')) add(`${ds.mode}.MODE`, { el, type: 'mode', k: `${ds.mode}.MODE` });
    if (ds.showif) add(ds.showif, { el, type: 'show', k: ds.showif });
    if (ds.cls) {
      const [k, op, ref, cls] = ds.cls.split('|');
      add(k, { el, type: 'cls', k, op, ref: Number(ref), cls });
    }
  }
  const apply = (b) => {
    const el = b.el;
    switch (b.type) {
      case 'v': {
        const v = val(b.k);
        if (typeof v === 'boolean' && (el.dataset.onText || el.dataset.offText)) el.textContent = v ? el.dataset.onText || 'ON' : el.dataset.offText || 'OFF';
        else el.textContent = fmt(b.k, el.dataset.dp !== undefined ? Number(el.dataset.dp) : undefined);
        break;
      }
      case 'st': {
        el.classList.remove(...ST_CLASSES);
        el.classList.add(devState(b.n, b.name));
        el.classList.toggle('ilk', !!S.values[b.n]?.[`${b.name}.ILK`]);
        break;
      }
      case 'run': {
        el.classList.remove(...ST_CLASSES);
        el.classList.add(b.trip && val(b.trip) ? 'st-trip' : val(b.k) ? 'st-run' : 'st-stop');
        break;
      }
      case 'on': {
        let on = !!val(b.k);
        if (el.dataset.invert !== undefined) on = !on;
        el.classList.toggle('on', on);
        break;
      }
      case 'bar': {
        const v = Number(val(b.k)) || 0;
        const lo = Number(el.dataset.min ?? 0);
        const hi = Number(el.dataset.max ?? 100);
        const f = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
        const full = Number(el.dataset.len);
        if (el.dataset.dir === 'h') el.setAttribute('width', (full * f).toFixed(1));
        else {
          const y0 = Number(el.dataset.y0);
          el.setAttribute('height', (full * f).toFixed(1));
          el.setAttribute('y', (y0 + full * (1 - f)).toFixed(1));
        }
        break;
      }
      case 'flow': {
        const th = Number(el.dataset.th ?? 1);
        el.classList.toggle('flow', Math.abs(Number(val(b.k)) || 0) > th);
        break;
      }
      case 'rot': {
        const v = Number(val(b.k)) || 0;
        const s = Number(el.dataset.scale ?? 1);
        el.setAttribute('transform', `rotate(${(v * s).toFixed(1)} ${el.dataset.cx} ${el.dataset.cy})`);
        break;
      }
      case 'alm': {
        const a = alarmClass(b.k);
        el.classList.remove('alm-1', 'alm-2', 'alm-3');
        if (a) el.classList.add(`alm-${a}`);
        break;
      }
      case 'mode': {
        const m = val(b.k) ?? 0;
        const names = ['MAN', 'AUTO', 'CAS'];
        if (el.tagName.toLowerCase() === 'g') {
          el.classList.remove('m0', 'm1', 'm2');
          el.classList.add(`m${m}`);
          const t = el.querySelector('text');
          if (t) t.textContent = names[m] || '?';
        } else {
          el.textContent = names[m] || '?';
          el.className = `mode-pill ${names[m]}`;
        }
        break;
      }
      case 'show': {
        let on = !!val(b.k);
        if (el.dataset.invert !== undefined) on = !on;
        el.style.display = on ? '' : 'none';
        break;
      }
      case 'cls': {
        const v = Number(val(b.k));
        const ok = { gt: v > b.ref, lt: v < b.ref, eq: v === b.ref, ne: v !== b.ref }[b.op];
        el.classList.toggle(b.cls, !!ok);
        break;
      }
      default:
        break;
    }
  };
  const scope = {
    update(changed, alarmsChanged) {
      const done = new Set();
      for (const k of changed) {
        const list = byKey.get(k);
        if (!list) continue;
        for (const b of list) {
          if (done.has(b)) continue;
          done.add(b);
          apply(b);
        }
      }
      if (alarmsChanged) for (const b of all) if (b.type === 'alm') apply(b);
    },
    refresh() {
      for (const b of all) apply(b);
    },
    dispose() {
      scopes.delete(scope);
    },
  };
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-fp]');
    if (t && root.contains(t) && onClick) onClick(t.dataset.fp, e);
  });
  scopes.add(scope);
  scope.refresh();
  return scope;
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function simClock(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
