// Automated first part of a cold start-up from IC 1: auxiliaries, vacuum, fans, purge, light-off, heat-up.
const steps = [
  [5, 'Auxiliaries: CW, condensate, DA, hotwell, gland, vacuum', [
    ['BOP', 'CWP_A.START', true], ['BOP', 'CWP_B.START', true], ['BOP', 'CEP_A.START', true],
    ['BOP', 'LIC_HW.MODE', 1], ['FWC', 'LIC_DA.MODE', 1], ['FWC', 'PIC_DA.MODE', 1],
    ['BOP', 'GLAND.OPEN', true], ['BOP', 'VP_A.START', true], ['BOP', 'VP_B.START', true],
  ]],
  [40, 'Air heaters', [['CMB', 'APH_A.START', true], ['CMB', 'APH_B.START', true]]],
  [70, 'ID fans', [['CMB', 'ID_A.START', true], ['CMB', 'ID_B.START', true]]],
  [110, 'FD fans', [['CMB', 'FD_A.START', true], ['CMB', 'FD_B.START', true]]],
  [150, 'Draft & air control to auto', [
    ['CMB', 'SC_IDA.MODE', 1], ['CMB', 'SC_IDB.MODE', 1], ['CMB', 'SC_FDA.MODE', 1], ['CMB', 'SC_FDB.MODE', 1],
    ['CMB', 'PIC_FURN.MODE', 1], ['CMB', 'FIC_AIR.MODE', 2],
  ]],
  [200, 'Feedwater: BFP A, level control', [
    ['FWC', 'BFP_A.START', true], ['FWC', 'PIC_FWDP.MODE', 2], ['FWC', 'FIC_FW.MODE', 2],
    ['FWC', 'LIC_DRUM.SP', -100], ['FWC', 'LIC_DRUM.MODE', 1], ['FWC', 'EBD.MODE', 1],
  ]],
  [230, 'BFP A station to auto', [['FWC', 'SC_BFPA.MODE', 1]]],
  [300, 'Purge start', [['BMS', 'PURGE_START', true]]],
  [640, 'MFT reset', [['BMS', 'MFT_RESET', true]]],
  [650, 'Open gas train', [['BMS', 'GAS_TRAIN.OPEN', true]]],
  [670, 'Light elevation A', [['BMS', 'ELEV_A.START', true]]],
  [720, 'Fire at 9 % GFCV, bypass in auto', [
    ['CMB', 'FIC_GAS.OUT', 9], ['DEH', 'HPB_TARGET', 60], ['DEH', 'HPB_RAMP', 1], ['DEH', 'PIC_HPB.MODE', 1], ['DEH', 'PIC_LPB.MODE', 1],
  ]],
];

let t0 = null;
let i = 0;
export default async function ({ simT: abs, write, read }) {
  if (t0 === null) t0 = abs;
  const t = abs - t0;
  while (i < steps.length && t >= steps[i][0]) {
    const [, label, writes] = steps[i++];
    console.log(`>> ${t.toFixed(0)}s ${label}`);
    for (const [n, tag, v] of writes) await write(n, tag, v);
  }
  if (Math.floor(t) % 100 === 0 && t > 1) {
    const b = await read('BMS', ['MFT', 'MFT_CAUSE', 'PURGE_READY', 'PURGE_ACTIVE', 'PURGE_COMPLETE', 'ELEV_A.STATE', 'GAS_TRAIN.STATE']);
    const p = await read('PLANT', ['DRUM_TEMP', 'DRUM_METAL_DT', 'COND_PRESS', 'BFP_A_RUN', 'FD_A_RUN', 'ID_A_RUN']);
    console.log('cs', t.toFixed(0), JSON.stringify({ ...b, ...p }, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v)));
  }
}
