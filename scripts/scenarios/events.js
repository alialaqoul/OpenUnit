// Abnormal events from full load: BFP A trip, ID fan A trip (runback), grid fault (load rejection).
// EV_OFFSET = settling time before the first event (default 60 s; use ~1200 s from a built-in IC).
const OFF = Number(process.env.EV_OFFSET ?? 60);
const done = {};
let t0 = null;

const at = async (simT, t, key, fn) => {
  if (simT > t && !done[key]) {
    done[key] = true;
    await fn();
  }
};

export default async function ({ simT: abs, write }) {
  if (t0 === null) t0 = abs;
  const simT = abs - t0;
  await at(simT, OFF, 'bfp', async () => (console.log('>> MF_BFP_A_TRIP'), write('PLANT', 'MF_BFP_A_TRIP', true)));
  await at(simT, OFF + 300, 'bfpclr', async () => write('PLANT', 'MF_BFP_A_TRIP', false));
  await at(simT, OFF + 320, 'id', async () => (console.log('>> MF_ID_A_TRIP'), write('PLANT', 'MF_ID_A_TRIP', true)));
  await at(simT, OFF + 800, 'grid', async () => (console.log('>> MF_GRID_FAULT'), write('PLANT', 'MF_GRID_FAULT', true)));
}
