import { svgRoot, pipe, txt, title, vbox, valve, loopTag, flame, fan, motorBox, ind, stext, hx } from '../svg.js';
import { kv, indRow, numSet, attachControls, panel, split } from '../ui.js';

const ELEVS = ['D', 'C', 'B', 'A'];

function mimic() {
  const s = [];
  s.push(title(20, 28, 'COMBUSTION - NATURAL GAS, AIR & FLUE GAS'));
  // Gas fuel train
  s.push(pipe([[20, 130], [420, 130]], 'gas', { flow: 'PLANT:GAS_FLOW', th: 0.5 }), txt(20, 120, 'NATURAL GAS (PRS outlet)', 'lbl-s'));
  s.push(vbox(20, 140, 'PLANT:GAS_SUPPLY_PRESS', { label: '', w: 56 }));
  s.push(valve(150, 130, { open: 'PLANT:MGTV_OPEN', label: 'SSV-1' }), valve(230, 130, { open: 'PLANT:MGTV_OPEN', label: 'SSV-2' }));
  s.push(pipe([[190, 130], [190, 70]], 'gas thin'), valve(190, 82, { open: 'PLANT:GAS_VENT_OPEN', orient: 'v', size: 8, label: 'VENT', ldx: 30, ldy: 4 }), txt(190, 60, 'to atm.', 'lbl-s', 'middle'));
  s.push(valve(320, 130, { pos: 'PLANT:GFCV_FB', fp: 'loop:CMB:FIC_GAS', label: 'GAS FLOW CV', ldy: -26, posDy: 28 }));
  s.push(vbox(260, 170, 'PLANT:GAS_FLOW', { label: 'Gas flow', w: 60 }), loopTag(260, 205, 'CMB', 'FIC_GAS'));
  s.push(pipe([[420, 130], [420, 470]], 'gas'));
  s.push(vbox(340, 250, 'PLANT:GAS_HDR_PRESS', { label: 'Burner header', w: 56 }));
  ELEVS.forEach((x, i) => {
    const y = 230 + i * 80;
    s.push(pipe([[420, y], [570, y]], 'gas thin', { flow: `PLANT:GAS_${x}_FLOW`, th: 0.2 }));
    s.push(valve(470, y, { open: `PLANT:BRN_${x}_OPEN`, size: 9 }));
    s.push(txt(440, y - 14, `ELEV ${x}`, 'lbl-b'));
    s.push(vbox(495, y + 8, `PLANT:GAS_${x}_FLOW`, { w: 44, u: '' }));
    s.push(ind(520, y - 16, `PLANT:IGN_${x}_FLAME`, { label: 'IGN', kind: 'warn', r: 5, ldx: 8 }));
    s.push(stext(440, y + 44, `BMS:ELEV_${x}.STATE`, { cls: 'lbl-s' }));
    s.push(flame(590, y, `PLANT:FLAME_${x}`, 1.1));
  });
  // Furnace
  s.push(`<rect class="furnace" x="575" y="150" width="230" height="440" rx="4"/>`);
  s.push(`<g data-showif="BMS:FUEL_IN_SERVICE"><ellipse class="fireball" cx="690" cy="380" rx="95" ry="140"/></g>`);
  s.push(txt(690, 175, 'FURNACE', 'lbl-b', 'middle'));
  s.push(vbox(650, 200, 'PLANT:FEGT', { label: 'FEGT', w: 56, dp: 0 }));
  s.push(vbox(640, 540, 'CMB:FURN_PRESS_SEL', { label: 'Furnace pressure', w: 60 }));
  s.push(vbox(590, 610, 'PLANT:FURN_PRESS_A', { w: 44, dp: 1, u: '' }), vbox(640, 610, 'PLANT:FURN_PRESS_B', { w: 44, dp: 1, u: '' }), vbox(690, 610, 'PLANT:FURN_PRESS_C', { w: 44, dp: 1, u: 'mbar' }));
  s.push(txt(590, 646, 'PT-A / PT-B / PT-C', 'lbl-s'));
  s.push(loopTag(710, 540, 'CMB', 'PIC_FURN'));
  s.push(vbox(650, 245, 'BMS:FIREBALL', { label: 'Flame intensity', w: 50, dp: 0 }));
  // Flue gas path
  s.push(pipe([[805, 170], [880, 170], [880, 470]], 'flue', { flow: 'PLANT:AIR_FLOW', th: 50 }));
  s.push(hx(850, 230, 60, 60, 'SH / RH', 'equip'), hx(850, 320, 60, 50, 'ECO', 'equip'));
  s.push(vbox(900, 390, 'PLANT:ECO_GAS_OUT_T', { label: 'Eco out gas', w: 50, dp: 0 }));
  s.push(pipe([[880, 470], [880, 500], [940, 500]], 'flue'), pipe([[880, 500], [880, 590], [940, 590]], 'flue'));
  s.push(`<rect class="equip" x="940" y="475" width="70" height="50" rx="4"/>`, `<rect class="equip" x="940" y="565" width="70" height="50" rx="4"/>`);
  s.push(motorBox(975, 545 - 2, { node: 'CMB', dev: 'APH_A', text: 'APH A', w: 50 }));
  s.push(motorBox(975, 635, { node: 'CMB', dev: 'APH_B', text: 'APH B', w: 50 }));
  s.push(pipe([[1010, 500], [1060, 500]], 'flue'), pipe([[1010, 590], [1060, 590]], 'flue'));
  s.push(fan(1080, 500, { node: 'CMB', dev: 'ID_A', label: 'ID FAN A' }), fan(1080, 590, { node: 'CMB', dev: 'ID_B', label: 'ID FAN B' }));
  s.push(pipe([[1100, 500], [1150, 500]], 'flue'), pipe([[1100, 590], [1150, 590], [1150, 140]], 'flue', { arrow: true }), txt(1150, 125, 'STACK', 'lbl-b', 'middle'));
  s.push(vbox(1030, 430, 'PLANT:APH_GAS_OUT_T', { label: 'APH gas out', w: 50, dp: 0 }));
  s.push(vbox(1110, 520, 'PLANT:ID_A_VANE_FB', { w: 44, dp: 0, fp: 'station:CMB:SC_IDA' }));
  s.push(vbox(1110, 610, 'PLANT:ID_B_VANE_FB', { w: 44, dp: 0, fp: 'station:CMB:SC_IDB' }));
  s.push(vbox(1040, 250, 'PLANT:O2', { label: 'Flue gas O2', w: 50, dp: 2 }), vbox(1040, 295, 'PLANT:CO', { label: 'CO', w: 50, dp: 0 }), vbox(1040, 340, 'PLANT:NOX', { label: 'NOx', w: 50, dp: 0 }));
  // Air path
  s.push(txt(20, 700, 'ATMOSPHERE', 'lbl-s'));
  s.push(pipe([[20, 700], [180, 700]], 'air'), pipe([[20, 760], [180, 760]], 'air'));
  s.push(fan(200, 700, { node: 'CMB', dev: 'FD_A', label: '' }), fan(200, 760, { node: 'CMB', dev: 'FD_B', label: '' }));
  s.push(txt(20, 690, 'FD FAN A', 'lbl-s'), txt(20, 750, 'FD FAN B', 'lbl-s'));
  s.push(pipe([[220, 700], [975, 700], [975, 615]], 'air', { flow: 'PLANT:FD_A_FLOW', th: 20 }), pipe([[220, 760], [990, 760], [990, 615]], 'air', { flow: 'PLANT:FD_B_FLOW', th: 20 }));
  s.push(pipe([[960, 565], [960, 545]], 'air thin'));
  s.push(pipe([[940, 640], [540, 640], [540, 160], [575, 160]], 'air', { flow: 'PLANT:AIR_FLOW', th: 50 }), txt(530, 150, 'WINDBOX', 'lbl-s', 'end'));
  s.push(vbox(250, 664, 'PLANT:FD_A_PITCH_FB', { label: 'Pitch A', w: 44, dp: 0, fp: 'station:CMB:SC_FDA' }), vbox(250, 724, 'PLANT:FD_B_PITCH_FB', { label: 'Pitch B', w: 44, dp: 0, fp: 'station:CMB:SC_FDB' }));
  s.push(vbox(360, 664, 'PLANT:FD_A_FLOW', { label: 'Air A', w: 56, dp: 0 }), vbox(360, 724, 'PLANT:FD_B_FLOW', { label: 'Air B', w: 56, dp: 0 }));
  s.push(vbox(760, 664, 'PLANT:AIR_FLOW', { label: 'Total air', w: 60, dp: 0 }), loopTag(840, 662, 'CMB', 'FIC_AIR'));
  s.push(vbox(760, 724, 'PLANT:APH_AIR_OUT_T', { label: 'Hot air', w: 50, dp: 0 }), loopTag(840, 722, 'CMB', 'AIC_O2'));
  s.push(vbox(480, 664, 'PLANT:FD_A_AMPS', { label: 'FD A amps', w: 50, dp: 0 }), vbox(480, 724, 'PLANT:FD_B_AMPS', { label: 'FD B amps', w: 50, dp: 0 }));
  s.push(vbox(1160, 450, 'PLANT:ID_A_AMPS', { label: 'ID A amps', w: 44, dp: 0, u: '' }), vbox(1160, 640, 'PLANT:ID_B_AMPS', { label: 'ID B amps', w: 44, dp: 0, u: '' }));
  s.push(ind(20, 240, 'BMS:MFT', { label: 'MFT', kind: 'bad', r: 8 }), ind(20, 268, 'BMS:GAS_TRAIN.OPENED', { label: 'Gas train open', r: 6 }), ind(20, 290, 'CMB:CROSS_LIMIT', { label: 'Cross-limit', kind: 'warn' }), ind(20, 312, 'CMB:RB_FAN', { label: 'Fan runback', kind: 'warn' }));
  return svgRoot(1220, 790, s.join(''));
}

function side() {
  return [
    panel(
      'Fuel / air master',
      `<div class="kv">${kv('Boiler demand', 'CMB:BLR_DMD', { dp: 1 })}${kv('Gas demand', 'CMB:GAS_DMD', { dp: 1 })}${kv('Gas flow', 'PLANT:GAS_FLOW', { dp: 1 })}${kv('Gas capacity (elevations)', 'CMB:GAS_CAPACITY', { dp: 0 })}${kv('Firing rate', 'PLANT:FUEL_HEAT', { dp: 0 })}${kv('Air demand', 'CMB:AIR_DMD', { dp: 0 })}${kv('Air flow', 'PLANT:AIR_FLOW', { dp: 0 })}${kv('O2 setpoint (program)', 'CMB:O2_SP_PROG', { dp: 2 })}${kv('O2 trim output', 'CMB:AIC_O2.OUT', { dp: 1 })}</div>
      ${indRow('Fuel master in CAS', 'CMB:FM_AUTO')}${indRow('Air control in auto', 'CMB:AIR_AUTO')}${indRow('Furnace draft in auto', 'CMB:FURN_AUTO')}${indRow('Cross-limiting active', 'CMB:CROSS_LIMIT', 'warn')}`,
    ),
    panel(
      'Combustion settings',
      `<div class="fp-line"><span>O2 bias</span>${numSet('CMB', 'O2_BIAS')} <span>%</span></div>
       <div class="fp-line"><span>Purge air</span>${numSet('CMB', 'PURGE_AIR')} <span>t/h</span></div>
       <div class="fp-line"><span>Light-off</span>${numSet('CMB', 'LIGHTOFF_POS')} <span>% GFCV</span></div>
       <div class="fp-line"><span>Min fire</span>${numSet('CMB', 'MIN_FIRE_POS')} <span>% GFCV</span></div>`,
    ),
    panel(
      'Draft & fans',
      `<table class="tbl"><tr><th>Fan</th><th class="r">Demand</th><th class="r">Pos</th><th class="r">Amps</th></tr>
      ${[
        ['FD A', 'SC_FDA', 'FD_A_PITCH_FB', 'FD_A_AMPS'],
        ['FD B', 'SC_FDB', 'FD_B_PITCH_FB', 'FD_B_AMPS'],
        ['ID A', 'SC_IDA', 'ID_A_VANE_FB', 'ID_A_AMPS'],
        ['ID B', 'SC_IDB', 'ID_B_VANE_FB', 'ID_B_AMPS'],
      ]
        .map(
          ([n, st, fb, a]) =>
            `<tr class="click" data-fp="station:CMB:${st}"><td>${n} <span class="mode-pill" data-mode="CMB:${st}">MAN</span></td><td class="r mono" data-v="CMB:${st}.OUT">--</td><td class="r mono" data-v="PLANT:${fb}">--</td><td class="r mono" data-v="PLANT:${a}" data-dp="0">--</td></tr>`,
        )
        .join('')}</table>`,
    ),
  ].join('');
}

export default {
  id: 'combustion',
  title: 'Combustion',
  render(root) {
    root.innerHTML = split(mimic(), side(), 330);
    return { dispose: attachControls(root) };
  },
};
