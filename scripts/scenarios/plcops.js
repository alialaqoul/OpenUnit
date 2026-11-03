// OpenPLC operations check: snapshot save -> IC load of that snapshot -> one PLC runtime killed
// and restarted by the supervisor (the bridge must restore its settings while the plant runs).
import { runHostScript } from '../../src/openplc/host.js';

const SLOT = Number(process.env.SNAP_SLOT ?? 9);
const done = {};
let prev = null;
let t = 0; // monotonic: loading an IC rewinds the simulation clock
let lastPrint = -Infinity;
export default async function ({ simT: abs, write, read }) {
  if (prev !== null && abs > prev) t += abs - prev;
  prev = abs;
  if (t > 20 && !done.save) {
    done.save = true;
    // a non-default operator value that must survive save / load / restart
    await write('STC', 'RHS_OFFSET', 7.5);
    await new Promise((r) => setTimeout(r, 1500));
    await write('PLANT', 'SNAP_SELECT', SLOT);
    await write('PLANT', 'SNAP_SAVE', true);
    console.log(`>> snapshot saved to slot ${SLOT}`);
  }
  if (t > 40 && !done.load) {
    done.load = true;
    await write('STC', 'RHS_OFFSET', 3);
    await write('PLANT', 'IC_SELECT', SLOT);
    await write('PLANT', 'IC_LOAD', true);
    console.log(`>> IC ${SLOT} loaded (RHS_OFFSET must return to 7.5)`);
    await new Promise((r) => setTimeout(r, 3000)); // let the controllers initialise, then RUN
    await write('PLANT', 'SIM_RUN', true);
  }
  if (t > 90 && !done.kill) {
    done.kill = true;
    console.log('>> killing the STC runtime (supervisor restarts it)');
    await runHostScript('instance.sh', ['stop', 'STC'], { quiet: true });
  }
  if (t - lastPrint >= 10) {
    lastPrint = t;
    const s = await read('STC', ['HEARTBEAT', 'IC_ACK', 'IC_APPLIED', 'RHS_OFFSET', 'TIC_MS.MODE', 'TIC_DSH.MODE', 'COMM_PLANT']).catch((e) => ({ STC: e.code }));
    const p = await read('PLANT', ['MS_TEMP', 'SH_SPRAY_DMD', 'IC_ACTIVE', 'GEN_MW']);
    console.log('ops', t.toFixed(0), JSON.stringify({ ...s, ...p }, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v)));
  }
}
