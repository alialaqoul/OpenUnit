import { svgRoot, pipe, txt, title, vbox, turbine, hx, pump, panelBox } from '../svg.js';
import { kv, attachControls, panel, split } from '../ui.js';

/**
 * Heat cycle and performance screen: the regenerative feedwater train with the
 * extraction conditions, and the performance calculation results (evaluated on the plant
 * measurements).
 */
const LP = [
  ['LPH4', 700],
  ['LPH3', 790],
  ['LPH2', 880],
  ['LPH1', 970],
];
const HP = [
  ['HPH7', 150],
  ['HPH6', 260],
];

function heater(name, x, srcX, srcY) {
  const s = [];
  s.push(pipe([[srcX, srcY], [srcX, 250], [x, 250], [x, 400]], 'steam thin', { flow: `PLANT:${name}_EXT_FLOW`, th: 3 }));
  s.push(hx(x - 34, 400, 68, 36, ''), txt(x + 5, 395, name, 'lbl-b'));
  s.push(vbox(x - 30, 280, `PLANT:${name}_EXT_P`, { w: 52, dp: 3, label: 'P ext', u: '' }));
  s.push(vbox(x - 30, 320, `PLANT:${name}_EXT_FLOW`, { w: 52, dp: 0, label: 't/h', u: '' }));
  s.push(vbox(x - 30, 460, `PLANT:${name}_FW_OUT_T`, { w: 52, dp: 1, label: 'FW out', u: '' }));
  s.push(vbox(x - 30, 500, `PLANT:PERF_${name}_TTD`, { w: 52, dp: 1, label: 'TTD K', u: '' }));
  s.push(vbox(x - 30, 540, `PLANT:PERF_${name}_DCA`, { w: 52, dp: 1, label: 'DCA K', u: '' }));
  return s.join('');
}

function mimic() {
  const s = [];
  s.push(title(20, 28, 'HEAT CYCLE & PERFORMANCE'));
  // turbines and steam path
  s.push(pipe([[20, 110], [120, 110]], 'steam', { flow: 'PLANT:STEAM_FLOW', th: 5 }), txt(20, 100, 'MAIN STEAM', 'lbl-s'));
  s.push(turbine(120, 70, 120, 40, 100, 'HP'));
  s.push(pipe([[240, 150], [300, 150], [300, 190], [20, 190]], 'rh', { flow: 'PLANT:CRH_PRESS', th: 3, arrow: true }), txt(20, 182, 'COLD REHEAT', 'lbl-s'));
  s.push(pipe([[20, 222], [360, 222], [360, 110], [400, 110]], 'rh', { flow: 'PLANT:HRH_PRESS', th: 3 }), txt(20, 214, 'HOT REHEAT', 'lbl-s'));
  s.push(turbine(400, 70, 130, 50, 110, 'IP'));
  s.push(pipe([[530, 90], [600, 60], [640, 60], [640, 75]], 'steam'), txt(560, 52, 'CROSSOVER', 'lbl-s'));
  s.push(turbine(640, 70, 380, 60, 150, 'LP (double flow x2)'));
  s.push(pipe([[1020, 145], [1100, 145], [1100, 380]], 'steam', { flow: 'PLANT:STEAM_FLOW', th: 5 }));
  s.push(`<rect class="vessel" x="1060" y="380" width="120" height="70" rx="4"/>`, txt(1120, 410, 'CONDENSER', 'lbl-b', 'middle'));
  s.push(vbox(1080, 420, 'PLANT:COND_PRESS', { w: 56, dp: 0 }));
  s.push(vbox(1040, 96, 'PLANT:GEN_MW', { label: 'Gross', w: 60 }), vbox(1140, 96, 'PLANT:NET_MW', { label: 'Net', w: 56 }));
  s.push(vbox(250, 76, 'PLANT:PERF_HP_EFF', { w: 50, dp: 1, label: 'HP eff', u: '%' }), vbox(470, 192, 'PLANT:PERF_IP_EFF', { w: 50, dp: 1, label: 'IP eff', u: '%' }));
  s.push(vbox(560, 26, 'PLANT:CROSS_TEMP', { w: 46, dp: 0, label: '', u: 'degC' }));

  // extractions and heaters
  s.push(heater('HPH7', HP[0][1], 190, 140));
  s.push(heater('HPH6', HP[1][1], 290, 190));
  LP.forEach(([n, x], i) => s.push(heater(n, x, 700 + i * 90, 160)));
  // deaerator
  s.push(pipe([[560, 70], [560, 330]], 'steam thin', { flow: 'PLANT:DA_EXT_FLOW', th: 3 }));
  s.push(`<rect class="vessel" x="490" y="330" width="140" height="50" rx="22"/>`, txt(560, 360, 'DEAERATOR', 'lbl-b', 'middle'));
  s.push(vbox(500, 290, 'PLANT:DA_EXT_FLOW', { w: 52, dp: 0, label: 'ext t/h', u: '' }));
  s.push(vbox(500, 460, 'PLANT:DA_TEMP', { w: 52, dp: 1, label: 'DA temp', u: '' }), vbox(500, 500, 'PLANT:DA_PRESS', { w: 52, dp: 2, label: 'DA bar(g)', u: '' }));

  // feedwater train (right to left)
  s.push(pipe([[1080, 450], [1080, 418], [1004, 418]], 'cond', { flow: 'PLANT:CEP_FLOW', th: 5 }));
  s.push(pipe([[936, 418], [914, 418]], 'cond'), pipe([[846, 418], [824, 418]], 'cond'), pipe([[756, 418], [734, 418]], 'cond'));
  s.push(pipe([[666, 418], [600, 418], [600, 380]], 'cond', { flow: 'PLANT:CEP_FLOW', th: 5 }));
  s.push(pipe([[520, 380], [520, 418], [420, 418]], 'water'), pump(400, 418, { run: 'PLANT:BFP_A_RUN', label: 'BFP' }));
  s.push(pipe([[384, 418], [294, 418]], 'water', { flow: 'PLANT:FW_FLOW', th: 20 }), pipe([[226, 418], [184, 418]], 'water', { flow: 'PLANT:FW_FLOW', th: 20 }));
  s.push(pipe([[116, 418], [20, 418]], 'water', { flow: 'PLANT:FW_FLOW', th: 20, arrow: true }), txt(20, 410, 'TO ECONOMIZER', 'lbl-s'));
  s.push(vbox(30, 440, 'PLANT:FW_TEMP', { w: 52, dp: 1, label: 'Final FW', u: 'degC' }));
  s.push(vbox(376, 490, 'PLANT:BFP_DISCH_T', { w: 52, dp: 1, label: 'BFP out', u: '' }));
  s.push(vbox(1080, 470, 'PLANT:HW_TEMP', { w: 56, dp: 1, label: 'Hotwell', u: 'degC' }));
  s.push(txt(150, 590, 'Extraction pressures bar(a) at the flange, temperatures degC; TTD from the flange saturation.', 'lbl-s'));

  // performance summary boxes
  s.push(panelBox(20, 610, 380, 160, 'BOILER (loss method, HHV)'));
  s.push(vbox(40, 650, 'PLANT:PERF_BLR_EFF', { label: 'Efficiency', w: 60, dp: 2 }), vbox(160, 650, 'PLANT:PERF_EXCESS_AIR', { label: 'Excess air', w: 60, dp: 1 }), vbox(280, 650, 'PLANT:PERF_AFT', { label: 'Flame temp', w: 60, dp: 0 }));
  s.push(vbox(40, 700, 'PLANT:PERF_L_DRYGAS', { label: 'Dry gas loss', w: 60, dp: 2 }), vbox(160, 700, 'PLANT:PERF_L_H2', { label: 'H2 loss', w: 60, dp: 2 }), vbox(280, 700, 'PLANT:PERF_L_RAD', { label: 'Radiation', w: 60, dp: 3 }));
  s.push(vbox(40, 745, 'PLANT:PERF_BLR_ABS', { label: 'Absorbed', w: 60, dp: 0 }), vbox(160, 745, 'PLANT:PERF_FUEL_HHV', { label: 'Fuel (HHV)', w: 60, dp: 0 }));
  s.push(panelBox(420, 610, 380, 160, 'CONDENSER (HEI) & AIR HEATER'));
  s.push(vbox(440, 650, 'PLANT:PERF_COND_CF', { label: 'Cleanliness', w: 60, dp: 1 }), vbox(560, 650, 'PLANT:PERF_COND_EXP', { label: 'Expected', w: 60, dp: 1 }), vbox(680, 650, 'PLANT:PERF_COND_DEV', { label: 'Deviation', w: 60, dp: 1 }));
  s.push(vbox(440, 700, 'PLANT:PERF_AH_GAS_EFF', { label: 'AH gas eff', w: 60, dp: 1 }), vbox(560, 700, 'PLANT:PERF_AH_X', { label: 'X-ratio', w: 60, dp: 3 }), vbox(680, 700, 'PLANT:PERF_AH_LEAK', { label: 'Leakage', w: 60, dp: 1 }));
  s.push(vbox(440, 745, 'PLANT:PERF_AH_TGONL', { label: 'Gas out (no leak)', w: 60, dp: 0 }), vbox(560, 745, 'PLANT:PERF_AH_TGONL_EXP', { label: 'Expected', w: 60, dp: 0 }), vbox(680, 745, 'PLANT:PERF_COND_DUTY', { label: 'Cond. duty', w: 60, dp: 0 }));
  s.push(panelBox(820, 610, 380, 160, 'TURBINE CYCLE'));
  s.push(vbox(840, 650, 'PLANT:PERF_HP_EFF_EXP', { label: 'HP expected', w: 60, dp: 1 }), vbox(960, 650, 'PLANT:PERF_IP_EFF_EXP', { label: 'IP expected', w: 60, dp: 1 }), vbox(1080, 650, 'PLANT:PERF_GEN_EFF', { label: 'Generator', w: 60, dp: 2 }));
  s.push(vbox(840, 700, 'PLANT:PERF_THR_FLOW', { label: 'Throttle flow', w: 60, dp: 1 }), vbox(960, 700, 'PLANT:PERF_THR_T_DEV', { label: 'MS temp dev', w: 60, dp: 1 }), vbox(1080, 700, 'PLANT:PERF_RH_T_DEV', { label: 'RH temp dev', w: 60, dp: 1 }));
  s.push(vbox(840, 745, 'PLANT:PERF_TCHR', { label: 'Cycle heat rate', w: 60, dp: 0 }), vbox(960, 745, 'PLANT:PERF_THR_P_DEV', { label: 'Throttle P dev', w: 60, dp: 1 }));
  return svgRoot(1220, 780, s.join(''));
}

function side() {
  return [
    panel(
      'Unit heat rate',
      `<div class="kv">${kv('Net unit heat rate (5010)', 'PLANT:PERF_NUHR', { dp: 0 })}${kv('Target (5030)', 'PLANT:PERF_NUHR_TGT', { dp: 0 })}${kv('Gross unit heat rate', 'PLANT:PERF_GUHR', { dp: 0 })}${kv('Turbine cycle heat rate (2100)', 'PLANT:PERF_TCHR', { dp: 0 })}${kv('Carnot limit (5200)', 'PLANT:PERF_CARNOT_HR', { dp: 0 })}${kv('Auxiliary load', 'PLANT:AUX_MW')}</div>`,
    ),
    panel(
      'Controllable losses',
      `<div class="kv">${kv('Excess O2 (5100)', 'PLANT:PERF_HRC_O2', { dp: 2 })}${kv('AH exit gas temp (5110)', 'PLANT:PERF_HRC_EGT', { dp: 2 })}${kv('Final FW temp (2800)', 'PLANT:PERF_HRC_FWT', { dp: 2 })}${kv('Condenser pressure', 'PLANT:PERF_HRC_COND', { dp: 2 })}${kv('Total deviation', 'PLANT:PERF_HRC_TOTAL', { dp: 2 })}</div>
      <p style="color:var(--muted);font-size:11px">Heat rate penalty of each controllable parameter against its design / target value. Positive values cost fuel.</p>`,
    ),
    panel(
      'Boiler losses (% HHV)',
      `<div class="kv">${kv('Dry gas (3040)', 'PLANT:PERF_L_DRYGAS', { dp: 2 })}${kv('Hydrogen in fuel (3050)', 'PLANT:PERF_L_H2', { dp: 2 })}${kv('Moisture in air (3060)', 'PLANT:PERF_L_AIRMOIST', { dp: 3 })}${kv('CO (3090)', 'PLANT:PERF_L_CO', { dp: 3 })}${kv('Radiation (3120)', 'PLANT:PERF_L_RAD', { dp: 3 })}${kv('Unaccounted', 'PLANT:PERF_L_UNACC', { dp: 2 })}${kv('Boiler efficiency (3130)', 'PLANT:PERF_BLR_EFF', { dp: 2 })}</div>`,
    ),
    panel(
      'About',
      `<p style="color:var(--muted);font-size:11px">The process model is built on thermal performance calculations (combustion, furnace, convective pass, air heater, turbine stage flow factors and efficiencies, feedwater heaters, condenser). This screen runs the same calculations as a performance monitor on the measurements, every 2 s.</p>`,
    ),
  ].join('');
}

export default {
  id: 'performance',
  title: 'Performance',
  render(root) {
    root.innerHTML = split(mimic(), side(), 330);
    return { dispose: attachControls(root) };
  },
};
