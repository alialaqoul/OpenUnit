/**
 * Headless integration run: starts the plant and all controllers (real Modbus TCP on
 * localhost) and prints a status line periodically. Useful for tuning and for creating
 * initial-condition snapshots.
 *
 *   node scripts/headless.js --ic 5 --speed 5 --seconds 600 [--snap 5] [--scenario name]
 */
import { PlantNode } from '../src/plant/index.js';
import { createController } from '../src/controllers/index.js';
import { CONTROLLER_NAMES, loadNetworkConfig } from '../src/common/config.js';
import { ModbusClient } from '../src/common/modbus/client.js';
import { MAPS } from '../src/maps/index.js';
import { encodeTag, readTag } from '../src/common/tags.js';
import { DataStore } from '../src/common/modbus/dataStore.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const ic = Number(args.ic || 5);
const speed = Number(args.speed || 1);
const seconds = Number(args.seconds || 120);
const every = Number(args.every || 30);

const cfg = loadNetworkConfig();
const plant = new PlantNode({ autoRun: true, initialIC: ic });
const ctrls = CONTROLLER_NAMES.filter((n) => !cfg.plcNodes.includes(n)).map(createController);
await plant.start();
for (const c of ctrls) await c.start();
// OpenPLC mode (SIM_RUNTIME=openplc): soft-PLCs in WSL + I/O bridge instead of Node.js controllers
const opc = cfg.plcNodes.length ? await (await import('../src/openplc/index.js')).startOpenPlc({ manageRuntimes: !args['no-runtimes'] }) : null;

const clients = {};
for (const n of ['PLANT', ...CONTROLLER_NAMES]) {
  clients[n] = new ModbusClient({ ...cfg.nodes[n], name: `headless->${n}` });
  await clients[n].connect();
}

export async function write(node, tag, value) {
  const t = MAPS[node].get(tag);
  const words = encodeTag(t, value);
  if (t.area === 'co') await clients[node].writeSingleCoil(t.address, !!value);
  else await clients[node].writeMultipleRegisters(t.address, words);
}

export async function read(node, tags) {
  const map = MAPS[node];
  const st = new DataStore(map.sizes());
  for (const area of ['co', 'di', 'hr', 'ir']) {
    const r = map.range(area);
    if (r.count) st.load(area, r.start, await clients[node].readArea(area, r.start, r.count));
  }
  return Object.fromEntries(tags.map((t) => [t, readTag(st, map.get(t))]));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1500);
await write('PLANT', 'SIM_SPEED', speed);

const scenario = args.scenario ? (await import(`./scenarios/${args.scenario}.js`)).default : null;
const t0 = Date.now();
let nextPrint = 0;
const fmt = (v, d = 1) => (typeof v === 'number' ? v.toFixed(d) : String(v));
while ((Date.now() - t0) / 1000 < seconds / speed) {
  const pv = await read('PLANT', ['SIM_TIME_MS', 'GEN_MW', 'MS_PRESS', 'MS_TEMP', 'HRH_TEMP', 'DRUM_LVL_B', 'FURN_PRESS_B', 'O2', 'GAS_FLOW', 'AIR_FLOW', 'SPEED_A', 'COND_PRESS', 'DA_LVL', 'HW_LVL', 'GAS_HDR_PRESS', 'SH_SPRAY_FLOW', 'TILT_FB', 'FW_FLOW', 'STEAM_FLOW', 'GV_POS', 'HPB_POS', 'LPB_POS', 'DRUM_PRESS']);
  const simT = pv.SIM_TIME_MS / 1000;
  if (scenario) await scenario({ simT, write, read, pv });
  if (simT >= nextPrint) {
    nextPrint = simT + every;
    const ccs = await read('CCS', ['MODE_ACT', 'ULD_ACT', 'PRESS_SP', 'BLR_DMD']);
    const bms = await read('BMS', ['MFT', 'MFT_CAUSE', 'ELEV_INSERV']);
    const deh = await read('DEH', ['MODE', 'TRIPPED', 'TRIP_CAUSE']);
    const gen = await read('GEN', ['LOCKOUT_86', 'TRIP_CAUSE']);
    console.log(
      `t=${fmt(simT, 0)}s MW=${fmt(pv.GEN_MW)} P=${fmt(pv.MS_PRESS)}/${fmt(ccs.PRESS_SP)} Pd=${fmt(pv.DRUM_PRESS)} Tms=${fmt(pv.MS_TEMP)} Trh=${fmt(pv.HRH_TEMP)} lvl=${fmt(pv.DRUM_LVL_B, 0)} ` +
        `Pf=${fmt(pv.FURN_PRESS_B, 2)} O2=${fmt(pv.O2, 2)} gas=${fmt(pv.GAS_FLOW)} air=${fmt(pv.AIR_FLOW, 0)} hdr=${fmt(pv.GAS_HDR_PRESS, 0)} n=${fmt(pv.SPEED_A, 0)} ` +
        `cond=${fmt(pv.COND_PRESS)} DA=${fmt(pv.DA_LVL, 0)} HW=${fmt(pv.HW_LVL, 0)} spr=${fmt(pv.SH_SPRAY_FLOW, 0)} tilt=${fmt(pv.TILT_FB)} fw=${fmt(pv.FW_FLOW, 0)} st=${fmt(pv.STEAM_FLOW, 0)} ` +
        `GV=${fmt(pv.GV_POS)} HPB=${fmt(pv.HPB_POS)} LPB=${fmt(pv.LPB_POS)} | CCS=${ccs.MODE_ACT} ULD=${fmt(ccs.ULD_ACT)} BD=${fmt(ccs.BLR_DMD)} MFT=${bms.MFT}/${bms.MFT_CAUSE} el=${bms.ELEV_INSERV} DEH=${deh.MODE}/${deh.TRIP_CAUSE} 86G=${gen.LOCKOUT_86}/${gen.TRIP_CAUSE}`,
    );
  }
  await wait(250);
}

if (args.snap) {
  await write('PLANT', 'SNAP_SELECT', Number(args.snap));
  await write('PLANT', 'SNAP_SAVE', true);
  await wait(1500);
  console.log(`snapshot saved to slot ${args.snap}`);
}
for (const c of Object.values(clients)) c.close();
if (opc) await opc.stop({ stopRuntimes: false });
for (const c of ctrls) await c.stop();
await plant.stop();
process.exit(0);
