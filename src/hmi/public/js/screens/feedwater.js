import { svgRoot, pipe, txt, title, vbox, valve, loopTag, pump, vessel, hx, ind } from '../svg.js';
import { kv, indRow, wbtn, attachControls, panel, split } from '../ui.js';

function mimic() {
  const s = [];
  s.push(title(20, 28, 'FEEDWATER & CONDENSATE'));
  // Hotwell
  s.push(vessel(40, 110, 220, 110, { lvl: 'PLANT:HW_LVL', min: 0, max: 1500, label: 'CONDENSER HOTWELL', cls: 'cond' }));
  s.push(vbox(70, 180, 'PLANT:HW_LVL', { w: 60, dp: 0 }), loopTag(150, 182, 'BOP', 'LIC_HW', { w: 90 }));
  s.push(pipe([[20, 70], [150, 70], [150, 110]], 'cond thin', { flow: 'PLANT:MAKEUP_FB', th: 1 }), txt(20, 62, 'MAKE-UP (DM water)', 'lbl-s'));
  s.push(valve(90, 70, { pos: 'PLANT:MAKEUP_FB', fp: 'loop:BOP:LIC_HW', size: 9, posDy: 24 }));
  s.push(pipe([[260, 200], [300, 200], [300, 250]], 'cond thin dim'), valve(300, 235, { node: 'BOP', dev: 'HW_DUMP', orient: 'v', size: 8, label: 'DUMP', ldx: 28, ldy: 4 }));
  // CEPs
  s.push(pipe([[110, 220], [110, 300], [90, 300]], 'cond'), pipe([[110, 300], [110, 380], [90, 380]], 'cond'));
  s.push(pump(74, 300, { node: 'BOP', dev: 'CEP_A', label: 'CEP A' }), pump(74, 380, { node: 'BOP', dev: 'CEP_B', label: 'CEP B' }));
  s.push(pipe([[58, 300], [30, 300], [30, 460], [330, 460]], 'cond', { flow: 'PLANT:CEP_FLOW', th: 5 }), pipe([[58, 380], [30, 380]], 'cond'));
  s.push(vbox(150, 470, 'PLANT:CEP_FLOW', { label: 'Condensate flow', dp: 0 }), vbox(150, 420, 'PLANT:CEP_PRESS', { label: 'CEP discharge' }));
  s.push(hx(330, 440, 120, 40, 'LP HEATERS 1-4'));
  s.push(pipe([[450, 460], [520, 460]], 'cond'));
  s.push(valve(530, 460, { pos: 'PLANT:DA_CV_FB', fp: 'loop:FWC:LIC_DA', label: 'DA LEVEL CV', ldy: -26, posDy: 28 }));
  s.push(pipe([[541, 460], [600, 460], [600, 190]], 'cond', { flow: 'PLANT:CEP_FLOW', th: 5 }));
  // Deaerator
  s.push(vessel(560, 110, 320, 80, { lvl: 'PLANT:DA_LVL', min: 0, max: 3000, label: 'DEAERATOR & STORAGE TANK', rx: 38 }));
  s.push(vbox(640, 140, 'PLANT:DA_LVL', { label: '', w: 56, dp: 0 }), vbox(720, 140, 'PLANT:DA_PRESS', { w: 56, dp: 3 }), vbox(800, 140, 'PLANT:DA_TEMP', { w: 44, dp: 0 }));
  s.push(loopTag(640, 200, 'FWC', 'LIC_DA', { w: 86 }), loopTag(740, 200, 'FWC', 'PIC_DA', { w: 86 }));
  s.push(pipe([[960, 60], [760, 60], [760, 110]], 'steam thin', { flow: 'PLANT:PEG_FB', th: 1 }), txt(960, 52, 'AUX STEAM (pegging)', 'lbl-s', 'end'));
  s.push(valve(860, 60, { pos: 'PLANT:PEG_FB', fp: 'loop:FWC:PIC_DA', size: 9, posDy: 24 }));
  // BFPs
  s.push(pipe([[700, 190], [700, 560]], 'water'));
  [['A', 290], ['B', 400], ['C', 510]].forEach(([p, y]) => {
    s.push(pipe([[700, y], [745, y]], 'water'));
    s.push(pump(762, y, { node: 'FWC', dev: `BFP_${p}`, label: `BFP ${p}`, r: 18 }));
    s.push(pipe([[780, y], [880, y]], 'water', { flow: `PLANT:BFP_${p}_FLOW`, th: 20 }));
    s.push(vbox(800, y - 46, `PLANT:BFP_${p}_SPEED`, { w: 50, dp: 0, u: 'rpm' }), vbox(800, y + 10, `PLANT:BFP_${p}_FLOW`, { w: 50, dp: 0 }));
    s.push(vbox(620, y + 10, `PLANT:BFP_${p}_AMPS`, { w: 44, dp: 0 }));
    s.push(loopTag(612, y - 40, 'FWC', `SC_BFP${p}`, { w: 80, kind: 'station' }));
  });
  s.push(pipe([[880, 290], [880, 510]], 'water'));
  s.push(vbox(900, 230, 'PLANT:FW_HDR_PRESS', { label: 'BFP discharge', dp: 2 }), vbox(900, 268, 'FWC:FW_DP', { label: 'FW valve dP', dp: 2 }));
  s.push(loopTag(990, 268, 'FWC', 'PIC_FWDP', { w: 96 }));
  // HP heaters & FCV
  s.push(pipe([[880, 400], [930, 400]], 'water', { flow: 'PLANT:FW_FLOW', th: 10 }));
  s.push(hx(930, 380, 120, 40, 'HP HEATERS 6-7'));
  s.push(valve(990, 470, { node: 'FWC', dev: 'HPH', size: 9, label: 'HPH IN SERVICE', ldy: 26 }));
  s.push(pipe([[910, 400], [910, 470], [1070, 470], [1070, 400]], 'water thin dim'));
  s.push(pipe([[1050, 400], [1110, 400]], 'water'));
  s.push(valve(1120, 400, { pos: 'PLANT:FCV_FB', fp: 'loop:FWC:FIC_FW', label: 'FW CV', ldy: -26, posDy: 28 }));
  s.push(pipe([[1131, 400], [1210, 400]], 'water', { flow: 'PLANT:FW_FLOW', th: 10, arrow: true }), txt(1210, 390, 'TO ECONOMIZER', 'lbl-s', 'end'));
  s.push(vbox(1110, 440, 'PLANT:FW_FLOW', { label: 'FW flow', dp: 0 }), vbox(1110, 490, 'PLANT:FW_TEMP', { label: 'FW temp', dp: 0 }));
  s.push(loopTag(1110, 530, 'FWC', 'FIC_FW'), loopTag(1110, 556, 'FWC', 'LIC_DRUM'));
  s.push(pipe([[880, 510], [880, 600], [1210, 600]], 'water thin', { flow: 'PLANT:SH_SPRAY_FLOW', th: 1, arrow: true }), txt(1210, 592, 'SH / RH SPRAY', 'lbl-s', 'end'));
  // status
  s.push(`<rect class="zone" x="20" y="640" width="1190" height="120" rx="4"/>`, txt(30, 660, 'FEEDWATER SYSTEM STATUS', 'lbl'));
  s.push(vbox(40, 680, 'FWC:DRUM_LVL_SEL', { label: 'Drum level', w: 56, dp: 0 }), vbox(160, 680, 'FWC:STEAM_FLOW_PCT', { label: 'Steam flow %', w: 56 }));
  s.push(vbox(280, 680, 'FWC:BFP_MASTER', { label: 'BFP master', w: 56 }), vbox(400, 680, 'FWC:BFP_RUNNING', { label: 'BFPs running', w: 40 }));
  s.push(ind(520, 690, 'FWC:E3_ACTIVE', { label: '3-element control' }), ind(520, 712, 'FWC:RB_BFP', { label: 'BFP runback', kind: 'bad' }));
  s.push(ind(700, 690, 'PLANT:HPH_IN_SERVICE', { label: 'HP heaters in service' }), ind(700, 712, 'FWC:LT_DEVIATION', { label: 'Level transmitter deviation', kind: 'warn' }));
  s.push(ind(920, 690, 'FWC:LVL_AUTO', { label: 'Drum level in auto' }), ind(920, 712, 'PLANT:EBD_OPEN', { label: 'Emergency blowdown open', kind: 'warn' }));
  return svgRoot(1220, 780, s.join(''));
}

function side() {
  return [
    panel(
      'BFP speed / FW valve dP',
      `<div class="row" style="margin-bottom:6px"><span style="color:var(--muted)">dP setpoint</span>${wbtn('OPERATOR', 'FWC', 'DP_SP_MODE', 0)}${wbtn('PROGRAM', 'FWC', 'DP_SP_MODE', 1)}</div>
      <div class="kv">${kv('dP setpoint', 'FWC:PIC_FWDP.SP')}${kv('dP actual', 'FWC:FW_DP')}${kv('BFP master', 'FWC:BFP_MASTER')}</div>
      <p style="color:var(--muted);font-size:11px">Pump speed holds the differential pressure across the feedwater control valve; the valve controls drum level (1-element below 25 % steam flow, 3-element above). Put each running BFP station in AUTO to follow the master. Standby pumps in AUTO start automatically if a running pump trips.</p>`,
    ),
    panel(
      'Pumps',
      `<table class="tbl"><tr><th>Pump</th><th>Station</th><th class="r">Scoop</th><th class="r">Speed</th></tr>
      ${['A', 'B', 'C']
        .map(
          (p) =>
            `<tr class="click" data-fp="station:FWC:SC_BFP${p}"><td>BFP ${p} <span class="ind" data-on="PLANT:BFP_${p}_RUN"></span></td><td><span class="mode-pill" data-mode="FWC:SC_BFP${p}">MAN</span></td><td class="r mono" data-v="FWC:SC_BFP${p}.OUT">--</td><td class="r mono" data-v="PLANT:BFP_${p}_SPEED" data-dp="0">--</td></tr>`,
        )
        .join('')}</table>
      ${indRow('CEP A running', 'PLANT:CEP_A_RUN')}${indRow('CEP B running', 'PLANT:CEP_B_RUN')}`,
    ),
  ].join('');
}

export default {
  id: 'feedwater',
  title: 'Feedwater',
  render(root) {
    root.innerHTML = split(mimic(), side(), 320);
    return { dispose: attachControls(root) };
  },
};
