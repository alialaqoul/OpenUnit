import { S, onUpdate, ack, esc, simClock } from '../core.js';

let filter = { pri: 0, events: 'ALL' };

function alarmTable() {
  const rows = S.alarms
    .filter((a) => !filter.pri || a.pri === filter.pri)
    .map((a) => {
      const val = typeof a.value === 'number' ? a.value.toFixed(2) : a.value === true ? 'ON' : a.value === false ? 'OFF' : '';
      return `<tr class="alm-row p${a.pri} ${a.state.endsWith('UNACK') ? 'unack' : ''} ${a.state === 'RTN_UNACK' ? 'rtn' : ''}" style="display:table-row">
        <td><span class="pri" style="display:inline-block">${a.pri}</span></td><td class="mono">${new Date(a.tIn).toLocaleTimeString()}</td>
        <td class="mono">${esc(a.node)}</td><td class="mono">${esc(a.tag)}</td><td>${esc(a.text)}</td>
        <td class="r mono">${esc(val)} ${esc(a.units || '')}</td><td class="r mono">${a.limit ?? ''}</td><td>${a.state.replace(/_/g, ' ')}</td>
        <td>${a.state.endsWith('UNACK') ? `<button class="btn small" data-ack="${esc(a.id)}">ACK</button>` : ''}</td></tr>`;
    })
    .join('');
  return `<table class="tbl"><tr><th></th><th>Time</th><th>Node</th><th>Tag</th><th>Description</th><th class="r">Value</th><th class="r">Limit</th><th>State</th><th></th></tr>${rows || '<tr><td colspan="9" style="color:var(--muted)">No alarms</td></tr>'}</table>`;
}

function eventTable() {
  const ev = S.events
    .slice()
    .reverse()
    .filter((e) => filter.events === 'ALL' || e.type === filter.events || (filter.events === 'ALARM' && e.type === 'RTN'))
    .slice(0, 400);
  const color = { ALARM: 'var(--p2)', RTN: 'var(--muted)', OPERATOR: '#8cc8ff', INSTRUCTOR: '#c4b5ff', ACK: 'var(--muted)', COMM_FAIL: 'var(--p1)', IC: '#3fb950' };
  return `<table class="tbl"><tr><th>Wall time</th><th>Sim time</th><th>Type</th><th>Message</th></tr>${ev
    .map(
      (e) =>
        `<tr><td class="mono">${new Date(e.t).toLocaleTimeString()}</td><td class="mono">${simClock((e.sim || 0) * 1000)}</td><td style="color:${color[e.type] || 'inherit'}">${esc(e.type)}</td><td>${esc(e.text)}${e.value !== undefined && typeof e.value === 'number' ? ` (${e.value.toFixed(2)} ${esc(e.units || '')})` : ''}</td></tr>`,
    )
    .join('')}</table>`;
}

export default {
  id: 'alarms',
  title: 'Alarms & Events',
  render(root) {
    root.innerHTML = `<div class="cols" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)">
      <div class="panel grow"><div class="row" style="margin-bottom:8px"><h3 style="margin:0">Alarm summary</h3><span style="flex:1"></span>
        ${[0, 1, 2, 3].map((p) => `<button class="btn small" data-pri="${p}">${p ? `P${p}` : 'ALL'}</button>`).join('')}
        <button class="btn primary small" data-ackall>ACK ALL</button></div>
        <div id="atbl" class="scroll"></div></div>
      <div class="panel grow"><div class="row" style="margin-bottom:8px"><h3 style="margin:0">Event journal</h3><span style="flex:1"></span>
        ${['ALL', 'ALARM', 'OPERATOR', 'INSTRUCTOR', 'IC'].map((t) => `<button class="btn small" data-ev="${t}">${t}</button>`).join('')}</div>
        <div id="etbl" class="scroll"></div></div></div>`;
    const draw = () => {
      root.querySelector('#atbl').innerHTML = alarmTable();
      root.querySelector('#etbl').innerHTML = eventTable();
      root.querySelectorAll('[data-pri]').forEach((b) => b.classList.toggle('sel', Number(b.dataset.pri) === filter.pri));
      root.querySelectorAll('[data-ev]').forEach((b) => b.classList.toggle('sel', b.dataset.ev === filter.events));
    };
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.pri !== undefined) filter.pri = Number(b.dataset.pri);
      if (b.dataset.ev) filter.events = b.dataset.ev;
      if (b.dataset.ackall !== undefined) ack('ALL');
      if (b.dataset.ack) ack(b.dataset.ack);
      draw();
    });
    draw();
    const off = onUpdate((i) => (i.alarmsChanged || i.events?.length) && draw());
    return { dispose: off };
  },
};
