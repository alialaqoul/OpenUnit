import { DataStore } from '../common/modbus/dataStore.js';
import { ModbusClient } from '../common/modbus/client.js';
import { TagIO } from '../common/tags.js';
import { loadNetworkConfig, plcNodes } from '../common/config.js';
import { createLogger } from '../common/logger.js';
import { saveIC, loadIC } from '../common/icStore.js';
import { MAPS } from '../maps/index.js';

const HB_TIMEOUT_MS = 2500;
const IC_PHASE_TIMEOUT_MS = 8000;
const IC_SETTLE_CYCLES = 3;

/** Areas that carry a node's published status: OpenPLC maps keep everything in hr/co. */
const statusAreas = (map) => (map.layout === 'openplc' ? ['hr', 'co'] : ['ir', 'di']);

/**
 * I/O bridge between the plant (field I/O), the OpenPLC soft-PLCs and their peers.
 *
 * In a DCS the controller scans its I/O modules over a field bus and exchanges global data with
 * other controllers over the control network. An OpenPLC Runtime is a Modbus TCP *server* only,
 * so this bridge does that work, over Modbus TCP, every `openplc.bridgeMs`:
 *
 *   1. reads the plant I/O, every PLC and every Node.js peer a PLC talks to;
 *   2. writes each PLC's input image (I_*, P_*, IO_*) into the PLC;
 *   3. copies each PLC's outputs (Q_*, W_*) into the plant and the peers, plus its heartbeat.
 *
 * It also coordinates initial conditions exactly like the Node.js controllers do (two phases,
 * outputs held while settling), saves controller snapshots, and re-initialises a PLC that was
 * restarted - e.g. after a program upload from OpenPLC Editor - from its last known settings.
 */
export class PlcBridge {
  constructor({ nodes = plcNodes() } = {}) {
    this.cfg = loadNetworkConfig();
    this.log = createLogger('BRIDGE');
    this.plcs = nodes;
    this.periodMs = this.cfg.openplc?.bridgeMs ?? 50;
    this.links = {};
    const need = new Set(['PLANT', ...this.plcs]);
    for (const n of this.plcs) {
      const img = MAPS[n].plcImage;
      if (!img) throw new Error(`${n} has no OpenPLC I/O image (is it listed in openplc.controllers?)`);
      for (const p of img.peers) need.add(p);
    }
    for (const node of need) this.links[node] = this.#mkLink(node);
    this.state = Object.fromEntries(
      this.plcs.map((n) => [n, { initDone: false, hold: true, seq: 1 + Math.floor(Math.random() * 30000), shadow: null, icDone: 0 }]),
    );
    this.ic = null;
    this.plantIcSeq = undefined;
    this.plantSnapSeq = undefined;
    this.busy = false;
    this.alive = {};
    this.cycles = 0;
    this.lastErrorLog = 0;
    this.stats = { cycles: 0, lastCycleMs: 0, maxCycleMs: 0, overruns: 0 };
  }

  #mkLink(node) {
    const map = MAPS[node];
    const store = new DataStore(map.sizes());
    const nc = this.cfg.nodes[node];
    const client = new ModbusClient({ ...nc, timeoutMs: this.cfg.controllers.requestTimeoutMs ?? 1000, name: `BRIDGE->${node}` });
    const link = { node, map, store, io: new TagIO(map, store), client, ok: false, fails: 0, synced: false, hb: { v: null, t: -Infinity } };
    client.on('disconnect', () => {
      link.ok = false;
      link.synced = false;
    });
    return link;
  }

  async start() {
    for (const l of Object.values(this.links)) l.client.connect();
    this.timer = setInterval(() => this.cycle(), this.periodMs);
    this.log.info(`I/O bridge for ${this.plcs.join(', ')} every ${this.periodMs} ms`);
  }

  async stop() {
    clearInterval(this.timer);
    for (const l of Object.values(this.links)) l.client.close();
  }

  #logError(msg) {
    const now = Date.now();
    if (now - this.lastErrorLog > 10000) {
      this.lastErrorLog = now;
      this.log.warn(msg);
    }
  }

  // ------------------------------------------------------------------ reads
  async #read(link, areas) {
    if (!link.client.connected) {
      link.ok = false;
      return;
    }
    try {
      for (const area of areas) {
        const r = link.map.range(area);
        if (r.count) link.store.load(area, r.start, await link.client.readArea(area, r.start, r.count));
      }
      link.ok = true;
      link.fails = 0;
    } catch (err) {
      if (++link.fails > 3) link.ok = false;
      this.#logError(`read ${link.node}: ${err.message}`);
    }
  }

  /** Reads back the blocks the PLCs own in another node's map, so the first write changes nothing. */
  async #syncOwned(link) {
    try {
      for (const owner of this.plcs) {
        if (owner === link.node) continue;
        for (const area of ['co', 'hr']) {
          const r = link.map.ownerRange(owner, area);
          if (r.count) link.store.load(area, r.start, await link.client.readArea(area, r.start, r.count));
        }
      }
      link.synced = true;
    } catch (err) {
      this.#logError(`sync ${link.node}: ${err.message}`);
    }
  }

  #alive(link) {
    if (!link.ok) return false;
    const v = link.io.has('HEARTBEAT') ? link.io.get('HEARTBEAT') : null;
    const now = performance.now();
    if (v !== link.hb.v) {
      if (link.hb.v !== null) link.hb.t = now;
      link.hb.v = v;
    }
    return now - link.hb.t < HB_TIMEOUT_MS;
  }

  // ------------------------------------------------------------------ cycle
  async cycle() {
    if (this.busy) {
      this.stats.overruns++;
      return;
    }
    this.busy = true;
    const t0 = performance.now();
    try {
      const plant = this.links.PLANT;
      await Promise.all(
        Object.values(this.links).map(async (l) => {
          if (l.client.connected && !l.synced) await this.#syncOwned(l);
          await this.#read(l, l.node === 'PLANT' ? ['ir', 'di'] : statusAreas(l.map));
        }),
      );
      const alive = Object.fromEntries(Object.entries(this.links).map(([n, l]) => [n, n === 'PLANT' ? l.ok : this.#alive(l)]));
      this.alive = alive;
      if (plant.ok) {
        this.#watchPlant();
        this.#watchRestarts();
        this.#advanceIC();
      }
      await Promise.all(this.plcs.map((n) => this.#serve(n, alive)));
    } catch (err) {
      this.#logError(`cycle: ${err.stack || err.message}`);
    } finally {
      const dt = performance.now() - t0;
      this.stats.cycles++;
      this.stats.lastCycleMs = dt;
      this.stats.maxCycleMs = Math.max(this.stats.maxCycleMs * 0.999, dt);
      this.busy = false;
    }
  }

  /** Puts the latest field and peer data into one PLC's input image (in the local store). */
  #fillImage(n, alive = this.alive) {
    const link = this.links[n];
    const img = link.map.plcImage;
    const plant = this.links.PLANT;
    const io = link.io;
    if (plant.ok) for (const p of img.plantIn) io.set(p.tag, plant.io.get(p.src));
    for (const p of img.peerIn) {
      // A peer PLC that restarted reads all-zero until it has taken its initialisation: keep the
      // last good values meanwhile (like the Node.js controllers do for a peer that is down).
      const ps = this.state[p.peer];
      if (ps && this.links[p.peer].io.get('IC_ACK') !== ps.seq) continue;
      io.set(p.tag, this.links[p.peer].io.get(p.src));
    }
    io.set('IO_COMM_PLANT', plant.ok);
    // A peer that writes into this PLC counts only while its outputs flow (like the writer
    // heartbeat watchdog of the Node.js controllers); a peer that is only read, while it answers.
    for (const p of img.peers) {
      const writer = !!link.map.owners[p];
      io.set(`IO_COMM_${p}`, !!alive[p] && !(writer && this.state[p]?.hold));
    }
  }

  /** Writes one PLC's input image and forwards its outputs. */
  async #serve(n, alive) {
    const link = this.links[n];
    if (!link.ok) return;
    const st = this.state[n];
    const img = link.map.plcImage;
    const plant = this.links.PLANT;
    const io = link.io;

    // ---- input image
    this.#fillImage(n, alive);
    // IO_IC_* are left as read back: only #icPhase issues a command, so a PLC that restarts
    // between a read and this write cannot mistake a stale command for a new one.
    const jobs = [];
    for (const area of ['hr', 'co']) {
      const r = link.map.ownerRange('IO', area);
      if (r.count) jobs.push(link.client.writeArea(area, r.start, Array.from(link.store[area].subarray(r.start, r.start + r.count))));
    }

    // ---- outputs to the field and to peers (held while initialising)
    if (!st.hold && plant.ok && alive[n]) {
      for (const q of img.plantOut) plant.io.set(q.dst, io.get(q.tag));
      jobs.push(this.#writeOwned(plant, n));
      const targets = new Set(img.peerOut.map((w) => w.peer));
      for (const t of img.peers) if (this.links[t].map.has(`${n}_HB`) && this.links[t].map.get(`${n}_HB`).owner === n) targets.add(t);
      for (const w of img.peerOut) this.links[w.peer].io.set(w.dst, io.get(w.tag));
      for (const t of targets) {
        const tl = this.links[t];
        if (tl.map.has(`${n}_HB`)) tl.io.set(`${n}_HB`, io.get('HEARTBEAT'));
        if (tl.ok && tl.synced) jobs.push(this.#writeOwned(tl, n));
      }
    }
    try {
      await Promise.all(jobs);
    } catch (err) {
      this.#logError(`write ${n}: ${err.message}`);
    }
  }

  #writeOwned(link, owner) {
    const jobs = [];
    for (const area of ['co', 'hr']) {
      const r = link.map.ownerRange(owner, area);
      if (r.count) jobs.push(link.client.writeArea(area, r.start, Array.from(link.store[area].subarray(r.start, r.start + r.count))));
    }
    return Promise.all(jobs);
  }

  // ------------------------------------------------------------------ initial conditions & snapshots
  #operatorTags(n) {
    return [...MAPS[n].tags.values()].filter((t) => !t.ro && !t.owner && !t.pulse);
  }

  #watchPlant() {
    const plant = this.links.PLANT;
    const icSeq = plant.io.get('IC_SEQ');
    const snapSeq = plant.io.get('SNAP_SEQ');
    if (this.plantIcSeq === undefined) {
      // Give every PLC link a chance to connect first (up to 15 s), so the first IC reaches all of them.
      this.t0 ??= performance.now();
      if (!this.plcs.every((n) => this.links[n].ok) && performance.now() - this.t0 < 15000) return;
      this.plantIcSeq = icSeq;
      this.plantSnapSeq = snapSeq;
      // Bridge start: PLCs that already run this IC are attached as they are, the others initialised.
      const active = plant.io.get('IC_ACTIVE');
      const fresh = [];
      for (const n of this.plcs) {
        const l = this.links[n];
        const st = this.state[n];
        if (l.ok && l.io.get('IC_ACK') !== 0 && l.io.get('IC_APPLIED') === active) {
          st.initDone = true;
          st.hold = false;
          st.seq = l.io.get('IC_ACK');
          this.log.info(`${n}: attached to running PLC (IC ${active})`);
        } else fresh.push(n);
      }
      if (fresh.length) this.#startIC(fresh, active, 'ic');
      return;
    }
    if (icSeq !== this.plantIcSeq) {
      this.plantIcSeq = icSeq;
      this.#startIC(this.plcs, plant.io.get('IC_ACTIVE'), 'ic');
    }
    if (snapSeq !== this.plantSnapSeq) {
      this.plantSnapSeq = snapSeq;
      this.#saveSnapshot(plant.io.get('SNAP_SLOT'));
    }
  }

  #watchRestarts() {
    for (const n of this.plcs) {
      const l = this.links[n];
      const st = this.state[n];
      if (!l.ok) continue;
      if (st.initDone && !this.ic?.targets.includes(n) && l.io.get('IC_ACK') !== st.seq) {
        // The PLC lost its memory: restarted or a new program was downloaded.
        this.log.warn(`${n}: PLC restarted - restoring its last settings`);
        st.initDone = false;
        this.#startIC([n], this.links.PLANT.io.get('IC_ACTIVE'), 'warm');
      }
      if (st.initDone && !st.hold) st.shadow = Object.fromEntries(this.#operatorTags(n).map((t) => [t.name, l.io.get(t.name)]));
    }
  }

  #startIC(targets, id, source) {
    if (this.ic && source === 'warm') {
      // Fold a single-PLC restart into an IC already in progress.
      for (const n of targets) if (!this.ic.targets.includes(n)) this.ic.targets.push(n);
    } else this.ic = { id, source, targets: [...targets], phase: 0, t0: 0, ready: 0, snap: {} };
    for (const n of targets) this.state[n].hold = true;
    this.log.info(`IC ${id} (${source}) for ${targets.join(', ')}`);
    this.#icPhase(1);
  }

  /** Writes the controller values for an IC phase and issues the command. */
  #icPhase(phase) {
    const ic = this.ic;
    ic.phase = phase;
    ic.t0 = performance.now();
    ic.ready = 0;
    for (const n of ic.targets) {
      const l = this.links[n];
      const st = this.state[n];
      const map = l.map;
      let values;
      let snap;
      if (ic.source === 'warm' && st.shadow) {
        values = st.shadow;
        snap = true;
      } else {
        const file = loadIC(ic.id, n);
        values = {};
        for (const t of map.tags.values()) if (t.init !== undefined && t.owner !== 'IO') values[t.name] = t.init;
        if (file?.tags) for (const [k, v] of Object.entries(file.tags)) if (map.has(k) && !map.get(k).ro) values[k] = v;
        snap = !!file?.tags;
      }
      for (const t of map.tags.values()) if (t.pulse) values[t.name] = false;
      for (const [k, v] of Object.entries(values)) if (map.has(k)) l.io.set(k, v);
      // The PLC initialises from what it sees in this very write: give it the current plant.
      this.#fillImage(n);
      ic.snap[n] = snap;
      st.seq = (st.seq % 30000) + 1;
      l.io.set('IO_IC_ID', ic.id);
      l.io.set('IO_IC_SNAP', snap);
      l.io.set('IO_IC_SEQ', st.seq);
      // Whole map: the PLC overwrites its own status next scan; operator values and the command land atomically.
      const jobs = ['hr', 'co'].map((area) => {
        const r = map.range(area);
        return r.count ? l.client.writeArea(area, r.start, Array.from(l.store[area].subarray(r.start, r.start + r.count))) : null;
      });
      Promise.all(jobs).catch((err) => this.#logError(`IC write ${n}: ${err.message}`));
    }
  }

  #advanceIC() {
    const ic = this.ic;
    if (!ic) return;
    const acked = ic.targets.every((n) => this.links[n].ok && this.links[n].io.get('IC_ACK') === this.state[n].seq);
    // Like the Node.js controllers: also wait until every controller reports this IC applied.
    const peersOk =
      ic.source === 'warm' ||
      Object.entries(this.links).every(([node, l]) => node === 'PLANT' || !l.map.has('IC_APPLIED') || (l.ok && l.io.get('IC_APPLIED') === ic.id));
    ic.ready = acked && peersOk ? ic.ready + 1 : 0;
    const timedOut = performance.now() - ic.t0 > IC_PHASE_TIMEOUT_MS;
    if (ic.ready < IC_SETTLE_CYCLES && !timedOut) return;
    if (timedOut) this.log.warn(`IC ${ic.id} phase ${ic.phase}: timeout waiting for ${ic.targets.filter((n) => this.links[n].io.get('IC_ACK') !== this.state[n].seq).join(', ') || 'peers'}`);
    if (ic.phase === 1) {
      this.#icPhase(2);
      return;
    }
    for (const n of ic.targets) {
      const st = this.state[n];
      st.initDone = true;
      st.hold = false;
      st.shadow = Object.fromEntries(this.#operatorTags(n).map((t) => [t.name, this.links[n].io.get(t.name)]));
    }
    this.log.info(`IC ${ic.id}: ${ic.targets.join(', ')} initialised (${ic.targets.map((n) => `${n}:${ic.snap[n] ? 'snapshot' : 'built-in'}`).join(' ')})`);
    this.ic = null;
  }

  #saveSnapshot(slot) {
    for (const n of this.plcs) {
      const l = this.links[n];
      if (!l.ok) continue;
      const tags = Object.fromEntries(this.#operatorTags(n).map((t) => [t.name, l.io.get(t.name)]));
      const out = {};
      for (const [node, link] of Object.entries(this.links)) {
        const owned = [...link.map.tags.values()].filter((t) => t.owner === n);
        if (owned.length) out[node] = Object.fromEntries(owned.map((t) => [t.name, link.io.get(t.name)]));
      }
      saveIC(slot, n, { version: 2, tags, state: {}, out });
    }
    this.log.info(`Snapshot ${slot}: saved ${this.plcs.join(', ')}`);
  }

  diag() {
    return {
      ...this.stats,
      ic: this.ic ? { id: this.ic.id, phase: this.ic.phase, targets: this.ic.targets } : null,
      plcs: Object.fromEntries(this.plcs.map((n) => [n, { ok: this.links[n].ok, initDone: this.state[n].initDone, hold: this.state[n].hold, seq: this.state[n].seq }])),
    };
  }
}
