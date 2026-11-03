// From IC 3 (FSNL): synchronise, transfer to coordinated control, then raise unit load demand to 300 MW.
const done = {};
let t0 = null;
export default async function ({ simT: abs, write, read }) {
  if (t0 === null) t0 = abs;
  const simT = abs - t0;
  if (simT > 60 && !done.sync) {
    done.sync = true;
    await write('GEN', 'SYNC_ON', true);
    console.log('>> SYNC ON');
  }
  if (simT > 150 && !done.auto) {
    done.auto = true;
    await write('CMB', 'FIC_GAS.MODE', 2);
    await write('CMB', 'AIC_O2.MODE', 1);
    await write('DEH', 'MODE_SEL', 1);
    console.log('>> FIC_GAS CAS, AIC_O2 AUTO, DEH REMOTE');
  }
  if (simT > 200 && !done.cc) {
    done.cc = true;
    await write('CCS', 'MODE_REQ', 3);
    await write('CCS', 'ULD_TARGET', 300);
    await write('CCS', 'ULD_RATE', 20);
    await write('CCS', 'GO', true);
    console.log('>> CCS COORDINATED, ULD 300 MW at 20 MW/min');
  }
  if (simT > 260 && !done.elevB) {
    done.elevB = true;
    await write('BMS', 'ELEV_B.START', true);
    console.log('>> Light elevation B');
  }
  if (Math.floor(simT) % 20 === 0) {
    const c = await read('CCS', ['MODE_ACT', 'CC_PERM', 'ULD_ACT', 'BLR_DMD', 'PRESS_SP']);
    const d = await read('DEH', ['MODE', 'REM_READY']);
    const m = await read('CMB', ['FM_AUTO', 'GAS_DMD']);
    const p = await read('PLANT', ['GEN_MW', 'GAS_FLOW', 'MS_PRESS']);
    console.log('cc', simT.toFixed(0), JSON.stringify({ ...c, ...d, ...m, ...p }, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v)));
  }
}
