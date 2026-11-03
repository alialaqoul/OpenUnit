import { svgRoot, pipe, txt, title, vbox, valve, loopTag, pump, vessel, ind, bar } from '../svg.js';
import { kv, indRow, attachControls, panel, split } from '../ui.js';

function mimic() {
  const s = [];
  s.push(title(20, 28, 'CONDENSER, CIRCULATING WATER & VACUUM'));
  // LP exhaust
  s.push(pipe([[520, 60], [520, 140]], 'steam', { flow: 'PLANT:STEAM_FLOW', th: 20 }), pipe([[700, 60], [700, 140]], 'steam', { flow: 'PLANT:STEAM_FLOW', th: 20 }));
  s.push(txt(610, 56, 'LP TURBINE EXHAUST', 'lbl-s', 'middle'));
  s.push(vessel(440, 140, 340, 260, { lvl: 'PLANT:HW_LVL', min: 0, max: 3000, cls: 'cond' }));
  s.push(txt(610, 170, 'SURFACE CONDENSER', 'lbl-b', 'middle'));
  for (let i = 0; i < 6; i++) s.push(`<line x1="450" y1="${210 + i * 22}" x2="770" y2="${210 + i * 22}" stroke="#3cc4b4" stroke-width="2" opacity="0.5"/>`);
  s.push(vbox(560, 185, 'PLANT:COND_PRESS', { label: '', w: 60 }));
  // CW
  s.push(txt(20, 300, 'CW INTAKE', 'lbl-s'));
  s.push(pipe([[20, 310], [120, 310]], 'cw'), pipe([[20, 400], [120, 400]], 'cw'));
  s.push(pump(140, 310, { node: 'BOP', dev: 'CWP_A', label: 'CW PUMP A', r: 20 }), pump(140, 400, { node: 'BOP', dev: 'CWP_B', label: 'CW PUMP B', r: 20 }));
  s.push(pipe([[160, 310], [260, 310], [260, 270], [440, 270]], 'cw', { flow: 'PLANT:CW_FLOW', th: 1000 }), pipe([[160, 400], [260, 400], [260, 310]], 'cw', { flow: 'PLANT:CW_FLOW', th: 1000 }));
  s.push(pipe([[780, 300], [1000, 300], [1000, 360], [1200, 360]], 'cw', { flow: 'PLANT:CW_FLOW', th: 1000, arrow: true }), txt(1200, 350, 'CW OUTFALL', 'lbl-s', 'end'));
  s.push(vbox(290, 230, 'PLANT:CW_IN_T', { label: 'CW inlet', dp: 1 }), vbox(820, 260, 'PLANT:CW_OUT_T', { label: 'CW outlet', dp: 1 }), vbox(290, 330, 'PLANT:CW_FLOW', { label: 'CW flow', dp: 0, w: 80 }));
  // Vacuum pumps
  s.push(pipe([[780, 180], [940, 180], [940, 130], [1000, 130]], 'air thin'), pipe([[940, 180], [940, 220], [1000, 220]], 'air thin'));
  s.push(pump(1020, 130, { node: 'BOP', dev: 'VP_A', label: 'VACUUM PUMP A' }), pump(1020, 220, { node: 'BOP', dev: 'VP_B', label: 'VACUUM PUMP B' }));
  s.push(pipe([[1036, 130], [1120, 130]], 'air thin'), pipe([[1036, 220], [1120, 220]], 'air thin'), txt(1125, 134, 'to atm.', 'lbl-s'), txt(1125, 224, 'to atm.', 'lbl-s'));
  s.push(txt(860, 172, 'air extraction', 'lbl-s'));
  // Vacuum breaker & gland steam
  s.push(pipe([[440, 160], [400, 160], [400, 120]], 'air thin'), valve(400, 132, { node: 'BOP', dev: 'VB', orient: 'v', size: 9, label: 'VACUUM BREAKER', ldx: -66, ldy: 4 }));
  s.push(pipe([[120, 120], [300, 120], [300, 70], [520, 70]], 'steam thin', { flow: 'PLANT:GLAND_PRESS', th: 20 }), txt(20, 112, 'AUX STEAM', 'lbl-s'));
  s.push(valve(200, 120, { node: 'BOP', dev: 'GLAND', label: 'GLAND STEAM', ldy: -18 }));
  s.push(vbox(130, 70, 'PLANT:GLAND_PRESS', { label: 'Gland header', w: 56 }));
  // Hotwell & condensate out
  s.push(pipe([[610, 400], [610, 460], [700, 460]], 'cond', { flow: 'PLANT:CEP_FLOW', th: 5, arrow: true }), txt(706, 464, 'to condensate pumps', 'lbl-s'));
  s.push(vbox(470, 425, 'PLANT:HW_LVL', { label: 'Hotwell level', dp: 0 }), loopTag(470, 456, 'BOP', 'LIC_HW', { w: 90 }));
  s.push(vbox(820, 120, 'PLANT:LP_HOOD_TEMP', { label: 'LP hood temp', dp: 0 }));
  // Vacuum gauge bar
  s.push(`<rect class="zone" x="20" y="500" width="1190" height="260" rx="4"/>`, txt(30, 520, 'CONDENSER PERFORMANCE', 'lbl'));
  s.push(bar(40, 535, 30, 200, 'PLANT:COND_PRESS', { min: 0, max: 400, label: 'mbar(a)', cls: 'warm' }));
  s.push(`<line x1="34" y1="${535 + 200 * (1 - 15 / 40)}" x2="76" y2="${535 + 200 * (1 - 15 / 40)}" stroke="#f0a020" stroke-dasharray="3 2"/>`, txt(80, 535 + 200 * (1 - 15 / 40) + 4, 'alarm 150', 'lbl-s'));
  s.push(`<line x1="34" y1="${535 + 200 * (1 - 30 / 40)}" x2="76" y2="${535 + 200 * (1 - 30 / 40)}" stroke="#e5484d" stroke-dasharray="3 2"/>`, txt(80, 535 + 200 * (1 - 30 / 40) + 4, 'turbine trip 300', 'lbl-s'));
  s.push(ind(220, 560, 'BOP:VAC_OK', { label: 'Vacuum established (< 200 mbar)' }), ind(220, 585, 'BOP:CW_OK', { label: 'CW in service' }));
  s.push(ind(220, 610, 'PLANT:GLAND_ON', { label: 'Gland steam in service' }), ind(220, 635, 'PLANT:VB_OPEN', { label: 'Vacuum breaker open', kind: 'warn' }));
  s.push(ind(220, 660, 'DEH:LPB_ILK', { label: 'LP bypass interlocked', kind: 'bad' }));
  s.push(vbox(520, 560, 'PLANT:LPB_FLOW', { label: 'LP bypass flow', dp: 0 }), vbox(520, 610, 'PLANT:CEP_FLOW', { label: 'Condensate flow', dp: 0 }));
  s.push(vbox(700, 560, 'PLANT:MAKEUP_FB', { label: 'Make-up valve', dp: 0 }), vbox(700, 610, 'PLANT:HW_LVL', { label: 'Hotwell level', dp: 0 }));
  return svgRoot(1220, 780, s.join(''));
}

function side() {
  return [
    panel(
      'Vacuum',
      `<div class="kv">${kv('Condenser pressure', 'PLANT:COND_PRESS')}${kv('Saturation (CW out + TTD)', 'PLANT:CW_OUT_T')}${kv('LP hood temp', 'PLANT:LP_HOOD_TEMP')}</div>
      <p style="color:var(--muted);font-size:11px">To raise vacuum: start CW pumps, establish gland steam, then start both vacuum pumps (hogging). Air partial pressure falls over ~15-20 min. Without gland steam air in-leakage is about 25x higher.</p>
      ${indRow('Vacuum pump A', 'PLANT:VP_A_RUN')}${indRow('Vacuum pump B', 'PLANT:VP_B_RUN')}`,
    ),
    panel('Circulating water', `<div class="kv">${kv('CW flow', 'PLANT:CW_FLOW', { dp: 0 })}${kv('CW inlet', 'PLANT:CW_IN_T')}${kv('CW outlet', 'PLANT:CW_OUT_T')}</div>${indRow('CW pump A', 'PLANT:CWP_A_RUN')}${indRow('CW pump B', 'PLANT:CWP_B_RUN')}`),
  ].join('');
}

export default {
  id: 'condenser',
  title: 'Condenser & CW',
  render(root) {
    root.innerHTML = split(mimic(), side(), 300);
    return { dispose: attachControls(root) };
  },
};
