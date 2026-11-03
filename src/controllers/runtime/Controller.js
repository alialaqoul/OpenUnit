import { DataStore } from '../../common/modbus/dataStore.js';
import { ModbusServer } from '../../common/modbus/server.js';
import { ModbusClient } from '../../common/modbus/client.js';
import { TagIO } from '../../common/tags.js';
import { loadNetworkConfig } from '../../common/config.js';
import { createLogger } from '../../common/logger.js';
import { saveIC, loadIC } from '../../common/icStore.js';
import { MAPS, PEERS } from '../../maps/index.js';
import { Loop, Station, Motor, OnOff } from './blocks.js';

/**
 * Base class of every simulated controller (DCS controller / PLC).
 *
 *  - hosts its own Modbus TCP server (faceplates, setpoints, status for the HMI and peers)
 *  - is a Modbus TCP client of the field I/O (plant) and of its peer controllers
 *  - executes a cyclic scan: read inputs -> logic -> write outputs
 *  - uses the simulation clock for dt so that run/freeze/fast-time are honoured
 */
export class Controller {
  constructor(name) {
    this.name = name;
    this.cfg = loadNetworkConfig();
    this.log = createLogger(name);
    this.map = MAPS[name];
    this.store = new DataStore(this.map.sizes());
    this.map.applyInit(this.store);
    this.io = new TagIO(this.map, this.store);
    this.server = new ModbusServer(this.store, { unitId: this.cfg.nodes[name].unitId, name });
    this.pulseTags = [...this.map.tags.values()].filter((t) => t.pulse);

    const timeout = this.cfg.controllers.requestTimeoutMs;
    const mkClient = (node) =>
      new ModbusClient({ ...this.cfg.nodes[node], timeoutMs: timeout, name: `${name}->${node}` });
    const mkLink = (node) => {
      const map = MAPS[node];
      const mirror = new DataStore(map.sizes());
      const link = { node, map, mirror, io: new TagIO(map, mirror), client: mkClient(node), ok: false, synced: false, fails: 0 };
      link.client.on('disconnect', () => {
        link.ok = false;
        link.synced = false;
      });
      return link;
    };
    this.plant = mkLink('PLANT');
    const peerCfg = PEERS[name] || { read: [], write: [] };
    this.peerNames = [...new Set([...peerCfg.read, ...peerCfg.write])];
    this.peers = {};
    for (const p of this.peerNames) {
      this.peers[p] = mkLink(p);
      this.peers[p].read = peerCfg.read.includes(p);
      this.peers[p].write = peerCfg.write.includes(p);
    }
    this.writers = Object.keys(this.map.owners).filter((o) => o !== name);
    // A peer that writes into this controller counts as alive only once its heartbeat changes.
    this.writerHb = Object.fromEntries(this.writers.map((w) => [w, { v: null, t: -Infinity }]));

    this.state = this.defaultState();
    this.loops = {};
    this.stations = {};
    this.devices = {};
    this.dt = 0;
    this.prevSimMs = null;
    this.icSeen = undefined;
    this.snapSeen = undefined;
    this.resync = true;
    this.scanCount = 0;
    this.hb = 0;
    this.busy = false;
    this.started = false;
    this.startTime = performance.now();
    this.graceUntil = 0;
    this.icSettle = 0;
    this.icPending = 0;
    this.lastErrorLog = 0;
    this.rejects = [];
  }

  // ----------------------------------------------------------------- registration helpers
  defaultState() {
    return { dev: {}, stMode: {}, timers: {}, edges: {}, ramps: {}, seq: {}, latch: {} };
  }

  loop(name, opts) {
    return (this.loops[name] = new Loop(this, name, opts));
  }

  station(name) {
    return (this.stations[name] = new Station(this, name));
  }

  motor(name, opts) {
    return (this.devices[name] = new Motor(this, name, opts));
  }

  onoff(name, opts) {
    return (this.devices[name] = new OnOff(this, name, opts));
  }

  // ----------------------------------------------------------------- tag access
  get(name) {
    return this.io.get(name);
  }

  set(name, v) {
    this.io.set(name, v);
  }

  /** Field I/O value (transmitter / status) or own output. */
  p(name) {
    return this.plant.io.get(name);
  }

  /** Writes a field output; only tags owned by this controller may be written. */
  pset(name, v) {
    const t = this.plant.map.get(name);
    if (t.owner !== this.name) throw new Error(`${this.name} may not write PLANT.${name} (owner ${t.owner})`);
    this.plant.io.set(name, v);
  }

  peer(node, name) {
    return this.peers[node].io.get(name);
  }

  peerSet(node, name, v) {
    const link = this.peers[node];
    const t = link.map.get(name);
    if (t.owner !== this.name) throw new Error(`${this.name} may not write ${node}.${name}`);
    link.io.set(name, v);
  }

  peerOk(node) {
    return this.peers[node]?.ok ?? false;
  }

  /** True for a few seconds after an IC load / start-up while peers settle (no mode degradation). */
  inGrace() {
    return performance.now() < this.graceUntil;
  }

  writerOk(node) {
    const w = this.writerHb[node];
    return !!w && performance.now() - w.t < 2500;
  }

  reject(msg) {
    this.rejects.push(msg);
    if (this.rejects.length > 20) this.rejects.shift();
  }

  // ----------------------------------------------------------------- function block helpers
  ton(key, cond, preset) {
    const t = this.state.timers;
    t[key] = cond ? Math.min(preset, (t[key] || 0) + this.dt) : 0;
    return !!cond && t[key] >= preset;
  }

  timerValue(key) {
    return this.state.timers[key] || 0;
  }

  rise(key, v) {
    const e = this.state.edges;
    const r = !!v && !e[key];
    e[key] = !!v;
    return r;
  }

  fall(key, v) {
    const e = this.state.edges;
    const f = !v && !!e[key];
    e[key] = !!v;
    return f;
  }

  ramp(key, target, ratePerS, init = target) {
    const r = this.state.ramps;
    if (r[key] === undefined || this.resync) r[key] = r[key] ?? init;
    const d = target - r[key];
    const step = ratePerS * this.dt;
    r[key] += Math.max(-step, Math.min(step, d));
    return r[key];
  }

  setRamp(key, value) {
    this.state.ramps[key] = value;
  }

  // ----------------------------------------------------------------- hooks for subclasses
  /** Called after loading a built-in IC (no snapshot file). Set modes / setpoints here. */
  onBuiltInIC() {}

  /** Called after any IC load (built-in or snapshot). */
  afterIC() {}

  /** Cyclic logic. */
  logic() {}

  // ----------------------------------------------------------------- lifecycle
  async start() {
    const { port } = this.cfg.nodes[this.name];
    await this.server.listen(port, this.cfg.bindHost);
    this.log.info(`Modbus TCP server on ${this.cfg.bindHost}:${port}; peers: ${this.peerNames.join(', ') || 'none'}`);
    this.plant.client.connect();
    for (const p of Object.values(this.peers)) p.client.connect();
    this.timer = setInterval(() => this.scan(), this.cfg.controllers.scanMs);
  }

  async stop() {
    clearInterval(this.timer);
    this.plant.client.close();
    for (const p of Object.values(this.peers)) p.client.close();
    await this.server.close();
  }

  async #syncLink(link) {
    // Read back what this controller previously wrote so a restart is bumpless.
    for (const area of ['co', 'hr']) {
      const r = link.map.ownerRange(this.name, area);
      if (r.count) link.mirror.load(area, r.start, await link.client.readArea(area, r.start, r.count));
    }
    link.synced = true;
  }

  async #readLink(link, areas) {
    if (!link.client.connected) {
      link.ok = false;
      return;
    }
    try {
      if (!link.synced) await this.#syncLink(link);
      await Promise.all(
        areas.map(async (area) => {
          const r = link.map.range(area);
          if (r.count) link.mirror.load(area, r.start, await link.client.readArea(area, r.start, r.count));
        }),
      );
      link.ok = true;
      link.fails = 0;
    } catch (err) {
      link.fails++;
      if (link.fails > 3) link.ok = false;
      this.#logError(`read ${link.node}: ${err.message}`);
    }
  }

  async #writeLink(link) {
    if (!link.client.connected || !link.synced) return;
    try {
      const jobs = [];
      for (const area of ['co', 'hr']) {
        const r = link.map.ownerRange(this.name, area);
        if (r.count) jobs.push(link.client.writeArea(area, r.start, Array.from(link.mirror[area].subarray(r.start, r.start + r.count))));
      }
      await Promise.all(jobs);
    } catch (err) {
      this.#logError(`write ${link.node}: ${err.message}`);
    }
  }

  #logError(msg) {
    const now = Date.now();
    if (now - this.lastErrorLog > 10000) {
      this.lastErrorLog = now;
      this.log.warn(msg);
    }
  }

  async scan() {
    if (this.busy) return;
    this.busy = true;
    try {
      const reads = [this.#readLink(this.plant, ['ir', 'di'])];
      // An OpenPLC peer publishes its status in holding registers and coils (see tags.js layouts).
      for (const link of Object.values(this.peers)) if (link.read) reads.push(this.#readLink(link, link.map.layout === 'openplc' ? ['hr', 'co'] : ['ir', 'di']));
      await Promise.all(reads);
      for (const link of Object.values(this.peers)) {
        if (!link.read && link.client.connected && !link.synced) {
          await this.#syncLink(link).catch((e) => this.#logError(e.message));
        }
        if (!link.read) link.ok = link.client.connected && link.synced;
      }

      // Start-up: wait until every peer link has delivered data (or 5 s have passed)
      if (!this.started) {
        const peersUp = Object.values(this.peers).every((l) => l.ok);
        if (this.plant.ok && (peersUp || performance.now() - this.startTime > 5000)) {
          this.started = true;
          this.graceUntil = performance.now() + 6000;
        }
      }
      const t0 = performance.now();
      if (this.plant.ok && this.started) this.#execute();
      this.set('SCAN_MS', performance.now() - t0);

      if (this.started && this.icSettle === 0) {
        const writes = [];
        if (this.plant.ok) writes.push(this.#writeLink(this.plant));
        for (const link of Object.values(this.peers)) if (link.write) writes.push(this.#writeLink(link));
        await Promise.all(writes);
      }
    } catch (err) {
      this.#logError(`scan: ${err.stack || err.message}`);
    } finally {
      this.#diagnostics();
      this.busy = false;
    }
  }

  #execute() {
    // Simulation time step
    const simMs = this.p('SIM_TIME_MS');
    let dt = 0;
    if (this.prevSimMs !== null) {
      dt = (simMs - this.prevSimMs) / 1000;
      if (dt < 0 || dt > 5) dt = 0;
    }
    this.prevSimMs = simMs;
    this.dt = dt;
    this.set('SIM_DT', dt);

    // Initial conditions and snapshots requested by the instructor
    // Two-phase IC handling: apply, let every controller run a few scans without writing
    // outputs (peers publish their new status meanwhile), then re-apply on fresh data.
    const icSeq = this.p('IC_SEQ');
    if (icSeq !== this.icSeen) {
      this.icSeen = icSeq;
      this.icPending = this.p('IC_ACTIVE');
      this.#applyIC(this.icPending, true);
      this.icSettle = 40;
      this.icReady = 0;
    } else if (this.icSettle > 0) {
      const readPeers = Object.values(this.peers).filter((l) => l.read);
      const peersReady = readPeers.every((l) => l.ok && l.io.get('IC_APPLIED') === this.icPending);
      this.icReady = peersReady ? this.icReady + 1 : 0;
      this.icSettle--;
      if (this.icReady >= 3 || this.icSettle === 0) {
        this.icSettle = 0;
        this.#applyIC(this.icPending, false);
      }
    }
    const snapSeq = this.p('SNAP_SEQ');
    if (this.snapSeen === undefined) this.snapSeen = snapSeq;
    else if (snapSeq !== this.snapSeen) {
      this.snapSeen = snapSeq;
      this.#saveSnapshot(this.p('SNAP_SLOT'));
    }

    // Peer heartbeats received
    const now = performance.now();
    for (const w of this.writers) {
      const v = this.get(`${w}_HB`);
      const hb = this.writerHb[w];
      if (v !== hb.v) {
        if (hb.v !== null) hb.t = now;
        hb.v = v;
      }
    }

    this.logic();
    this.resync = false;

    // Watchdog to the hardwired protection and heartbeats to peers
    this.hb = (this.hb + 1) & 0xffff;
    const wd = `${this.name}_WD`;
    if (this.plant.map.has(wd)) this.pset(wd, this.hb);
    for (const link of Object.values(this.peers)) {
      if (link.write && link.map.has(`${this.name}_HB`)) this.peerSet(link.node, `${this.name}_HB`, this.hb);
    }
    for (const t of this.pulseTags) this.set(t.name, false);
  }

  #diagnostics() {
    this.scanCount++;
    this.set('HEARTBEAT', this.scanCount & 0xffff);
    this.set('SCAN_COUNT', this.scanCount);
    this.set('COMM_PLANT', this.plant.ok);
    this.set('HEALTHY', this.plant.ok);
    const settling = !this.started || this.inGrace();
    for (const p of this.peerNames) if (this.map.has(`COMM_${p}`)) this.set(`COMM_${p}`, this.peers[p].ok || settling);
    // During start-up / IC grace the writers are re-establishing their heartbeats: no nuisance alarms.
    for (const w of this.writers) if (this.map.has(`COMM_${w}`)) this.set(`COMM_${w}`, this.writerOk(w) || this.inGrace() || !this.started);
  }

  #applyIC(id, first = true) {
    const snap = loadIC(id, this.name);
    if (snap && snap.tags) {
      this.map.applyInit(this.store);
      for (const [name, v] of Object.entries(snap.tags)) if (this.map.has(name)) this.set(name, v);
      this.state = { ...this.defaultState(), ...snap.state };
      for (const [node, tags] of Object.entries(snap.out || {})) {
        const link = node === 'PLANT' ? this.plant : this.peers[node];
        if (!link) continue;
        for (const [name, v] of Object.entries(tags)) if (link.map.has(name)) link.io.set(name, v);
      }
      if (!first) this.log.info(`IC ${id}: restored controller snapshot`);
    } else {
      this.state = this.defaultState();
      this.map.applyInit(this.store);
      for (const d of Object.values(this.devices)) d.syncFromPlant();
      this.onBuiltInIC(id);
      if (!first) this.log.info(`IC ${id}: built-in controller initialisation`);
    }
    for (const t of this.pulseTags) this.set(t.name, false);
    // Data written by peers before the IC is stale: wait for a fresh heartbeat from each writer.
    for (const w of this.writers) this.writerHb[w] = { v: this.get(`${w}_HB`), t: -Infinity };
    this.afterIC(id);
    this.set('IC_APPLIED', id);
    this.resync = true;
    this.graceUntil = performance.now() + 6000;
  }

  #saveSnapshot(slot) {
    // Stored by tag name so snapshots survive register map changes.
    const out = {};
    for (const link of [this.plant, ...Object.values(this.peers).filter((l) => l.write)]) {
      out[link.node] = {};
      for (const t of link.map.tags.values()) if (t.owner === this.name) out[link.node][t.name] = link.io.get(t.name);
    }
    const tags = {};
    for (const t of this.map.tags.values()) if ((t.area === 'hr' || t.area === 'co') && !t.pulse && !t.owner) tags[t.name] = this.get(t.name);
    saveIC(slot, this.name, { version: 2, tags, state: this.state, out });
    this.log.info(`Snapshot saved to slot ${slot}`);
  }
}
