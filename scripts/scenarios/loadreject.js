// Full load rejection (grid fault opens 52G) EV_OFFSET seconds after start; expect OPC to hold
// the turbine near 3000 rpm (house load / FSNL) and the bypass to protect the boiler.
const OFF = Number(process.env.EV_OFFSET ?? 30);
let t0 = null;
let fired = false;
let next = 0;
export default async function ({ simT: abs, write, read }) {
  if (t0 === null) t0 = abs;
  const t = abs - t0;
  if (!fired && t > OFF) {
    fired = true;
    console.log('>> MF_GRID_FAULT');
    await write('PLANT', 'MF_GRID_FAULT', true);
  }
  if (fired && t >= next && t < OFF + 120) {
    next = t + 4;
    const p = await read('PLANT', ['SPEED_A', 'GV_POS', 'ICV_POS', 'GEN_KV', 'MS_PRESS', 'HPB_POS', 'GAS_FLOW']);
    const d = await read('DEH', ['MODE', 'OPC_ACTIVE', 'TRIPPED']);
    console.log('lr', (t - OFF).toFixed(1), JSON.stringify({ ...p, ...d }, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v)));
  }
}
