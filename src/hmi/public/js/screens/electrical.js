import { val, onUpdate } from '../core.js';
import { svgRoot, pipe, txt, title, vbox, loopTag, ind, stext } from '../svg.js';
import { kv, indRow, wbtn, pbtn, numSet, attachControls, panel, split } from '../ui.js';

const PQ = { x: 900, y: 650, r: 165 }; // capability diagram origin and 1 pu radius (823.5 MVA)

function breaker(x, y, node, dev, label) {
  return `<g class="dev clickable" data-st="${node}:${dev}" data-fp="dev:${node}:${dev}" transform="translate(${x},${y})">
    <rect class="body" x="-14" y="-14" width="28" height="28"/><text class="tag" x="34" y="4" style="text-anchor:start">${label}</text></g>`;
}

function mimic() {
  const s = [];
  s.push(title(20, 28, 'GENERATOR, EXCITATION & 400 kV CONNECTION'));
  // Single line
  s.push(`<circle class="equip" cx="160" cy="560" r="46"/>`, txt(160, 556, 'G', 'title'), txt(160, 574, '823.5 MVA', 'lbl-s', 'middle'));
  s.push(txt(160, 625, '22 kV  3600 rpm  60 Hz  H2 cooled', 'lbl-s', 'middle'));
  s.push(pipe([[160, 514], [160, 470]], 'elec'), breaker(160, 456, 'GEN', 'GCB', '52G GENERATOR CB'));
  s.push(pipe([[160, 442], [160, 380]], 'elec'));
  s.push(`<circle cx="160" cy="360" r="22" fill="none" stroke="#e7e9ec" stroke-width="2.5"/><circle cx="160" cy="330" r="22" fill="none" stroke="#e7e9ec" stroke-width="2.5"/>`);
  s.push(txt(196, 350, 'GSU 22/400 kV', 'lbl-s'));
  s.push(pipe([[160, 308], [160, 230]], 'elec'), pipe([[60, 230], [420, 230]], 'elec'), txt(60, 220, '400 kV SWITCHYARD', 'lbl-s'));
  s.push(pipe([[260, 230], [260, 150]], 'elec', { arrow: true }), txt(270, 150, 'GRID', 'lbl-b'));
  s.push(vbox(290, 180, 'PLANT:GRID_KV', { label: 'Grid voltage', dp: 1 }), vbox(290, 250, 'PLANT:GRID_FREQ', { label: 'Grid frequency', dp: 3 }));
  // UAT
  s.push(pipe([[160, 420], [80, 420], [80, 380]], 'elec thin'), `<circle cx="80" cy="366" r="12" fill="none" stroke="#e7e9ec" stroke-width="2"/>`, txt(20, 345, 'UAT', 'lbl-s'));
  s.push(vbox(20, 390, 'PLANT:AUX_MW', { label: 'Aux load', w: 50 }));
  // Exciter
  s.push(pipe([[206, 560], [280, 560]], 'elec thin'), breaker(296, 560, 'GEN', 'FCB', '41 FIELD CB'));
  s.push(`<rect class="equip" x="270" y="610" width="80" height="34" rx="3"/>`, txt(310, 632, 'AVR / EXC', 'lbl-s', 'middle'));
  s.push(pipe([[296, 574], [296, 610]], 'elec thin'));
  s.push(loopTag(270, 660, 'GEN', 'AVR', { w: 80 }));
  // Generator values
  const gv = [
    ['PLANT:GEN_MW', 'Active power', 1],
    ['PLANT:GEN_MVAR', 'Reactive power', 1],
    ['PLANT:GEN_KV', 'Terminal voltage', 2],
    ['PLANT:GEN_KA', 'Stator current', 2],
    ['PLANT:GEN_PF', 'Power factor', 3],
    ['PLANT:GEN_FREQ', 'Frequency', 3],
    ['PLANT:LOAD_ANGLE', 'Load angle', 1],
    ['PLANT:FIELD_AMPS', 'Field current', 0],
    ['PLANT:FIELD_VOLTS', 'Field voltage', 0],
    ['PLANT:STATOR_TEMP', 'Stator temp', 0],
    ['PLANT:ROTOR_TEMP', 'Rotor temp', 0],
    ['PLANT:H2_TEMP', 'Cold H2 temp', 0],
  ];
  gv.forEach(([k, l, dp], i) => s.push(vbox(440 + (i % 2) * 120, 90 + Math.floor(i / 2) * 40, k, { label: l, dp, w: 64 })));
  // Synchroscope
  const cx = 1060;
  const cy = 180;
  s.push(`<circle cx="${cx}" cy="${cy}" r="110" fill="#11161b" stroke="#4a5563" stroke-width="2"/>`);
  for (let a = 0; a < 360; a += 30) {
    const r1 = a % 90 === 0 ? 92 : 100;
    const rad = ((a - 90) * Math.PI) / 180;
    s.push(`<line x1="${cx + r1 * Math.cos(rad)}" y1="${cy + r1 * Math.sin(rad)}" x2="${cx + 108 * Math.cos(rad)}" y2="${cy + 108 * Math.sin(rad)}" stroke="#8a94a3" stroke-width="2"/>`);
  }
  s.push(`<path d="M${cx - 18} ${cy - 104} A110 110 0 0 1 ${cx + 18} ${cy - 104}" stroke="#3fb950" stroke-width="8" fill="none"/>`);
  s.push(`<line class="needle" x1="${cx}" y1="${cy + 14}" x2="${cx}" y2="${cy - 92}" data-rot="PLANT:SYNC_PHASE" data-cx="${cx}" data-cy="${cy}"/>`, `<circle cx="${cx}" cy="${cy}" r="7" fill="#ffcc4d"/>`);
  s.push(txt(cx, cy + 56, 'SYNCHROSCOPE', 'lbl-s', 'middle'), txt(cx - 100, cy + 4, 'SLOW', 'lbl-s', 'middle'), txt(cx + 100, cy + 4, 'FAST', 'lbl-s', 'middle'));
  s.push(vbox(cx - 150, 310, 'PLANT:SYNC_SLIP', { label: 'Slip', dp: 3, w: 60 }), vbox(cx - 50, 310, 'PLANT:SYNC_PHASE', { label: 'Phase', dp: 1, w: 56 }), vbox(cx + 46, 310, 'GEN:DV_PCT', { label: 'dV', dp: 1, w: 50 }));
  s.push(ind(cx - 140, 360, 'GEN:SYNC_CHECK', { label: 'Synchro-check (25) OK' }), txt(cx + 20, 364, 'Sync state:', 'lbl-s'), stext(cx + 80, 364, 'GEN:SYNC_STATE', { cls: 'lbl-s' }));
  // P-Q capability diagram
  const { x, y, r } = PQ;
  s.push(txt(x - 150, y - r - 30, 'CAPABILITY DIAGRAM (P-Q)', 'lbl'));
  s.push(`<line x1="${x - r * 0.7}" y1="${y}" x2="${x + r * 1.1}" y2="${y}" stroke="#4a5563"/><line x1="${x}" y1="${y + 10}" x2="${x}" y2="${y - r - 10}" stroke="#4a5563"/>`);
  s.push(`<path d="M${x} ${y - r} A${r} ${r} 0 0 1 ${x + r * 0.8} ${y - r * 0.6} L${x + r * 0.9} ${y - r * 0.2} L${x + r * 0.9} ${y}" fill="none" stroke="#3fb950" stroke-width="2"/>`);
  s.push(`<path d="M${x} ${y - r} L${x - r * 0.45} ${y - r * 0.85} L${x - r * 0.55} ${y}" fill="none" stroke="#f0a020" stroke-width="2" stroke-dasharray="5 3"/>`);
  s.push(txt(x + r * 0.95, y + 14, '+Q (lag)', 'lbl-s'), txt(x - r * 0.75, y + 14, '-Q (lead)', 'lbl-s'), txt(x + 6, y - r - 4, 'P 700 MW', 'lbl-s'));
  s.push(`<circle id="pqdot" cx="${x}" cy="${y}" r="7" fill="#4ea1ff" stroke="#fff" stroke-width="2"/>`);
  // Protection strip
  s.push(`<rect class="zone" x="20" y="700" width="1190" height="60" rx="4"/>`);
  [
    ['GEN:LOCKOUT_86', '86G LOCKOUT', 'bad'],
    ['PLANT:GCB_CLOSED', '52G CLOSED', ''],
    ['PLANT:FCB_CLOSED', '41 CLOSED', ''],
    ['GEN:REV_POWER', 'REVERSE POWER', 'warn'],
    ['PLANT:OUT_OF_STEP', 'POLE SLIP', 'bad'],
    ['GEN:OEL_ACTIVE', 'OEL', 'warn'],
    ['GEN:UEL_ACTIVE', 'UEL', 'warn'],
    ['PLANT:GEN_DIFF_RELAY', '87G DIFF', 'bad'],
  ].forEach(([k, l, kind], i) => s.push(ind(40 + i * 145, 732, k, { label: l, kind })));
  return svgRoot(1220, 780, s.join(''));
}

function side() {
  return [
    panel(
      'Excitation / AVR',
      `<div class="row" style="margin-bottom:6px">${wbtn('VOLTAGE', 'GEN', 'EXC_MODE', 0)}${wbtn('MVAR', 'GEN', 'EXC_MODE', 1)}${wbtn('PF', 'GEN', 'EXC_MODE', 2)}</div>
      <div class="kv">${kv('AVR mode', 'GEN:AVR.MODE')}${kv('Voltage SP', 'GEN:AVR.SP', { dp: 2 })}${kv('Field demand', 'GEN:AVR.OUT', { dp: 3 })}${kv('V/Hz', 'GEN:VHZ')}</div>
      <div class="fp-line"><span>MVAr SP</span>${numSet('GEN', 'MVAR_SP')}</div>
      <div class="fp-line"><span>PF SP</span>${numSet('GEN', 'PF_SP')}</div>
      <div class="row" style="margin-top:6px"><button class="btn" data-open="dev:GEN:FCB">Field breaker 41...</button><button class="btn" data-open="loop:GEN:AVR">AVR faceplate...</button></div>`,
    ),
    panel(
      'Auto synchroniser',
      `<div class="kv">${kv('State', 'GEN:SYNC_STATE')}${kv('Slip', 'PLANT:SYNC_SLIP')}${kv('Phase angle', 'PLANT:SYNC_PHASE')}${kv('Voltage difference', 'GEN:DV_PCT')}</div>
      <div class="row" style="margin:8px 0">${pbtn('SYNC ON', 'GEN', 'SYNC_ON', { cls: 'ok' })}${pbtn('SYNC OFF', 'GEN', 'SYNC_OFF')}<button class="btn" data-open="dev:GEN:GCB">52G breaker...</button></div>
      ${indRow('Synchro-check permissive', 'GEN:SYNC_CHECK')}
      <p style="color:var(--muted);font-size:11px">Permissives: turbine latched in speed control above 3540 rpm, field breaker closed, AVR in auto. The synchroniser trims DEH speed (Modbus peer write GEN&rarr;DEH) and the AVR setpoint, and closes 52G just before phase coincidence.</p>`,
    ),
    panel(
      'Protection',
      `<div class="kv">${kv('86G lockout', 'GEN:LOCKOUT_86')}${kv('First-out', 'GEN:TRIP_CAUSE')}</div>
      <div class="row" style="margin-top:8px">${pbtn('RESET 86G', 'GEN', 'RESET_86', { cls: 'ok' })}${pbtn('TRIP 86G', 'GEN', 'TRIP_86', { cls: 'danger', confirm: true })}</div>`,
    ),
  ].join('');
}

export default {
  id: 'electrical',
  title: 'Electrical',
  render(root, { openFaceplate }) {
    root.innerHTML = split(mimic(), side(), 330);
    const off = attachControls(root);
    root.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', (e) => openFaceplate(b.dataset.open, e)));
    const dot = () => {
      const d = root.querySelector('#pqdot');
      if (!d) return;
      const p = (val('PLANT:GEN_MW') || 0) / 823.5;
      const q = (val('PLANT:GEN_MVAR') || 0) / 823.5;
      d.setAttribute('cx', PQ.x + q * PQ.r);
      d.setAttribute('cy', PQ.y - p * PQ.r);
    };
    dot();
    const off2 = onUpdate(dot);
    return {
      dispose() {
        off();
        off2();
      },
    };
  },
};
