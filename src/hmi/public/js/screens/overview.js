import { svgRoot, pipe, txt, title, vbox, pump, vessel, turbine, flame, valve, loopTag, ind, stext } from '../svg.js';
import { kv, indRow, wbtn, pbtn, numSet, attachControls, panel, split } from '../ui.js';

function mimic() {
  const s = [];
  s.push(title(20, 28, 'UNIT OVERVIEW - WATER / STEAM CYCLE'));
  // Boiler
  s.push(`<rect class="furnace" x="90" y="150" width="230" height="400" rx="4"/>`);
  s.push(`<g data-showif="BMS:FUEL_IN_SERVICE"><ellipse class="fireball" cx="205" cy="420" rx="95" ry="110"/></g>`);
  s.push(txt(205, 565 + 14, 'FURNACE (gas fired)', 'lbl-s', 'middle'));
  ['D', 'C', 'B', 'A'].forEach((x, i) => {
    const y = 330 + i * 50;
    s.push(flame(105, y, `PLANT:FLAME_${x}`, 0.9), flame(305, y, `PLANT:FLAME_${x}`, 0.9), txt(78, y + 4, x, 'lbl-s', 'middle'));
  });
  s.push(vessel(110, 70, 190, 46, { lvl: 'FWC:DRUM_LVL_SEL', min: -300, max: 300, label: 'STEAM DRUM', rx: 23 }));
  s.push(pipe([[150, 116], [150, 150]], 'water thin'), pipe([[260, 116], [260, 150]], 'water thin'));
  // SH banks
  s.push(`<rect class="equip" x="180" y="165" width="120" height="40" rx="3"/>`, txt(240, 190, 'SUPERHEATER', 'lbl-s', 'middle'));
  s.push(`<rect class="equip" x="180" y="215" width="120" height="34" rx="3"/>`, txt(240, 237, 'REHEATER', 'lbl-s', 'middle'));
  s.push(`<rect class="equip" x="180" y="259" width="120" height="30" rx="3"/>`, txt(240, 279, 'ECONOMIZER', 'lbl-s', 'middle'));
  s.push(pipe([[205, 70], [205, 50], [340, 50], [340, 185], [300, 185]], 'steam thin'));
  // Main steam to HP
  s.push(pipe([[300, 175], [360, 175], [360, 110], [470, 110]], 'steam', { flow: 'PLANT:STEAM_FLOW', th: 20 }));
  s.push(valve(480, 110, { pos: 'PLANT:GV_POS', fp: 'loop:DEH:LOAD_CTRL', label: 'GV', ctrl: true }));
  s.push(pipe([[491, 110], [520, 110]], 'steam'));
  s.push(`<line x1="600" y1="125" x2="1000" y2="125" stroke="#8b949e" stroke-width="5"/>`);
  s.push(turbine(520, 80, 80, 40, 90, 'HP'));
  s.push(turbine(640, 75, 90, 50, 100, 'IP'));
  s.push(turbine(770, 65, 70, 60, 120, 'LP1'), turbine(845, 65, 70, 60, 120, 'LP2'));
  s.push(`<circle class="equip" cx="1010" cy="125" r="42"/>`, txt(1010, 130, 'GEN', 'lbl-b', 'middle'));
  s.push(pipe([[1052, 125], [1090, 125]], 'elec'));
  s.push(`<g class="dev" data-st="GEN:GCB" data-fp="dev:GEN:GCB"><rect class="body" x="1090" y="113" width="24" height="24"/><text class="tag" x="1102" y="152">52G</text></g>`);
  s.push(pipe([[1114, 125], [1150, 125], [1150, 70]], 'elec', { arrow: true }), txt(1160, 70, '400 kV GRID', 'lbl-s'));
  // Reheat loop
  s.push(pipe([[600, 150], [600, 300], [360, 300], [360, 232], [300, 232]], 'rh', { flow: 'PLANT:STEAM_FLOW', th: 20 }));
  s.push(pipe([[180, 232], [160, 232], [160, 300], [140, 300], [140, 620], [640, 620], [640, 200], [660, 175]], 'rh dim'));
  s.push(txt(370, 296, 'COLD REHEAT', 'lbl-s'), txt(470, 615, 'HOT REHEAT', 'lbl-s'));
  // Bypass
  s.push(pipe([[360, 110], [360, 50], [610, 50], [610, 150]], 'steam thin dim'));
  s.push(valve(470, 50, { pos: 'PLANT:HPB_POS', fp: 'loop:DEH:PIC_HPB', size: 9, label: 'HP BYPASS', ldx: 70, ldy: 4, posDx: 0, posDy: 24 }));
  // Condenser
  s.push(pipe([[805, 185], [805, 300]], 'steam thin'), pipe([[880, 185], [880, 300]], 'steam thin'));
  s.push(vessel(760, 300, 170, 90, { lvl: 'PLANT:HW_LVL', min: 0, max: 1500, label: '', cls: 'cond' }));
  s.push(txt(845, 335, 'CONDENSER', 'lbl-b', 'middle'));
  s.push(pipe([[940, 320], [1010, 320]], 'cw', { flow: 'PLANT:CW_FLOW', th: 1000 }), pipe([[1010, 370], [940, 370]], 'cw', { flow: 'PLANT:CW_FLOW', th: 1000 }));
  s.push(txt(1016, 324, 'CW in', 'lbl-s'), txt(1016, 374, 'CW out', 'lbl-s'));
  // Condensate & feedwater
  s.push(pipe([[845, 390], [845, 450]], 'cond'));
  s.push(pump(845, 470, { node: 'BOP', dev: 'CEP_A', label: 'CEP' }));
  s.push(pipe([[829, 470], [720, 470], [720, 430], [690, 430]], 'cond', { flow: 'PLANT:CEP_FLOW', th: 10 }));
  s.push(vessel(520, 400, 170, 54, { lvl: 'PLANT:DA_LVL', min: 0, max: 3000, label: 'DEAERATOR', rx: 27 }));
  s.push(pipe([[560, 454], [560, 500], [530, 500]], 'water'));
  s.push(pump(514, 500, { node: 'FWC', dev: 'BFP_A', label: 'BFP A' }), pump(514, 550, { node: 'FWC', dev: 'BFP_B', label: 'BFP B' }));
  s.push(pipe([[498, 500], [440, 500], [440, 274], [300, 274]], 'water', { flow: 'PLANT:FW_FLOW', th: 20 }));
  s.push(valve(440, 400, { pos: 'PLANT:FCV_FB', fp: 'loop:FWC:FIC_FW', orient: 'v', label: 'FW CV', ldx: 34, ldy: 4, posDx: -26, posDy: 4 }));
  s.push(pipe([[180, 274], [165, 274], [165, 116]], 'water thin'));

  // Values
  s.push(vbox(370, 130, 'PLANT:MS_PRESS', { label: 'MS pressure' }), vbox(370, 168, 'PLANT:MS_TEMP', { label: 'MS temp', dp: 0 }));
  s.push(vbox(1060, 180, 'PLANT:GEN_MW', { label: 'Gross MW', w: 80 }), vbox(1060, 218, 'PLANT:GEN_MVAR', { label: 'MVAr', w: 80, dp: 0 }));
  s.push(vbox(1060, 256, 'PLANT:GEN_FREQ', { label: 'Frequency', w: 80, dp: 3 }));
  s.push(vbox(680, 210, 'PLANT:HRH_TEMP', { label: 'HRH temp', dp: 0 }), vbox(680, 248, 'PLANT:SPEED_A', { label: 'Speed', dp: 0 }));
  s.push(vbox(20, 135, 'FWC:DRUM_LVL_SEL', { label: 'Drum level', dp: 0, w: 56 }));
  s.push(vbox(20, 90, 'PLANT:DRUM_PRESS', { label: 'Drum press', w: 62 }));
  s.push(vbox(780, 410, 'PLANT:COND_PRESS', { label: 'Vacuum (abs)', w: 58 }));
  s.push(vbox(600, 470, 'PLANT:DA_LVL', { label: 'DA level', dp: 0, w: 60 }));
  s.push(vbox(350, 520, 'PLANT:FW_FLOW', { label: 'FW flow', dp: 0, w: 66 }), vbox(350, 330, 'PLANT:STEAM_FLOW', { label: 'Steam flow', dp: 0, w: 66 }));
  s.push(vbox(20, 640, 'PLANT:GAS_FLOW', { label: 'Gas flow', w: 66 }), vbox(130, 640, 'PLANT:AIR_FLOW', { label: 'Air flow', w: 66, dp: 0 }));
  s.push(vbox(240, 640, 'PLANT:O2', { label: 'O2', w: 50, dp: 2 }), vbox(330, 640, 'CMB:FURN_PRESS_SEL', { label: 'Furnace', w: 56 }));
  s.push(vbox(430, 640, 'PLANT:FUEL_HEAT', { label: 'Firing rate', w: 62, dp: 0 }), vbox(540, 640, 'PLANT:BOILER_EFF', { label: 'Boiler eff.', w: 50 }));
  s.push(vbox(640, 640, 'PLANT:AUX_MW', { label: 'Aux load', w: 56 }), vbox(740, 640, 'PLANT:NET_MW', { label: 'Net MW', w: 66 }));
  // status strip
  s.push(`<rect class="zone" x="20" y="690" width="1180" height="70" rx="4"/>`);
  const st = [
    ['BMS:MFT', 'MFT', 'bad'],
    ['BMS:FUEL_IN_SERVICE', 'FIRED', ''],
    ['DEH:LATCHED', 'TURBINE LATCHED', ''],
    ['DEH:TRIPPED', 'TURBINE TRIPPED', 'bad'],
    ['PLANT:GCB_CLOSED', 'ON GRID', ''],
    ['GEN:LOCKOUT_86', '86G LOCKOUT', 'bad'],
    ['CCS:RB_ACTIVE', 'RUNBACK', 'warn'],
    ['DEH:OPC_ACTIVE', 'OPC', 'bad'],
    ['FWC:E3_ACTIVE', '3-ELEMENT', ''],
    ['PLANT:SAFETY_VLV_LIFT', 'SAFETY VALVE', 'warn'],
  ];
  st.forEach(([k, l, kind], i) => s.push(ind(40 + i * 118, 725, k, { label: l, kind })));
  s.push(loopTag(900, 640, 'CCS', 'PIC_TP', { w: 100 }), loopTag(1010, 640, 'DEH', 'LOAD_CTRL', { w: 100 }));
  s.push(txt(900, 676, 'Boiler master / Turbine load', 'lbl-s'));
  s.push(stext(1100, 40, 'CCS:MODE_ACT', { anchor: 'end' }));
  return svgRoot(1220, 780, s.join(''));
}

function side() {
  const modes = [0, 1, 2, 3].map((m) => wbtn(['BASE', 'BF', 'TF', 'CC'][m], 'CCS', 'MODE_REQ', m)).join('');
  return [
    panel(
      'Unit coordinated control',
      `<div class="row" style="margin-bottom:8px">${modes}</div>
      <div class="kv">${kv('Active mode', 'CCS:MODE_ACT')}${kv('Unit load demand', 'CCS:ULD_ACT', { dp: 1 })}${kv('Incl. freq. bias', 'CCS:ULD_FREQ', { dp: 1 })}${kv('Boiler demand', 'CCS:BLR_DMD', { dp: 1 })}${kv('Capacity', 'CCS:CAPACITY', { dp: 0 })}</div>
      <div class="row" style="margin-top:6px">${indRow('CC permissive', 'CCS:CC_PERM')}${indRow('BF permissive', 'CCS:BF_PERM')}${indRow('TF permissive', 'CCS:TF_PERM')}</div>
      <div class="row" style="margin-top:2px;font-size:11px;color:var(--muted)">CC needs:</div>
      <div class="row" style="font-size:11px;column-gap:10px">${indRow('Fuel master CAS', 'CMB:FM_AUTO')}${indRow('Air CAS', 'CMB:AIR_AUTO')}${indRow('Furnace AUTO', 'CMB:FURN_AUTO')}${indRow('Drum level AUTO', 'FWC:LVL_AUTO')}${indRow('DEH remote ready', 'DEH:REM_READY')}${indRow('GCB closed', 'PLANT:GCB_CLOSED')}</div>`,
    ),
    panel(
      'Load demand',
      `<div class="fp-line"><span>Target</span>${numSet('CCS', 'ULD_TARGET')} <span>MW</span></div>
      <div class="fp-line"><span>Rate</span>${numSet('CCS', 'ULD_RATE')} <span>MW/min</span></div>
      <div class="row" style="margin:6px 0">${pbtn('GO', 'CCS', 'GO', { cls: 'ok' })}${pbtn('HOLD', 'CCS', 'HOLD')}
        ${indRow('Ramping', 'CCS:RAMPING')}${indRow('Runback', 'CCS:RB_ACTIVE', 'warn')}</div>
      <div class="row">${indRow('Increase blocked', 'CCS:BLOCK_INC', 'warn')}${indRow('Decrease blocked', 'CCS:BLOCK_DEC', 'warn')}</div>
      <div class="row" style="margin-top:6px"><span style="color:var(--muted)">Frequency bias</span>${wbtn('OFF', 'CCS', 'FREQ_BIAS', 0)}${wbtn('ON', 'CCS', 'FREQ_BIAS', 1)}</div>`,
    ),
    panel(
      'Throttle pressure',
      `<div class="row" style="margin-bottom:6px">${wbtn('FIXED', 'CCS', 'PRESS_MODE', 0)}${wbtn('SLIDING', 'CCS', 'PRESS_MODE', 1)}</div>
      <div class="fp-line"><span>Fixed SP</span>${numSet('CCS', 'PRESS_FIXED')} <span>bar</span></div>
      <div class="fp-line"><span>Rate</span>${numSet('CCS', 'PRESS_RATE')} <span>bar/min</span></div>
      <div class="kv">${kv('Active setpoint', 'CCS:PRESS_SP')}${kv('Throttle pressure', 'PLANT:MS_PRESS')}${kv('Deviation', 'CCS:PRESS_DEV')}</div>`,
    ),
    panel(
      'Controllers',
      `<table class="tbl"><tr><th>Node</th><th>Status</th><th class="r">Scan</th></tr>
      ${['CCS', 'BMS', 'CMB', 'FWC', 'STC', 'DEH', 'GEN', 'BOP'].map((n) => `<tr><td class="mono">${n}</td><td><span class="ind" data-on="${n}:HEALTHY"></span></td><td class="r mono"><span data-v="${n}:SCAN_MS" data-dp="2">--</span> ms</td></tr>`).join('')}</table>`,
    ),
  ].join('');
}

export default {
  id: 'overview',
  title: 'Overview',
  render(root) {
    root.innerHTML = split(mimic(), side());
    const off = attachControls(root);
    return { dispose: off };
  },
};
