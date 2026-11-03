// OpenPLC check for BOP: trip the running CW pump and condensate pump, the standby units must start.
const done = {};
let t0 = null;
export default async function ({ simT: abs, write, read }) {
  if (t0 === null) t0 = abs;
  const t = abs - t0;
  if (t > 60 && !done.trip) {
    done.trip = true;
    const p = await read('PLANT', ['CWP_A_RUN', 'CWP_B_RUN', 'CEP_A_RUN', 'CEP_B_RUN']);
    console.log('>> before trips', JSON.stringify(p));
    await write('PLANT', 'MF_CWP_A_TRIP', true);
    await write('PLANT', 'MF_CEP_A_TRIP', true);
    console.log('>> trip CWP A and CEP A');
  }
  if (Math.floor(t) % 20 === 0 && t > 1) {
    const b = await read('BOP', ['HEARTBEAT', 'IC_APPLIED', 'IC_ACK', 'CWP_A.TRIP', 'CWP_B.RUN', 'CEP_B.RUN', 'LIC_HW.MODE', 'LIC_HW.OUT', 'LIC_HW.PV', 'VAC_OK', 'COMM_DEH', 'COND_PRESS']);
    const p = await read('PLANT', ['CWP_A_RUN', 'CWP_B_RUN', 'CEP_A_RUN', 'CEP_B_RUN', 'HW_LVL', 'MAKEUP_FB', 'COND_PRESS']);
    console.log('bop', t.toFixed(0), JSON.stringify({ ...b, ...p }, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v)));
  }
}
