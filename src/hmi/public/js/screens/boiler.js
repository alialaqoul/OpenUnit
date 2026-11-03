import { svgRoot, pipe, txt, title, vbox, vessel, valve, loopTag, flame, hx, ind } from '../svg.js';
import { kv, indRow, wbtn, numSet, attachControls, panel, split } from '../ui.js';

function mimic() {
  const s = [];
  s.push(title(20, 28, 'BOILER - WATER / STEAM'));
  // Furnace & drum
  s.push(`<rect class="furnace" x="70" y="210" width="230" height="330" rx="4"/>`);
  s.push(`<g data-showif="BMS:FUEL_IN_SERVICE"><ellipse class="fireball" cx="185" cy="400" rx="90" ry="105"/></g>`);
  ['D', 'C', 'B', 'A'].forEach((x, i) => s.push(flame(86, 320 + i * 50, `PLANT:FLAME_${x}`, 0.8), flame(284, 320 + i * 50, `PLANT:FLAME_${x}`, 0.8)));
  s.push(txt(185, 556, 'FURNACE WATERWALLS', 'lbl-s', 'middle'));
  s.push(vessel(70, 90, 230, 60, { lvl: 'FWC:DRUM_LVL_SEL', min: -400, max: 400, label: 'STEAM DRUM', rx: 30 }));
  s.push(`<line x1="78" y1="120" x2="292" y2="120" stroke="#cfd6de" stroke-dasharray="4 4" stroke-width="1"/>`, txt(82, 116, 'NWL', 'lbl-s'));
  s.push(pipe([[95, 150], [95, 210]], 'water'), pipe([[275, 150], [275, 210]], 'water'), pipe([[185, 150], [185, 210]], 'water thin'));
  // Drum level transmitters
  s.push(vbox(10, 46, 'PLANT:DRUM_LVL_A', { label: 'LT-A', w: 46, dp: 0, u: '' }), vbox(62, 46, 'PLANT:DRUM_LVL_B', { label: 'LT-B', w: 46, dp: 0, u: '' }), vbox(114, 46, 'PLANT:DRUM_LVL_C', { label: 'LT-C', w: 46, dp: 0, u: '' }));
  s.push(vbox(170, 46, 'FWC:DRUM_LVL_SEL', { label: 'Level 2oo3', w: 50, dp: 0 }));
  s.push(loopTag(10, 166, 'FWC', 'LIC_DRUM'));
  s.push(vbox(350, 150, 'PLANT:DRUM_PRESS', { label: 'Drum pressure' }), vbox(350, 192, 'PLANT:DRUM_TEMP', { label: 'Sat. temp', dp: 0 }));
  s.push(vbox(350, 234, 'PLANT:DRUM_METAL_DT', { label: 'Drum metal dT', dp: 0, w: 56 }));
  // Safety valve & EBD
  s.push(pipe([[290, 105], [290, 80]], 'steam thin'), valve(290, 72, { open: 'PLANT:SAFETY_VLV_LIFT', orient: 'v', size: 8, label: 'SAFETY', ldy: -12 }));
  s.push(pipe([[70, 135], [40, 135], [40, 600]], 'water thin'));
  s.push(valve(40, 610, { node: 'FWC', dev: 'EBD', orient: 'v', label: 'EBD', ldx: 30, ldy: 4 }));
  s.push(vbox(60, 600, 'PLANT:BLOWDOWN_FLOW', { label: 'Blowdown', w: 56, dp: 0 }));

  // Primary SH -> attemperator -> final SH -> main steam
  s.push(pipe([[260, 90], [260, 70], [430, 70], [430, 110], [450, 110]], 'steam', { flow: 'PLANT:STEAM_FLOW', th: 5 }));
  s.push(hx(450, 92, 110, 36, 'PRIMARY SH'));
  s.push(pipe([[560, 110], [640, 110]], 'steam'));
  s.push(`<circle cx="650" cy="110" r="10" class="equip"/>`, txt(650, 90, 'DSH', 'lbl-s', 'middle'));
  s.push(pipe([[660, 110], [700, 110]], 'steam'));
  s.push(hx(700, 92, 110, 36, 'FINAL SH'));
  s.push(pipe([[810, 110], [1200, 110]], 'steam', { flow: 'PLANT:STEAM_FLOW', th: 5, arrow: true }), txt(1150, 100, 'TO HP TURBINE', 'lbl-s', 'end'));
  s.push(vbox(470, 162, 'PLANT:SH1_OUT_TEMP', { label: 'PSH outlet', dp: 0, w: 52 }), vbox(700, 162, 'PLANT:DSH_OUT_TEMP', { label: 'DSH outlet', dp: 0, w: 52 }));
  s.push(vbox(840, 130, 'PLANT:MS_TEMP', { label: 'MS temp', dp: 1 }), vbox(940, 130, 'PLANT:MS_PRESS', { label: 'MS press' }), vbox(1040, 130, 'PLANT:STEAM_FLOW', { label: 'MS flow', dp: 0 }));
  s.push(vbox(840, 50, 'PLANT:SH_METAL_TEMP', { label: 'SH tube metal', dp: 0 }));
  s.push(loopTag(840, 172, 'STC', 'TIC_MS'), loopTag(700, 200, 'STC', 'TIC_DSH'));
  // SH vent
  s.push(pipe([[1000, 110], [1000, 74]], 'steam thin'), valve(1000, 66, { node: 'DEH', dev: 'SH_VENT', orient: 'v', size: 8, label: 'SH VENT', ldy: -12 }));
  s.push(vbox(1030, 56, 'PLANT:VENT_FLOW', { label: 'Vent flow', w: 50, dp: 0 }));

  // Reheater
  s.push(pipe([[1200, 300], [900, 300]], 'rh', { flow: 'PLANT:CRH_PRESS', th: 3 }), txt(1150, 292, 'COLD REHEAT FROM HP', 'lbl-s', 'end'));
  s.push(`<circle cx="860" cy="300" r="9" class="equip"/>`);
  s.push(pipe([[850, 300], [810, 300]], 'rh'));
  s.push(hx(700, 282, 110, 36, 'REHEATER'));
  s.push(pipe([[700, 300], [660, 300], [660, 380], [1200, 380]], 'rh', { flow: 'PLANT:HRH_PRESS', th: 3, arrow: true }), txt(1150, 372, 'HOT REHEAT TO IP', 'lbl-s', 'end'));
  s.push(vbox(940, 320, 'PLANT:CRH_PRESS', { label: 'CRH press' }), vbox(1040, 320, 'PLANT:CRH_TEMP', { label: 'CRH temp', dp: 0 }));
  s.push(vbox(900, 400, 'PLANT:HRH_TEMP', { label: 'HRH temp', dp: 1 }), vbox(1000, 400, 'PLANT:HRH_PRESS', { label: 'HRH press' }));
  s.push(vbox(540, 300, 'PLANT:RH_METAL_TEMP', { label: 'RH tube metal', dp: 0 }));
  s.push(loopTag(900, 440, 'STC', 'TIC_RH'), loopTag(1000, 440, 'STC', 'TIC_RHS'));
  s.push(vbox(1110, 400, 'PLANT:TILT_FB', { label: 'Burner tilt', w: 50 }));
  // HP bypass
  s.push(pipe([[1100, 110], [1100, 300]], 'steam thin dim'));
  s.push(valve(1100, 210, { pos: 'PLANT:HPB_POS', fp: 'loop:DEH:PIC_HPB', orient: 'v', label: 'HP BYPASS', ldx: 44, ldy: 4, posDx: -28, posDy: 4 }));
  s.push(vbox(1125, 230, 'PLANT:HPB_FLOW', { w: 54, dp: 0 }));
  // LP bypass
  s.push(pipe([[760, 380], [760, 520], [1200, 520]], 'rh thin dim', { arrow: true }), txt(1150, 512, 'TO CONDENSER', 'lbl-s', 'end'));
  s.push(valve(980, 520, { pos: 'PLANT:LPB_POS', fp: 'loop:DEH:PIC_LPB', label: 'LP BYPASS', ldy: -34, posDy: 26 }));
  s.push(vbox(1020, 530, 'PLANT:LPB_FLOW', { w: 54, dp: 0 }));

  // Feedwater & economizer
  s.push(pipe([[1200, 640], [600, 640]], 'water', { flow: 'PLANT:FW_FLOW', th: 5 }), txt(1150, 632, 'FEEDWATER FROM HP HEATERS', 'lbl-s', 'end'));
  s.push(valve(980, 640, { pos: 'PLANT:FCV_FB', fp: 'loop:FWC:FIC_FW', label: 'FW CONTROL VALVE', ldy: -26, posDy: 28 }));
  s.push(hx(480, 622, 120, 36, 'ECONOMIZER'));
  s.push(pipe([[480, 640], [330, 640], [330, 135], [300, 135]], 'water', { flow: 'PLANT:FW_FLOW', th: 5 }));
  s.push(vbox(1040, 660, 'PLANT:FW_FLOW', { label: 'FW flow', dp: 0 }), vbox(1040, 700, 'PLANT:FW_TEMP', { label: 'FW temp', dp: 0 }), vbox(860, 660, 'PLANT:FW_HDR_PRESS', { label: 'BFP disch.' }));
  s.push(vbox(350, 660, 'PLANT:ECO_OUT_TEMP', { label: 'Eco outlet', dp: 0 }));
  s.push(loopTag(1040, 740, 'FWC', 'FIC_FW'), loopTag(860, 740, 'FWC', 'PIC_FWDP', { w: 100 }));
  // Spray lines
  s.push(pipe([[800, 640], [800, 600], [650, 600], [650, 120]], 'water thin', { flow: 'PLANT:SH_SPRAY_FLOW', th: 1 }));
  s.push(valve(650, 250, { pos: 'PLANT:SH_SPRAY_FB', fp: 'loop:STC:TIC_DSH', orient: 'v', label: 'SH SPRAY', ldx: 50, ldy: 4, posDx: -28, posDy: 4 }));
  s.push(valve(650, 520, { node: 'STC', dev: 'SPRAY_BLOCK', orient: 'v', size: 8, label: 'BLOCK', ldx: -30, ldy: 4 }));
  s.push(vbox(690, 270, 'PLANT:SH_SPRAY_FLOW', { label: 'Spray flow', w: 52, dp: 0 }));
  s.push(pipe([[860, 640], [860, 309]], 'water thin', { flow: 'PLANT:RH_SPRAY_FLOW', th: 1 }));
  s.push(valve(860, 470, { pos: 'PLANT:RH_SPRAY_FB', fp: 'loop:STC:TIC_RHS', orient: 'v', size: 8, label: 'RH SPRAY', ldx: -36, ldy: 4, posDx: 22, posDy: 4 }));
  s.push(vbox(400, 420, 'PLANT:FEGT', { label: 'Furnace exit gas', dp: 0 }));
  s.push(ind(400, 470, 'PLANT:SAFETY_VLV_LIFT', { label: 'Safety valve lifted', kind: 'warn' }), ind(400, 492, 'STC:SPRAY_PERMIT', { label: 'Spray permitted' }));
  s.push(ind(400, 514, 'FWC:E3_ACTIVE', { label: '3-element active' }), ind(400, 536, 'FWC:LT_DEVIATION', { label: 'LT deviation', kind: 'bad' }));
  s.push(`<g class="clickable" data-fp="station:FWC:HIC_CBD">${txt(60, 660, 'CBD station', 'lbl-s')}</g>`, vbox(60, 666, 'PLANT:CBD_FB', { w: 50, dp: 0, fp: 'station:FWC:HIC_CBD' }));
  return svgRoot(1220, 780, s.join(''));
}

function side() {
  return [
    panel(
      'Drum level control',
      `<div class="row" style="margin-bottom:6px"><span style="color:var(--muted)">Elements</span>${wbtn('AUTO', 'FWC', 'ELEM_SEL', 0)}${wbtn('1-E', 'FWC', 'ELEM_SEL', 1)}${wbtn('3-E', 'FWC', 'ELEM_SEL', 2)}</div>
      <div class="kv">${kv('Level (median)', 'FWC:DRUM_LVL_SEL', { dp: 0 })}${kv('Level setpoint', 'FWC:LIC_DRUM.SP', { dp: 0 })}${kv('Steam flow', 'FWC:STEAM_FLOW_PCT', { dp: 1 })}</div>
      ${indRow('Three-element control', 'FWC:E3_ACTIVE')}${indRow('Level control in auto', 'FWC:LVL_AUTO')}${indRow('Transmitter deviation', 'FWC:LT_DEVIATION', 'bad')}`,
    ),
    panel(
      'Steam temperatures',
      `<div class="kv">${kv('Main steam', 'PLANT:MS_TEMP', { dp: 1 })}${kv('MS setpoint', 'STC:TIC_MS.SP', { dp: 0 })}${kv('DSH setpoint (cascade)', 'STC:TIC_DSH.SP', { dp: 0 })}${kv('Min DSH SP (superheat)', 'STC:DSH_SP_MIN', { dp: 0 })}${kv('Superheat', 'STC:MS_SUPERHEAT', { dp: 0 })}${kv('Hot reheat', 'PLANT:HRH_TEMP', { dp: 1 })}${kv('RH spray offset', 'STC:RHS_OFFSET', { dp: 0 })}</div>`,
    ),
    panel(
      'HP / LP bypass',
      `<div class="row" style="margin-bottom:6px"><span style="color:var(--muted)">HPB setpoint</span>${wbtn('FIXED', 'DEH', 'HPB_MODE', 0)}${wbtn('FOLLOW', 'DEH', 'HPB_MODE', 1)}</div>
      <div class="fp-line"><span>Target</span>${numSet('DEH', 'HPB_TARGET')} <span>bar</span></div>
      <div class="fp-line"><span>Ramp</span>${numSet('DEH', 'HPB_RAMP')} <span>bar/min</span></div>
      <div class="kv">${kv('HPB pressure SP', 'DEH:PIC_HPB.SP', { dp: 1 })}${kv('HPB position', 'PLANT:HPB_POS', { dp: 1 })}${kv('LPB pressure SP', 'DEH:PIC_LPB.SP', { dp: 1 })}${kv('LPB position', 'PLANT:LPB_POS', { dp: 1 })}</div>
      ${indRow('LP bypass interlocked (condenser)', 'DEH:LPB_ILK', 'bad')}`,
    ),
  ].join('');
}

export default {
  id: 'boiler',
  title: 'Boiler',
  render(root) {
    root.innerHTML = split(mimic(), side(), 330);
    return { dispose: attachControls(root) };
  },
};
