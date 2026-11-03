import { S, val, fmt, meta, write, pulse, createScope, el, esc, key, onUpdate } from './core.js';
import { drawMini } from './trend.js';

const open = new Map();
let zTop = 100;

function place(fp, evt) {
  const w = 300;
  let x = evt ? evt.clientX + 18 : window.innerWidth / 2 - w / 2;
  let y = evt ? evt.clientY - 60 : 120;
  x = Math.min(Math.max(8, x), window.innerWidth - w - 8);
  y = Math.min(Math.max(60, y), window.innerHeight - 520);
  fp.style.left = `${x}px`;
  fp.style.top = `${Math.max(60, y)}px`;
}

function draggable(fp) {
  const head = fp.querySelector('.fp-head');
  head.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('x')) return;
    const ox = e.clientX - fp.offsetLeft;
    const oy = e.clientY - fp.offsetTop;
    fp.style.zIndex = ++zTop;
    const mv = (ev) => {
      fp.style.left = `${ev.clientX - ox}px`;
      fp.style.top = `${ev.clientY - oy}px`;
    };
    const up = () => {
      document.removeEventListener('mousemove', mv);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
  });
  fp.addEventListener('mousedown', () => (fp.style.zIndex = ++zTop));
}

function shell(id, node, name, desc, body) {
  return el(`<div class="fp" data-id="${esc(id)}">
    <div class="fp-head"><b>${esc(name)}</b><span class="node">${esc(node)}</span><span class="x" title="Close">&times;</span></div>
    <div class="fp-body"><div class="fp-desc">${esc(desc || '')}</div>${body}</div></div>`);
}

function numLine(label, inputId, btns = true) {
  return `<div class="fp-line"><span>${label}</span><input class="num" id="${inputId}" type="number" step="any"/>
    <button class="btn small" data-act="set-${inputId}">Set</button>
    ${btns ? `<button class="btn small" data-act="dn-${inputId}">&#9660;</button><button class="btn small" data-act="up-${inputId}">&#9650;</button>` : ''}</div>`;
}

function miniTrend(fp, keys, colors) {
  const cv = fp.querySelector('canvas.mini');
  if (!cv) return () => {};
  let alive = true;
  const load = async () => {
    if (!alive) return;
    try {
      const r = await fetch(`/api/history?seconds=900&tags=${encodeURIComponent(keys.join(','))}`);
      drawMini(cv, await r.json(), keys, colors);
    } catch {
      /* ignore */
    }
  };
  load();
  const t = setInterval(load, 5000);
  return () => {
    alive = false;
    clearInterval(t);
  };
}

export function openFaceplate(spec, evt) {
  if (open.has(spec)) {
    open.get(spec).style.zIndex = ++zTop;
    return;
  }
  const [kind, node, ...rest] = spec.split(':');
  const name = rest.join(':');
  let fp;
  let cleanup = [];
  if (kind === 'loop') ({ fp, cleanup } = loopFp(node, name));
  else if (kind === 'station') ({ fp, cleanup } = stationFp(node, name));
  else if (kind === 'dev') ({ fp, cleanup } = deviceFp(node, name));
  else if (kind === 'tag') ({ fp, cleanup } = tagFp(node, name));
  else if (kind === 'cmd') ({ fp, cleanup } = cmdFp(node, name));
  else if (kind === 'set') ({ fp, cleanup } = setFp(node, name));
  else return;
  fp.dataset.spec = spec;
  document.body.appendChild(fp);
  place(fp, evt);
  draggable(fp);
  fp.style.zIndex = ++zTop;
  const scope = createScope(fp);
  open.set(spec, fp);
  fp.querySelector('.x').addEventListener('click', () => {
    scope.dispose();
    cleanup.forEach((c) => c());
    fp.remove();
    open.delete(spec);
  });
}

export function closeAll() {
  for (const fp of open.values()) fp.querySelector('.x').click();
}

// ------------------------------------------------------------------ PID loop
function loopFp(node, name) {
  const L = S.loops.get(key(node, name));
  const k = (t) => key(node, `${name}.${t}`);
  const modes = L.cas ? ['MAN', 'AUTO', 'CAS'] : ['MAN', 'AUTO'];
  const body = `
    <div class="fp-bars">
      <div class="fp-bar"><label>PV</label><div class="track"><div class="fill" id="pvf"></div><div class="sp" id="spm"></div></div>
        <span class="num" data-v="${k('PV')}">--</span><label>${esc(L.pvUnits || '')}</label></div>
      <div class="fp-bar"><label>OUT</label><div class="track"><div class="fill out" id="outf"></div></div>
        <span class="num" data-v="${k('OUT')}" data-dp="1">--</span><label>${esc(L.outUnits || '')}</label></div>
    </div>
    <div class="kv" style="margin-bottom:8px"><span>Setpoint</span><span data-v="${k('SP')}">--</span><span>Range</span><span>${L.pvMin} .. ${L.pvMax} ${esc(L.pvUnits || '')}</span></div>
    <div class="fp-modes">${modes.map((m, i) => `<button class="btn" data-setmode="${i}">${m}</button>`).join('')}</div>
    ${numLine('SP', 'sp')}${numLine('OUT', 'out')}
    <div class="fp-flags"><span class="flag bad" id="f-ilk">INTERLOCK</span><span class="flag" id="f-trk">TRACKING</span><span class="flag" id="f-hi">HI LIMIT</span><span class="flag" id="f-lo">LO LIMIT</span><span class="flag good" id="f-cas">CAS AVAIL</span></div>
    <details class="tune"><summary>Tuning (live)</summary>
      ${numLine('Kp', 'kp', false)}${numLine('Ti s', 'ti', false)}${numLine('Td s', 'td', false)}
    </details>
    <canvas class="mini" width="560" height="160"></canvas>`;
  const fp = shell(`loop:${node}:${name}`, node, name, L.desc, body);
  const span = L.pvMax - L.pvMin || 1;
  const ospan = L.outMax - L.outMin || 1;
  const inputs = { sp: 'SP', out: 'OUT', kp: 'KP', ti: 'TI', td: 'TD' };
  const fill = () => {
    for (const [id, t] of Object.entries(inputs)) {
      const inp = fp.querySelector(`#${id}`);
      if (document.activeElement !== inp) inp.value = Number(val(k(t)) ?? 0).toFixed(t === 'KP' ? 3 : L.dp ?? 2);
    }
  };
  const refresh = () => {
    const pv = val(k('PV')) ?? 0;
    const sp = val(k('SP')) ?? 0;
    const out = val(k('OUT')) ?? 0;
    const mode = val(k('MODE')) ?? 0;
    const sts = val(k('STS')) ?? 0;
    fp.querySelector('#pvf').style.height = `${Math.max(0, Math.min(100, ((pv - L.pvMin) / span) * 100))}%`;
    fp.querySelector('#spm').style.bottom = `${Math.max(0, Math.min(100, ((sp - L.pvMin) / span) * 100))}%`;
    fp.querySelector('#outf').style.height = `${Math.max(0, Math.min(100, ((out - L.outMin) / ospan) * 100))}%`;
    fp.querySelectorAll('[data-setmode]').forEach((b) => b.classList.toggle('sel', Number(b.dataset.setmode) === mode));
    fp.querySelector('#f-ilk').classList.toggle('on', !!(sts & 1));
    fp.querySelector('#f-trk').classList.toggle('on', !!(sts & 2));
    fp.querySelector('#f-hi').classList.toggle('on', !!(sts & 4));
    fp.querySelector('#f-lo').classList.toggle('on', !!(sts & 8));
    fp.querySelector('#f-cas').classList.toggle('on', !!(sts & 16));
    fp.querySelector('#sp').disabled = mode !== 1;
    fp.querySelector('#out').disabled = mode !== 0;
    fill();
  };
  fp.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.setmode !== undefined) return write(node, `${name}.MODE`, Number(b.dataset.setmode));
    const act = b.dataset.act || '';
    const [op, id] = act.split('-');
    const tag = inputs[id];
    if (!tag) return;
    const cur = Number(val(k(tag)) ?? 0);
    if (op === 'set') write(node, `${name}.${tag}`, Number(fp.querySelector(`#${id}`).value));
    if (op === 'up' || op === 'dn') {
      const step = (tag === 'SP' ? span : ospan) * 0.01 * (op === 'up' ? 1 : -1);
      write(node, `${name}.${tag}`, cur + step);
    }
  });
  refresh();
  const off = onUpdate(refresh);
  const stop = miniTrend(fp, [k('PV'), k('SP'), k('OUT')], ['#4ea1ff', '#e5e5e5', '#d9a441']);
  return { fp, cleanup: [off, stop] };
}

// ------------------------------------------------------------------ M/A station
function stationFp(node, name) {
  const st = S.stations.get(key(node, name));
  const k = (t) => key(node, `${name}.${t}`);
  const body = `
    <div class="fp-bars">
      <div class="fp-bar"><label>OUT</label><div class="track"><div class="fill out" id="outf"></div></div><span class="num" data-v="${k('OUT')}">--</span></div>
      <div class="fp-bar"><label>FB</label><div class="track"><div class="fill" id="fbf"></div></div><span class="num" data-v="${k('FB')}">--</span></div>
    </div>
    <div class="kv" style="margin-bottom:8px"><span>Auto demand</span><span data-v="${k('IN')}">--</span><span>Bias</span><span data-v="${k('BIAS')}">--</span></div>
    <div class="fp-modes"><button class="btn" data-setmode="0">MAN</button><button class="btn" data-setmode="1">AUTO</button></div>
    ${numLine('OUT', 'out')}${numLine('BIAS', 'bias')}
    <div class="fp-flags"><span class="flag bad" id="f-ilk">FORCED MAN</span><span class="flag" id="f-trk">TRACKING</span></div>
    <canvas class="mini" width="560" height="160"></canvas>`;
  const fp = shell(`station:${node}:${name}`, node, name, st.desc, body);
  const span = st.outMax - st.outMin || 1;
  const refresh = () => {
    const out = val(k('OUT')) ?? 0;
    const fb = val(k('FB')) ?? 0;
    const mode = val(k('MODE')) ?? 0;
    const sts = val(k('STS')) ?? 0;
    fp.querySelector('#outf').style.height = `${Math.max(0, Math.min(100, ((out - st.outMin) / span) * 100))}%`;
    fp.querySelector('#fbf').style.height = `${Math.max(0, Math.min(100, ((fb - st.outMin) / span) * 100))}%`;
    fp.querySelectorAll('[data-setmode]').forEach((b) => b.classList.toggle('sel', Number(b.dataset.setmode) === mode));
    fp.querySelector('#f-ilk').classList.toggle('on', !!(sts & 1));
    fp.querySelector('#f-trk').classList.toggle('on', !!(sts & 2));
    for (const [id, t] of [['out', 'OUT'], ['bias', 'BIAS']]) {
      const inp = fp.querySelector(`#${id}`);
      if (document.activeElement !== inp) inp.value = Number(val(k(t)) ?? 0).toFixed(1);
    }
    fp.querySelector('#out').disabled = mode !== 0;
    fp.querySelector('#bias').disabled = mode !== 1;
  };
  fp.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.setmode !== undefined) return write(node, `${name}.MODE`, Number(b.dataset.setmode));
    const [op, id] = (b.dataset.act || '').split('-');
    const tag = id === 'out' ? 'OUT' : 'BIAS';
    if (op === 'set') write(node, `${name}.${tag}`, Number(fp.querySelector(`#${id}`).value));
    if (op === 'up' || op === 'dn') write(node, `${name}.${tag}`, Number(val(k(tag)) ?? 0) + span * 0.01 * (op === 'up' ? 1 : -1));
  });
  refresh();
  const off = onUpdate(refresh);
  const stop = miniTrend(fp, [k('OUT'), k('FB')], ['#d9a441', '#4ea1ff']);
  return { fp, cleanup: [off, stop] };
}

// ------------------------------------------------------------------ motors / valves / breakers
function deviceFp(node, name) {
  const d = S.devices.get(key(node, name));
  const k = (t) => key(node, `${name}.${t}`);
  const isValve = d.type === 'valve';
  const [lOn, lOff] = isValve ? d.labels || ['OPEN', 'CLOSE'] : ['START', 'STOP'];
  const tOn = isValve ? 'OPEN' : 'START';
  const tOff = isValve ? 'CLOSE' : 'STOP';
  const plantBase = d.plant || name;
  const ampsKey = key('PLANT', `${plantBase}_AMPS`);
  const amps = S.meta.has(ampsKey) ? `<span>Motor current</span><span><span data-v="${ampsKey}">--</span> A</span>` : '';
  const body = `
    <div style="text-align:center;margin:6px 0 10px"><span id="st" style="font-size:16px;font-weight:700;font-family:var(--mono)">--</span></div>
    <div class="kv" style="margin-bottom:8px">${amps}<span>Control mode</span><span id="md">--</span></div>
    <div class="row" style="margin-bottom:8px"><button class="btn ok" style="flex:1" data-cmd="${tOn}">${lOn}</button><button class="btn danger" style="flex:1" data-cmd="${tOff}">${lOff}</button></div>
    <div class="fp-modes"><button class="btn" data-setmode="0">MANUAL</button><button class="btn" data-setmode="1">${isValve ? 'AUTO' : 'AUTO / STANDBY'}</button></div>
    <div class="fp-flags"><span class="flag good" id="f-perm">PERMISSIVE</span><span class="flag bad" id="f-ilk">INTERLOCK</span><span class="flag bad" id="f-trip">TRIPPED</span></div>`;
  const fp = shell(`dev:${node}:${name}`, node, name, d.desc, body);
  const refresh = () => {
    const g = (t) => S.values[node]?.[`${name}.${t}`];
    // Valve "active" state texts: breakers (CLOSE/OPEN) are active when closed.
    const activeText = { OPEN: ['OPEN', 'CLOSED'], CLOSE: ['CLOSED', 'OPEN'], 'IN SERVICE': ['IN SERVICE', 'BYPASSED'] }[lOn] || ['ON', 'OFF'];
    let s;
    let active = false;
    if (g('TRIP')) s = 'TRIPPED';
    else if (isValve) {
      active = !!g('OPENED');
      s = active ? activeText[0] : g('CLOSED') ? activeText[1] : 'TRAVELLING';
    } else {
      active = !!g('RUN');
      s = active ? 'RUNNING' : 'STOPPED';
    }
    const st = fp.querySelector('#st');
    st.textContent = s;
    st.style.color = s === 'TRIPPED' ? 'var(--trip)' : active ? '#57d283' : 'var(--text)';
    fp.querySelector('#md').textContent = g('MODE') ? 'AUTO' : 'MANUAL';
    fp.querySelectorAll('[data-setmode]').forEach((b) => b.classList.toggle('sel', Number(b.dataset.setmode) === (g('MODE') ?? 0)));
    fp.querySelector('#f-perm').classList.toggle('on', !!g('PERM'));
    fp.querySelector('#f-ilk').classList.toggle('on', !!g('ILK'));
    fp.querySelector('#f-trip').classList.toggle('on', !!g('TRIP'));
  };
  fp.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.setmode !== undefined) write(node, `${name}.MODE`, Number(b.dataset.setmode));
    if (b.dataset.cmd) pulse(node, `${name}.${b.dataset.cmd}`);
  });
  refresh();
  const off = onUpdate(refresh);
  void k;
  return { fp, cleanup: [off] };
}

// ------------------------------------------------------------------ single tag (info + trend)
function tagFp(node, name) {
  const k = key(node, name);
  const m = meta(k) || {};
  const a = m.alarm || {};
  const lim = ['ll', 'l', 'h', 'hh'].filter((x) => a[x] !== undefined).map((x) => `<span>Alarm ${x.toUpperCase()}</span><span>${a[x]} ${esc(m.units || '')}</span>`).join('');
  const area = { ir: 'Input register', hr: 'Holding register', di: 'Discrete input', co: 'Coil' }[m.area] || m.area;
  const body = `
    <div style="text-align:center;margin:4px 0 10px"><span data-v="${k}" style="font-size:24px;font-family:var(--mono);font-weight:700">--</span> <span style="color:var(--muted)">${esc(m.units || '')}</span></div>
    <div class="kv"><span>Modbus</span><span>${esc(area)} ${m.address} (${m.type})</span><span>Node</span><span>${esc(node)} : ${S.catalog.nodes[node]?.port}</span>${
      m.plc ? `<span>OpenPLC</span><span class="mono">${esc(m.plc.ident)} AT ${esc(m.plc.loc)} : ${esc(m.plc.iec)}</span>` : ''
    }${lim}</div>
    ${m.type !== 'bool' ? '<canvas class="mini" width="560" height="160"></canvas>' : ''}`;
  const fp = shell(`tag:${k}`, node, name, m.desc, body);
  const stop = m.type !== 'bool' ? miniTrend(fp, [k], ['#4ea1ff']) : () => {};
  return { fp, cleanup: [stop] };
}

// ------------------------------------------------------------------ confirmed command (pulse)
function cmdFp(node, name) {
  const m = meta(key(node, name)) || {};
  const body = `<p style="margin:4px 0 12px">Execute <b>${esc(m.desc || name)}</b>?</p>
    <div class="row"><button class="btn danger" style="flex:1" data-go>EXECUTE</button><button class="btn" style="flex:1" data-cancel>CANCEL</button></div>`;
  const fp = shell(`cmd:${node}:${name}`, node, name, 'Confirm command', body);
  fp.addEventListener('click', (e) => {
    if (e.target.closest('[data-go]')) {
      pulse(node, name);
      fp.querySelector('.x').click();
    }
    if (e.target.closest('[data-cancel]')) fp.querySelector('.x').click();
  });
  return { fp, cleanup: [] };
}

// ------------------------------------------------------------------ numeric / enum setpoint entry
function setFp(node, name) {
  const k = key(node, name);
  const m = meta(k) || {};
  const enumBtns = m.enum ? `<div class="row" style="margin-bottom:8px">${m.enum.map((e, i) => `<button class="btn" style="flex:1" data-enum="${i}">${esc(e)}</button>`).join('')}</div>` : '';
  const body = `<div class="kv" style="margin-bottom:8px"><span>Present value</span><span><span data-v="${k}">--</span> ${esc(m.units || '')}</span></div>
    ${enumBtns}${m.enum ? '' : numLine('Value', 'nv', false)}`;
  const fp = shell(`set:${k}`, node, name, m.desc, body);
  const refresh = () => {
    if (m.enum) fp.querySelectorAll('[data-enum]').forEach((b) => b.classList.toggle('sel', Number(b.dataset.enum) === val(k)));
    else {
      const inp = fp.querySelector('#nv');
      if (document.activeElement !== inp) inp.value = fmt(k);
    }
  };
  fp.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.enum !== undefined) write(node, name, Number(b.dataset.enum));
    if (b.dataset.act === 'set-nv') write(node, name, Number(fp.querySelector('#nv').value));
  });
  refresh();
  const off = onUpdate(refresh);
  return { fp, cleanup: [off] };
}
