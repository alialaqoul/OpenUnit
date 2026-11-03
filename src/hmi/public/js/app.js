import { S, loadCatalog, connect, onUpdate, createScope, el, esc, ack, simClock, write, fmt } from './core.js';
import { openFaceplate } from './faceplates.js';
import overview from './screens/overview.js';
import boiler from './screens/boiler.js';
import combustion from './screens/combustion.js';
import bms from './screens/bms.js';
import turbine from './screens/turbine.js';
import feedwater from './screens/feedwater.js';
import condenser from './screens/condenser.js';
import perfScreen from './screens/performance.js';
import electrical from './screens/electrical.js';
import loops from './screens/loops.js';
import trends from './screens/trends.js';
import alarms from './screens/alarms.js';
import procedures from './screens/procedures.js';
import network from './screens/network.js';
import instructor from './screens/instructor.js';

const SCREENS = [overview, boiler, combustion, bms, turbine, feedwater, condenser, perfScreen, electrical, loops, trends, alarms, procedures, network, instructor];

let current = null;
let scope = null;
let horn = { silenced: true, ctx: null, lastSeq: 0 };

function header() {
  const h = document.getElementById('header');
  h.innerHTML = `
    <div class="brand"><b>UNIT 1 &middot; 700 MW</b><span>OpenUnit &middot; gas-fired steam power plant</span></div>
    <span class="sim-state" id="simstate" title="Instructor: run / freeze">RUN</span>
    <div class="kpi"><label>Sim time</label><span class="val" id="simtime">--</span></div>
    <div class="kpi"><label>Gross</label><span class="val"><span data-v="PLANT:GEN_MW" data-dp="1">--</span><small>MW</small></span></div>
    <div class="kpi"><label>Net</label><span class="val"><span data-v="PLANT:NET_MW" data-dp="1">--</span><small>MW</small></span></div>
    <div class="kpi"><label>Demand</label><span class="val"><span data-v="CCS:ULD_ACT" data-dp="0">--</span><small>MW</small></span></div>
    <div class="kpi"><label>Grid</label><span class="val"><span data-v="PLANT:GRID_FREQ" data-dp="3">--</span><small>Hz</small></span></div>
    <div class="kpi"><label>Throttle</label><span class="val"><span data-v="PLANT:MS_PRESS" data-dp="1">--</span><small>bar</small></span></div>
    <div class="kpi"><label>MS temp</label><span class="val"><span data-v="PLANT:MS_TEMP" data-dp="0">--</span><small>&deg;C</small></span></div>
    <div class="kpi"><label>Drum lvl</label><span class="val"><span data-v="FWC:DRUM_LVL_SEL" data-dp="0">--</span><small>mm</small></span></div>
    <div class="kpi"><label>Unit mode</label><span class="val" style="font-size:12px" data-v="CCS:MODE_ACT">--</span></div>
    <div class="spacer"></div>
    <div class="alarm-counts">
      <span class="badge p1" id="c1" title="Priority 1 alarms">0</span>
      <span class="badge p2" id="c2" title="Priority 2 alarms">0</span>
      <span class="badge p3" id="c3" title="Priority 3 alarms">0</span>
    </div>
    <div class="comm-dots" id="commdots"></div>
    <div class="kpi" style="min-width:60px"><label>Clock</label><span class="val" style="font-size:13px" id="clock">--</span></div>`;
  createScope(h);
  h.querySelector('#simstate').addEventListener('click', () => write('PLANT', 'SIM_RUN', !!S.values.PLANT?.SIM_FROZEN, 'Instructor'));
  for (const id of ['c1', 'c2', 'c3']) h.querySelector(`#${id}`).addEventListener('click', () => go('alarms'));
}

function updateHeader() {
  const p = S.values.PLANT || {};
  const st = document.getElementById('simstate');
  const frozen = !!p.SIM_FROZEN;
  st.classList.toggle('frozen', frozen);
  st.textContent = frozen ? 'FROZEN' : `RUN x${(p.SIM_SPEED_ACT ?? 1).toFixed(p.SIM_SPEED_ACT % 1 ? 1 : 0)}`;
  document.getElementById('simtime').textContent = simClock(p.SIM_TIME_MS);
  const c = S.counts;
  for (const i of [1, 2, 3]) {
    const b = document.getElementById(`c${i}`);
    b.textContent = c[`p${i}`] || 0;
    b.classList.toggle('act', (c[`p${i}`] || 0) > 0);
  }
  const dots = document.getElementById('commdots');
  dots.innerHTML = ['PLANT', 'CCS', 'BMS', 'CMB', 'FWC', 'STC', 'DEH', 'GEN', 'BOP']
    .map((n) => `<span class="comm-dot ${S.comm[n] ? '' : 'bad'}" title="${n} ${S.comm[n] ? 'online' : 'NO COMMUNICATION'}">${n === 'PLANT' ? 'I/O' : n}</span>`)
    .join('');
}

function banner() {
  const b = document.getElementById('banner');
  const active = S.alarms.slice().sort((x, y) => (y.state.endsWith('UNACK') ? 1 : 0) - (x.state.endsWith('UNACK') ? 1 : 0) || x.pri - y.pri || y.seq - x.seq);
  const rows = active
    .slice(0, 3)
    .map((a) => {
      const t = new Date(a.tIn || Date.now()).toLocaleTimeString();
      const v = typeof a.value === 'number' ? `${a.value.toFixed(1)} ${a.units || ''}` : '';
      return `<div class="alm-row p${a.pri} ${a.state.endsWith('UNACK') ? 'unack' : ''} ${a.state === 'RTN_UNACK' ? 'rtn' : ''}" data-id="${esc(a.id)}">
        <span class="pri">${a.pri}</span><span>${t}</span><span>${esc(a.node)}</span><span>${esc(a.text)}</span><span class="r">${esc(v)}</span><span>${a.state.replace('_', ' ')}</span></div>`;
    })
    .join('');
  b.innerHTML = `<div class="banner-list">${rows || '<div style="color:var(--muted);padding:6px">No active alarms</div>'}</div>
    <div class="banner-btns"><button class="btn" id="ackall">ACK ALL (${S.counts.unack || 0})</button><button class="btn" id="horn">${horn.silenced ? 'Horn: OFF' : 'Horn: ON'}</button></div>`;
  b.querySelector('#ackall').onclick = () => ack('ALL');
  b.querySelector('#horn').onclick = () => {
    horn.silenced = !horn.silenced;
    if (!horn.silenced && !horn.ctx) horn.ctx = new AudioContext();
    banner();
  };
  b.querySelectorAll('.alm-row').forEach((r) => (r.onclick = () => ack(r.dataset.id)));
}

function sound() {
  if (horn.silenced || !horn.ctx) return;
  const top = S.alarms.find((a) => a.state === 'ACTIVE_UNACK');
  if (!top || top.seq <= horn.lastSeq) return;
  horn.lastSeq = top.seq;
  const o = horn.ctx.createOscillator();
  const g = horn.ctx.createGain();
  o.frequency.value = top.pri === 1 ? 880 : 620;
  g.gain.value = 0.08;
  o.connect(g).connect(horn.ctx.destination);
  o.start();
  o.stop(horn.ctx.currentTime + 0.35);
}

function tabs() {
  const t = document.getElementById('tabs');
  t.innerHTML = SCREENS.map((s) => `<button data-id="${s.id}">${esc(s.title)}</button>`).join('');
  t.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) go(b.dataset.id);
  });
}

export function go(id) {
  if (location.hash !== `#${id}`) location.hash = id;
  else show(id);
}

function show(id) {
  const s = SCREENS.find((x) => x.id === id) || SCREENS[0];
  if (current?.dispose) current.dispose();
  if (scope) scope.dispose();
  const main = document.getElementById('screen');
  main.innerHTML = '';
  // Fresh host per visit so screen-level listeners are discarded with the screen.
  const host = document.createElement('div');
  host.className = 'screen-host';
  main.appendChild(host);
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.id === s.id));
  const res = s.render(host, { go, openFaceplate }) || {};
  current = res;
  scope = createScope(host);
}

async function main() {
  document.getElementById('screen').appendChild(el('<div style="padding:30px;color:var(--muted)">Connecting to SCADA server ...</div>'));
  await loadCatalog();
  header();
  tabs();
  connect();
  let first = true;
  onUpdate((info) => {
    if (first && info.full) {
      first = false;
      show(location.hash.slice(1) || 'overview');
    }
    updateHeader();
    if (info.alarmsChanged || info.events) {
      banner();
      sound();
    }
  });
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  document.getElementById('screen').addEventListener('click', (e) => {
    const t = e.target.closest('[data-fp]');
    if (t) openFaceplate(t.dataset.fp, e);
  });
  setInterval(() => (document.getElementById('clock').textContent = new Date().toLocaleTimeString()), 1000);
  banner();
  void fmt;
}

main();
