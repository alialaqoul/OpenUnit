// From IC 3 (FSNL): auto-synchronise at t=60 s, then raise load locally to 150 MW.
const done = {};
export default async function ({ simT, write, read }) {
  if (simT > 60 && !done.sync) {
    done.sync = true;
    await write('GEN', 'SYNC_ON', true);
    console.log('>> SYNC ON');
  }
  if (simT > 200 && !done.load) {
    done.load = true;
    await write('DEH', 'LOAD_TARGET', 150);
    await write('DEH', 'LOAD_RATE', 20);
    await write('DEH', 'GO', true);
    await write('CMB', 'FIC_GAS.OUT', 22);
    console.log('>> LOAD 150 MW');
  }
  if (Math.floor(simT) % 20 === 0) {
    const g = await read('GEN', ['SYNC_STATE', 'DV_PCT', 'LOCKOUT_86', 'TRIP_CAUSE']);
    const p = await read('PLANT', ['SYNC_SLIP', 'SYNC_PHASE', 'GCB_CLOSED', 'GEN_KV']);
    const d = await read('DEH', ['SPEED_REF', 'MODE', 'LOAD_REF']);
    console.log('sync', simT.toFixed(0), JSON.stringify({ ...g, ...p, ...d }, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v)));
  }
}
