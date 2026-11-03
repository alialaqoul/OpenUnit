import { pathToFileURL } from 'node:url';
import { DataStore } from '../common/modbus/dataStore.js';
import { ModbusServer } from '../common/modbus/server.js';
import { TagIO, readTag, writeTag } from '../common/tags.js';
import { loadNetworkConfig } from '../common/config.js';
import { createLogger } from '../common/logger.js';
import { saveIC, loadIC } from '../common/icStore.js';
import { clamp } from '../common/blocks.js';
import { PLANT_MAP } from '../maps/plant.js';
import { PlantModel } from './model/PlantModel.js';
import { builtInState, IC_LIST } from './model/initialConditions.js';

const log = createLogger('PLANT');
const OWNERS = ['BOP', 'FWC', 'STC', 'CMB', 'BMS', 'DEH', 'GEN'];

/**
 * Process simulator node. Hosts the field I/O Modbus server, integrates the plant model
 * in (scaled) real time and implements the instructor functions: run/freeze, speed,
 * initial conditions, snapshots and malfunctions.
 */
export class PlantNode {
  constructor({ autoRun = true, initialIC = Number(process.env.SIM_IC || 5) } = {}) {
    this.cfg = loadNetworkConfig();
    this.map = PLANT_MAP;
    this.store = new DataStore(this.map.sizes());
    this.map.applyInit(this.store);
    this.io = new TagIO(this.map, this.store);
    this.server = new ModbusServer(this.store, { unitId: this.cfg.nodes.PLANT.unitId, name: 'PLANT' });
    this.model = new PlantModel();
    this.autoRun = autoRun;
    this.initialIC = initialIC;
    this.inputTags = [...this.map.tags.values()].filter((t) => t.area === 'co' || t.area === 'hr');
    this.outputTags = [...this.map.tags.values()].filter((t) => t.area === 'ir' || t.area === 'di');
    this.wd = { BMS: { v: -1, t: 0 }, DEH: { v: -1, t: 0 } };
    this.ownerWrites = Object.fromEntries(OWNERS.map((o) => [o, 0]));
    this.heartbeat = 0;
    this.icSeq = 0;
    this.snapSeq = 0;
    this.awaitingControllers = false;
    this.#indexOwnerRanges();
  }

  #indexOwnerRanges() {
    this.ownerRanges = [];
    for (const owner of OWNERS) {
      for (const area of ['co', 'hr']) {
        const r = this.map.ownerRange(owner, area);
        if (r.count) this.ownerRanges.push({ owner, area, start: r.start, end: r.start + r.count });
      }
    }
    this.server.on('write', ({ area, address, quantity }) => {
      for (const r of this.ownerRanges) {
        if (r.area === area && address < r.end && address + quantity > r.start) this.ownerWrites[r.owner]++;
      }
    });
  }

  async start() {
    const { port } = this.cfg.nodes.PLANT;
    await this.server.listen(port, this.cfg.bindHost);
    log.info(`Field I/O Modbus TCP server listening on ${this.cfg.bindHost}:${port}`);
    this.loadInitialCondition(this.initialIC);
    this.awaitingControllers = this.autoRun;
    this.last = performance.now();
    this.timer = setInterval(() => this.tick(), this.cfg.plant.tickMs);
  }

  async stop() {
    clearInterval(this.timer);
    await this.server.close();
  }

  readInputs() {
    const u = {};
    for (const t of this.inputTags) u[t.name] = readTag(this.store, t);
    const now = performance.now();
    for (const name of ['BMS', 'DEH']) {
      const v = this.io.get(`${name}_WD`);
      const w = this.wd[name];
      if (v !== w.v) {
        w.v = v;
        w.t = now;
      }
      u[`_${name.toLowerCase()}WdFail`] = now - w.t > 3000;
    }
    return u;
  }

  tick() {
    const now = performance.now();
    const wallDt = Math.min(0.5, (now - this.last) / 1000);
    this.last = now;
    const u = this.readInputs();

    // Instructor pulses
    if (u.IC_LOAD) {
      this.io.set('IC_LOAD', false);
      this.loadInitialCondition(u.IC_SELECT);
      return this.publish(true);
    }
    if (u.SNAP_SAVE) {
      this.io.set('SNAP_SAVE', false);
      this.saveSnapshot(u.SNAP_SELECT);
    }

    // Start-up: wait until every controller has written its output block a few times.
    if (this.awaitingControllers && OWNERS.every((o) => this.ownerWrites[o] >= 3)) {
      this.awaitingControllers = false;
      this.io.set('SIM_RUN', true);
      log.info('All controllers on line - simulation running');
      u.SIM_RUN = true;
    }

    const speed = clamp(Number(u.SIM_SPEED) || 1, 0.1, 20);
    const running = !!u.SIM_RUN;
    if (running) {
      const simDt = wallDt * speed;
      const n = Math.max(1, Math.ceil(simDt / this.cfg.plant.stepS));
      const dt = simDt / n;
      for (let i = 0; i < n; i++) this.model.step(dt, u);
      this.model.updateDrifts(simDt, u);
    }
    this.publish(!running, running ? speed : 0);
  }

  publish(frozen, speed = 0) {
    const out = this.model.measure();
    for (const t of this.outputTags) {
      if (out[t.name] !== undefined) writeTag(this.store, t, out[t.name]);
    }
    this.heartbeat = (this.heartbeat + 1) & 0xffff;
    this.io.set('SIM_FROZEN', frozen);
    this.io.set('SIM_TIME_MS', Math.floor(this.model.s.t * 1000) % 4294967296);
    this.io.set('SIM_SPEED_ACT', speed);
    this.io.set('HEARTBEAT', this.heartbeat);
    this.io.set('IC_SEQ', this.icSeq);
    this.io.set('SNAP_SEQ', this.snapSeq);
  }

  loadInitialCondition(id) {
    const slot = Number(id);
    let state = loadIC(slot, 'PLANT');
    let source = 'snapshot file';
    if (!state) {
      state = builtInState(slot);
      source = 'built-in model';
    }
    if (!state) {
      log.warn(`IC ${slot} does not exist`);
      return false;
    }
    const keepTime = this.model.s.t;
    this.model.setState(state);
    this.model.s.t = Math.max(keepTime, state.t || 0);
    this.io.set('SIM_RUN', false);
    this.io.set('IC_ACTIVE', slot);
    this.icSeq = (this.icSeq + 1) & 0xffff;
    // Keep the instructor environment consistent with the loaded state.
    this.io.set('GRID_FREQ_SET', state.fg ?? 60);
    this.io.set('CW_INLET_T_SET', state.cwIn ?? 25);
    for (const t of this.inputTags) if (t.name.startsWith('MF_') && t.type === 'bool') writeTag(this.store, t, false);
    const name = IC_LIST.find((i) => i.id === slot)?.name || `Snapshot ${slot}`;
    log.info(`Loaded IC ${slot} (${name}) from ${source} - simulation frozen`);
    this.publish(true);
    return true;
  }

  saveSnapshot(slot) {
    const n = Number(slot);
    if (!(n >= 1 && n <= 99)) return;
    saveIC(n, 'PLANT', this.model.s);
    const o = this.model.measure();
    const builtin = IC_LIST.find((i) => i.id === n);
    saveIC(n, 'meta', {
      name: builtin ? builtin.name : `Snapshot ${n} - ${o.GEN_MW.toFixed(0)} MW`,
      desc: builtin ? builtin.desc : `Saved ${new Date().toLocaleString()} (sim time ${(this.model.s.t / 3600).toFixed(2)} h)`,
      savedAt: new Date().toISOString(),
      mw: o.GEN_MW,
    });
    this.io.set('SNAP_SLOT', n);
    this.snapSeq = (this.snapSeq + 1) & 0xffff;
    log.info(`Snapshot saved to slot ${n}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const node = new PlantNode();
  node.start().catch((err) => {
    log.error(err);
    process.exit(1);
  });
  const shutdown = () => node.stop().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
