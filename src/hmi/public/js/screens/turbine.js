import { svgRoot, pipe, txt, title, vbox, valve, loopTag, turbine, bar, pump, motorBox, ind, stext } from '../svg.js';
import { kv, indRow, wbtn, pbtn, numSet, attachControls, panel, split } from '../ui.js';

function mimic() {
  const s = [];
  s.push(title(20, 28, 'STEAM TURBINE & DEH'));
  // Main steam
  s.push(pipe([[20, 120], [170, 120]], 'steam', { flow: 'PLANT:STEAM_FLOW', th: 5 }), txt(20, 110, 'MAIN STEAM', 'lbl-s'));
  s.push(valve(110, 120, { open: 'PLANT:MSV_OPEN', label: 'MSV' }));
  s.push(valve(180, 120, { pos: 'PLANT:GV_POS', fp: 'loop:DEH:LOAD_CTRL', label: 'GOV. VALVES', ldy: -26, posDy: 28 }));
  s.push(pipe([[191, 120], [230, 120]], 'steam'));
  s.push(`<line x1="230" y1="140" x2="1120" y2="140" stroke="#8b949e" stroke-width="6"/>`);
  s.push(turbine(230, 80, 110, 50, 120, 'HP'));
  s.push(pipe([[340, 180], [370, 180], [370, 300], [20, 300]], 'rh', { flow: 'PLANT:CRH_PRESS', th: 3, arrow: true }), txt(20, 292, 'COLD REHEAT', 'lbl-s'));
  s.push(pipe([[20, 360], [400, 360], [400, 120], [470, 120]], 'rh', { flow: 'PLANT:HRH_PRESS', th: 3 }), txt(20, 352, 'HOT REHEAT', 'lbl-s'));
  s.push(valve(430, 120, { open: 'PLANT:RSV_OPEN', label: 'RSV' }), valve(480, 120, { pos: 'PLANT:ICV_POS', fp: 'loop:DEH:SPD_CTRL', label: 'ICV', ldy: -26, posDy: 28 }));
  s.push(pipe([[491, 120], [520, 120]], 'rh'));
  s.push(turbine(520, 75, 120, 60, 130, 'IP'));
  s.push(pipe([[640, 90], [700, 60], [1000, 60], [1000, 75]], 'steam thin'), pipe([[800, 60], [800, 75]], 'steam thin'), txt(740, 52, 'CROSSOVER', 'lbl-s'));
  s.push(turbine(700, 70, 100, 70, 150, 'LP1'), turbine(880, 70, 100, 70, 150, 'LP2'));
  s.push(pipe([[750, 220], [750, 250]], 'steam thin'), pipe([[930, 220], [930, 250]], 'steam thin'));
  s.push(`<rect class="vessel" x="700" y="250" width="300" height="40" rx="4"/>`, txt(850, 275, 'CONDENSER', 'lbl-b', 'middle'));
  // Generator
  s.push(`<circle class="equip" cx="1130" cy="140" r="50"/>`, txt(1130, 145, 'GEN', 'lbl-b', 'middle'));
  // Bearings
  const brg = [215, 355, 505, 660, 1065, 1195];
  brg.forEach((x, i) => {
    const b = i + 1;
    s.push(`<rect x="${x - 8}" y="132" width="16" height="16" fill="#4a5563" stroke="#9aa4b1"/>`, txt(x, 166, `B${b}`, 'lbl-s', 'middle'));
  });
  // Vibration / bearing temperature bars
  s.push(txt(20, 410, 'SHAFT VIBRATION (um p-p)', 'lbl'), txt(560, 410, 'BEARING METAL TEMPERATURE (degC)', 'lbl'));
  [1, 2, 3, 4, 5, 6].forEach((b, i) => {
    const x = 30 + i * 80;
    s.push(bar(x, 420, 26, 130, `PLANT:VIB_${b}`, { min: 0, max: 260, label: `B${b}` }));
    s.push(`<line x1="${x - 4}" y1="${420 + 130 * (1 - 125 / 260)}" x2="${x + 30}" y2="${420 + 130 * (1 - 125 / 260)}" stroke="#f0a020" stroke-dasharray="3 2"/>`);
    s.push(`<line x1="${x - 4}" y1="${420 + 130 * (1 - 250 / 260)}" x2="${x + 30}" y2="${420 + 130 * (1 - 250 / 260)}" stroke="#e5484d" stroke-dasharray="3 2"/>`);
    s.push(vbox(x - 10, 568, `PLANT:VIB_${b}`, { w: 46, dp: 0, u: '' }));
    const x2 = 560 + i * 72;
    s.push(bar(x2, 420, 26, 130, `PLANT:BRG_T_${b}`, { min: 0, max: 130, cls: 'warm', label: `B${b}` }));
    s.push(vbox(x2 - 10, 568, `PLANT:BRG_T_${b}`, { w: 46, dp: 0, u: '' }));
  });
  s.push(txt(30, 606, 'alarm 125 / trip 250 um', 'lbl-s'));
  // Values
  s.push(vbox(240, 210, 'PLANT:FIRST_STAGE_PRESS', { label: 'HP 1st stage' }), vbox(240, 250, 'PLANT:HP_EXH_TEMP', { label: 'HP exhaust', dp: 0 }));
  s.push(vbox(530, 220, 'PLANT:CROSS_PRESS', { label: 'Crossover' }), vbox(1040, 250, 'PLANT:LP_HOOD_TEMP', { label: 'LP hood', dp: 0 }));
  s.push(vbox(1040, 290, 'PLANT:COND_PRESS', { label: 'Condenser' }));
  s.push(vbox(1060, 200, 'PLANT:GEN_MW', { label: 'Gross', w: 70 }));
  s.push(`<rect class="zone" x="20" y="190" width="200" height="90" rx="4"/>`, txt(30, 210, 'TURBINE SPEED', 'lbl'));
  s.push(`<text x="200" y="255" text-anchor="end" style="font-family:var(--mono);font-size:38px;font-weight:700" data-v="DEH:SPEED" data-dp="0">--</text>`, txt(205, 255, 'rpm', 'lbl-s'));
  s.push(txt(30, 272, 'ref', 'lbl-s'), stext(60, 272, 'DEH:SPEED_REF', { cls: 'lbl-s' }));
  // Metal temps & stress
  s.push(`<rect class="zone" x="1010" y="400" width="200" height="190" rx="4"/>`, txt(1020, 420, 'TURBINE STRESS (TSE)', 'lbl'));
  s.push(bar(1025, 430, 24, 120, 'DEH:STRESS_HP', { min: 0, max: 120, cls: 'warm', label: 'HP %' }), bar(1070, 430, 24, 120, 'DEH:STRESS_IP', { min: 0, max: 120, cls: 'warm', label: 'IP %' }));
  s.push(vbox(1110, 440, 'PLANT:HP_METAL_TEMP', { label: 'HP metal', w: 52, dp: 0 }), vbox(1110, 490, 'PLANT:IP_METAL_TEMP', { label: 'IP metal', w: 52, dp: 0 }));
  s.push(txt(1110, 535, 'Start class', 'lbl-s'), stext(1110, 552, 'DEH:START_CLASS', { cls: 'lbl-b' }));
  // Rotor & lube oil
  s.push(`<rect class="zone" x="20" y="630" width="1190" height="140" rx="4"/>`, txt(30, 650, 'LUBE OIL, JACKING OIL & TURNING GEAR', 'lbl'));
  s.push(pump(80, 700, { node: 'BOP', dev: 'AOP', label: 'AC OIL PUMP' }), pump(200, 700, { node: 'BOP', dev: 'EOP', label: 'DC EMERG. PUMP' }), pump(320, 700, { node: 'BOP', dev: 'JOP', label: 'JACKING OIL' }));
  s.push(motorBox(440, 700, { node: 'BOP', dev: 'TG', text: 'TG', label: 'TURNING GEAR' }));
  s.push(vbox(520, 670, 'PLANT:LO_PRESS', { label: 'LO pressure' }), vbox(520, 715, 'PLANT:LO_TEMP', { label: 'LO temp', dp: 0 }));
  s.push(vbox(660, 670, 'PLANT:ECCENTRICITY', { label: 'Eccentricity', dp: 0 }), vbox(660, 715, 'PLANT:AXIAL_DISP', { label: 'Axial disp.', dp: 2 }));
  s.push(ind(800, 680, 'PLANT:TG_ENGAGED', { label: 'Turning gear engaged' }), ind(800, 702, 'DEH:CRIT_ZONE', { label: 'In critical speed band', kind: 'warn' }));
  s.push(ind(800, 724, 'DEH:OPC_ACTIVE', { label: 'OPC active', kind: 'bad' }), ind(800, 746, 'PLANT:MECH_OVERSPEED', { label: 'Mech. overspeed', kind: 'bad' }));
  s.push(ind(980, 680, 'DEH:AT_SPEED', { label: 'At sync speed' }), ind(980, 702, 'DEH:TPL_ACTIVE', { label: 'Pressure limiter', kind: 'warn' }));
  s.push(ind(980, 724, 'DEH:TRIPPED', { label: 'TURBINE TRIPPED', kind: 'bad' }), ind(980, 746, 'DEH:LATCHED', { label: 'Latched' }));
  s.push(loopTag(1100, 676, 'DEH', 'SPD_CTRL', { w: 96 }), loopTag(1100, 700, 'DEH', 'LOAD_CTRL', { w: 96 }), loopTag(1100, 724, 'DEH', 'PIC_TPT', { w: 96 }));
  return svgRoot(1220, 780, s.join(''));
}

function side() {
  return [
    panel(
      'DEH - turbine control',
      `<div class="kv">${kv('Mode', 'DEH:MODE')}${kv('Trip first-out', 'DEH:TRIP_CAUSE')}${kv('GV demand', 'DEH:GV_DEMAND', { dp: 1 })}</div>
      <div class="row" style="margin:8px 0">${pbtn('RESET / LATCH', 'DEH', 'RESET', { cls: 'ok' })}${pbtn('TRIP', 'DEH', 'TRIP_PB', { cls: 'danger', confirm: true })}</div>
      ${indRow('Latch permissive', 'DEH:LATCH_PERM')}`,
    ),
    panel(
      'Speed control (off line)',
      `<div class="fp-line"><span>Target</span>${numSet('DEH', 'SPD_TARGET')} <span>rpm</span></div>
      <div class="fp-line"><span>Rate</span>${numSet('DEH', 'SPD_RATE')} <span>rpm/min</span></div>
      <div class="row" style="margin:6px 0">${wbtn('600', 'DEH', 'SPD_TARGET', 600, { sel: false })}${wbtn('2400', 'DEH', 'SPD_TARGET', 2400, { sel: false })}${wbtn('3600', 'DEH', 'SPD_TARGET', 3600, { sel: false })}${pbtn('GO', 'DEH', 'GO', { cls: 'ok' })}${pbtn('HOLD', 'DEH', 'HOLD')}</div>
      <div class="kv">${kv('Speed reference', 'DEH:SPEED_REF', { dp: 0 })}${kv('Speed', 'DEH:SPEED', { dp: 0 })}</div>
      ${indRow('Ramp in progress', 'DEH:RAMP_ACTIVE')}${indRow('Critical speed band', 'DEH:CRIT_ZONE', 'warn')}`,
    ),
    panel(
      'Load control (on line)',
      `<div class="row" style="margin-bottom:6px"><span style="color:var(--muted)">Control</span>${wbtn('LOCAL', 'DEH', 'MODE_SEL', 0)}${wbtn('REMOTE (CCS)', 'DEH', 'MODE_SEL', 1)}</div>
      <div class="fp-line"><span>Target</span>${numSet('DEH', 'LOAD_TARGET')} <span>MW</span></div>
      <div class="fp-line"><span>Rate</span>${numSet('DEH', 'LOAD_RATE')} <span>MW/min</span></div>
      <div class="row" style="margin:6px 0">${pbtn('GO', 'DEH', 'GO', { cls: 'ok' })}${pbtn('HOLD', 'DEH', 'HOLD')}</div>
      <div class="kv">${kv('Load reference', 'DEH:LOAD_REF', { dp: 1 })}${kv('Frequency correction', 'DEH:FREQ_CORR', { dp: 1 })}</div>
      <div class="fp-line"><span>VPL</span>${numSet('DEH', 'VPL')} <span>%</span></div>
      <div class="fp-line"><span>TPL</span>${numSet('DEH', 'TPL_SP')} <span>bar</span></div>
      <div class="fp-line"><span>Droop</span>${numSet('DEH', 'DROOP')} <span>%</span></div>
      <div class="row"><span style="color:var(--muted)">Primary freq. response</span>${wbtn('OFF', 'DEH', 'FREQ_ON', 0)}${wbtn('ON', 'DEH', 'FREQ_ON', 1)}</div>
      ${indRow('Ready for CCS', 'DEH:REM_READY')}`,
    ),
  ].join('');
}

export default {
  id: 'turbine',
  title: 'Turbine',
  render(root) {
    root.innerHTML = split(mimic(), side(), 330);
    return { dispose: attachControls(root) };
  },
};
