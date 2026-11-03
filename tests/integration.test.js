import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Run the whole distributed system on alternate ports so a running simulator is not disturbed.
const base = JSON.parse(readFileSync(path.resolve('config/network.json'), 'utf8'));
let port = 6120;
for (const n of Object.values(base.nodes)) n.port = port++;
base.hmi.port = 6199;
const dir = mkdtempSync(path.join(tmpdir(), 'plantsim-'));
process.env.SIM_CONFIG = path.join(dir, 'network.json');
writeFileSync(process.env.SIM_CONFIG, JSON.stringify(base));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('distributed system integration (plant + 8 controllers over Modbus TCP)', () => {
  let plant;
  let ctrls;
  let client;
  let MAPS;
  let readTag;
  let encodeTag;
  let DataStore;

  const read = async (node, tag) => {
    const t = MAPS[node].get(tag);
    const c = client[node];
    const st = new DataStore(MAPS[node].sizes());
    const words = t.type === 'f32' || t.type === 'u32' ? 2 : 1;
    st.load(t.area, t.address, await c.readArea(t.area, t.address, words));
    return readTag(st, t);
  };
  const write = async (node, tag, v) => {
    const t = MAPS[node].get(tag);
    if (t.area === 'co') await client[node].writeSingleCoil(t.address, !!v);
    else await client[node].writeMultipleRegisters(t.address, encodeTag(t, v));
  };
  const until = async (fn, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await wait(200);
    }
    return false;
  };

  beforeAll(async () => {
    ({ MAPS } = await import('../src/maps/index.js'));
    ({ readTag, encodeTag } = await import('../src/common/tags.js'));
    ({ DataStore } = await import('../src/common/modbus/dataStore.js'));
    const { PlantNode } = await import('../src/plant/index.js');
    const { createController } = await import('../src/controllers/index.js');
    const { ModbusClient } = await import('../src/common/modbus/client.js');
    const { CONTROLLER_NAMES } = await import('../src/common/config.js');
    plant = new PlantNode({ autoRun: true, initialIC: 5 });
    await plant.start();
    ctrls = CONTROLLER_NAMES.map(createController);
    for (const c of ctrls) await c.start();
    client = {};
    for (const n of ['PLANT', ...CONTROLLER_NAMES]) {
      client[n] = new ModbusClient({ ...base.nodes[n] });
      await client[n].connect();
    }
  });

  afterAll(async () => {
    for (const c of Object.values(client || {})) c.close();
    for (const c of ctrls || []) await c.stop();
    if (plant) await plant.stop();
  });

  it('starts running automatically once every controller is on line', async () => {
    expect(await until(async () => !(await read('PLANT', 'SIM_FROZEN')))).toBe(true);
    for (const n of ['CCS', 'BMS', 'CMB', 'FWC', 'STC', 'DEH', 'GEN', 'BOP']) expect(await read(n, 'HEALTHY'), n).toBe(true);
  });

  it('holds full load in coordinated control', async () => {
    await write('PLANT', 'SIM_SPEED', 5);
    await wait(4000);
    expect(await read('CCS', 'MODE_ACT')).toBe(3);
    expect(await read('PLANT', 'GEN_MW')).toBeGreaterThan(600);
    expect(await read('BMS', 'MFT')).toBe(false);
    expect(await read('DEH', 'TRIPPED')).toBe(false);
  });

  it('exchanges data peer-to-peer over Modbus (CCS -> CMB, GEN -> DEH)', async () => {
    const bd = await read('CCS', 'BLR_DMD');
    expect(Math.abs((await read('CMB', 'BLR_DMD_REM')) - bd)).toBeLessThan(3);
    expect(await read('CMB', 'COMM_CCS')).toBe(true);
    expect(await read('DEH', 'COMM_GEN')).toBe(true);
    expect(await read('DEH', 'CCS_REQ')).toBe(1);
  });

  it('a manual MFT trips the turbine and the generator (protection cascade)', async () => {
    await write('BMS', 'MFT_PB', true);
    expect(await until(async () => await read('BMS', 'MFT'))).toBe(true);
    expect(await read('BMS', 'MFT_CAUSE')).toBe(1);
    expect(await until(async () => await read('DEH', 'TRIPPED'))).toBe(true);
    expect(await read('DEH', 'TRIP_CAUSE')).toBe(9);
    expect(await until(async () => !(await read('PLANT', 'GCB_CLOSED')), 30000)).toBe(true);
    expect(await read('PLANT', 'FUEL_HEAT')).toBe(0);
  });
});
