import { S, esc } from '../core.js';

const CTRL = ['CCS', 'BMS', 'CMB', 'FWC', 'STC', 'DEH', 'GEN', 'BOP'];

function loopRows(node) {
  const c = S.catalog.nodes[node];
  const rows = c.loops.map(
    (l) => `<tr class="click" data-fp="loop:${node}:${l.name}">
      <td class="mono">${esc(l.name)}</td><td>${esc(l.desc)}</td>
      <td class="r mono" data-v="${node}:${l.name}.PV">--</td><td class="r mono" data-v="${node}:${l.name}.SP">--</td><td>${esc(l.pvUnits || '')}</td>
      <td class="r mono" data-v="${node}:${l.name}.OUT">--</td><td>${esc(l.outUnits || '')}</td>
      <td><span class="mode-pill" data-mode="${node}:${l.name}">MAN</span></td></tr>`,
  );
  const st = c.stations.map(
    (s) => `<tr class="click" data-fp="station:${node}:${s.name}">
      <td class="mono">${esc(s.name)}</td><td>${esc(s.desc)} <span style="color:var(--muted)">(M/A station)</span></td>
      <td class="r mono" data-v="${node}:${s.name}.FB">--</td><td class="r mono" data-v="${node}:${s.name}.IN">--</td><td>%</td>
      <td class="r mono" data-v="${node}:${s.name}.OUT">--</td><td>%</td>
      <td><span class="mode-pill" data-mode="${node}:${s.name}">MAN</span></td></tr>`,
  );
  return rows.concat(st).join('');
}

function devRows(node) {
  return S.catalog.nodes[node].devices
    .map((d) => {
      const on = d.type === 'valve' ? `${node}:${d.name}.OPENED` : `${node}:${d.name}.RUN`;
      return `<tr class="click" data-fp="dev:${node}:${d.name}"><td class="mono">${esc(d.name)}</td><td>${esc(d.desc)}</td>
        <td><span class="ind" data-on="${on}"></span></td><td><span class="ind bad" data-on="${node}:${d.name}.TRIP"></span></td>
        <td><span class="ind warn" data-on="${node}:${d.name}.ILK"></span></td><td class="mono" data-v="${node}:${d.name}.MODE">--</td></tr>`;
    })
    .join('');
}

export default {
  id: 'loops',
  title: 'Control Loops',
  render(root) {
    root.innerHTML = `<div class="cols" style="grid-template-columns:minmax(0,1.7fr) minmax(0,1fr)">
      <div class="panel" style="overflow:auto;min-height:0"><h3>Regulatory control loops (PID) and manual/auto stations</h3>
        <table class="tbl"><tr><th>Tag</th><th>Description</th><th class="r">PV / FB</th><th class="r">SP / IN</th><th></th><th class="r">OUT</th><th></th><th>Mode</th></tr>
        ${CTRL.map((n) => `<tr><td colspan="8" style="background:#141920;color:var(--accent);font-weight:700">${n} &mdash; ${esc(S.catalog.nodes[n].title)}</td></tr>${loopRows(n)}`).join('')}</table></div>
      <div class="panel" style="overflow:auto;min-height:0"><h3>Motors, valves and breakers</h3>
        <table class="tbl"><tr><th>Tag</th><th>Description</th><th>On</th><th>Trip</th><th>Ilk</th><th>Mode</th></tr>
        ${CTRL.map((n) => (S.catalog.nodes[n].devices.length ? `<tr><td colspan="6" style="background:#141920;color:var(--accent);font-weight:700">${n}</td></tr>${devRows(n)}` : '')).join('')}</table></div>
    </div>`;
  },
};
