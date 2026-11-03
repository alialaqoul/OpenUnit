import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ModbusClient } from '../common/modbus/client.js';
import { DataStore } from '../common/modbus/dataStore.js';
import { readTag, encodeTag } from '../common/tags.js';
import { loadNetworkConfig, NODE_NAMES } from '../common/config.js';
import { createLogger } from '../common/logger.js';
import { listSnapshots } from '../common/icStore.js';
import { MAPS, PEERS } from '../maps/index.js';
import { MALFUNCTIONS } from '../maps/plant.js';
import { IC_LIST } from '../plant/model/initialConditions.js';
import { AlarmEngine } from './alarms.js';
import { History } from './history.js';

const log = createLogger('HMI');
const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

/**
 * HMI / SCADA server: Modbus TCP master polling every node, alarm engine, historian,
 * event journal, and the HTTP/SSE gateway for the browser HMI.
 */
export class HmiServer {
  constructor() {
    this.cfg = loadNetworkConfig();
    this.nodes = {};
    for (const n of NODE_NAMES) {
      const map = MAPS[n];
      const store = new DataStore(map.sizes());
      const client = new ModbusClient({ ...this.cfg.nodes[n], timeoutMs: 1500, name: `HMI->${n}` });
      this.nodes[n] = { name: n, map, store, client, ok: false, values: {}, lastOk: 0, polls: 0, errors: 0 };
    }
    this.events = [];
    this.eventSeq = 0;
    this.alarms = new AlarmEngine(MAPS, { onEvent: (e) => this.addEvent(e) });
    this.histKeys = [];
    for (const n of NODE_NAMES) {
      for (const t of MAPS[n].tags.values()) {
        if ((t.area === 'ir' || t.area === 'hr') && t.type === 'f32') this.histKeys.push(`${n}:${t.name}`);
        else if (t.area === 'di' && n === 'PLANT' && /_RUN$|FLAME|GCB|MFT/.test(t.name)) this.histKeys.push(`${n}:${t.name}`);
      }
    }
    this.history = new History(this.histKeys, { capacity: 7200 });
    this.clients = new Set();
    this.lastSent = {};
    this.lastHist = 0;
    this.icSeq = null;
    this.polling = false;
  }

  addEvent(e) {
    const ev = { seq: ++this.eventSeq, t: Date.now(), sim: this.simTime(), ...e };
    this.events.push(ev);
    if (this.events.length > 1000) this.events.shift();
    this.pendingEvents = (this.pendingEvents || []).concat(ev);
  }

  simTime() {
    return (this.nodes.PLANT.values.SIM_TIME_MS ?? 0) / 1000;
  }

  async start() {
    for (const n of Object.values(this.nodes)) {
      n.client.on('disconnect', () => (n.ok = false));
      n.client.connect();
    }
    const { host, port, pollMs } = this.cfg.hmi;
    this.http = http.createServer((req, res) => this.route(req, res).catch((err) => this.fail(res, 500, err.message)));
    await new Promise((resolve) => this.http.listen(port, host, resolve));
    log.info(`HMI available at http://${host}:${port}`);
    this.timer = setInterval(() => this.poll(), pollMs);
  }

  async stop() {
    clearInterval(this.timer);
    for (const c of this.clients) c.end();
    for (const n of Object.values(this.nodes)) n.client.close();
    await new Promise((r) => this.http.close(r));
  }

  // ------------------------------------------------------------------ polling
  async pollNode(n) {
    if (!n.client.connected) {
      n.ok = false;
      return;
    }
    try {
      await Promise.all(
        ['co', 'di', 'hr', 'ir'].map(async (area) => {
          const r = n.map.range(area);
          if (r.count) n.store.load(area, r.start, await n.client.readArea(area, r.start, r.count));
        }),
      );
      const v = {};
      for (const t of n.map.tags.values()) v[t.name] = readTag(n.store, t);
      n.values = v;
      n.ok = true;
      n.lastOk = Date.now();
      n.polls++;
    } catch {
      n.errors++;
      if (Date.now() - n.lastOk > 3000) n.ok = false;
    }
  }

  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const wasOk = Object.fromEntries(Object.values(this.nodes).map((n) => [n.name, n.ok]));
      await Promise.all(Object.values(this.nodes).map((n) => this.pollNode(n)));
      for (const n of Object.values(this.nodes)) {
        if (wasOk[n.name] !== n.ok) this.addEvent({ type: n.ok ? 'COMM' : 'COMM_FAIL', pri: n.ok ? 3 : 1, text: `HMI communication with ${n.name} ${n.ok ? 'restored' : 'LOST'}` });
      }
      const values = Object.fromEntries(Object.values(this.nodes).map((n) => [n.name, n.values]));
      const comm = Object.fromEntries(Object.values(this.nodes).map((n) => [n.name, n.ok]));

      const icSeq = values.PLANT?.IC_SEQ;
      if (this.nodes.PLANT.ok && icSeq !== undefined && icSeq !== this.icSeq) {
        if (this.icSeq !== null) {
          this.alarms.reset();
          this.addEvent({ type: 'IC', pri: 3, text: `Initial condition ${values.PLANT.IC_ACTIVE} loaded - simulation frozen` });
        }
        this.icSeq = icSeq;
      }
      const alarmChanged = this.alarms.evaluate(values, comm);

      const now = Date.now();
      if (now - this.lastHist >= 1000 && this.nodes.PLANT.ok) {
        this.lastHist = now;
        this.history.record((k) => {
          const i = k.indexOf(':');
          return values[k.slice(0, i)]?.[k.slice(i + 1)] ?? 0;
        }, now, this.simTime());
      }
      this.broadcast(values, comm, alarmChanged);
    } finally {
      this.polling = false;
    }
  }

  diag() {
    const out = {};
    for (const n of Object.values(this.nodes)) {
      out[n.name] = { ok: n.ok, polls: n.polls, errors: n.errors, ...n.client.stats, host: n.client.host, port: n.client.port, unitId: n.client.unitId };
    }
    return out;
  }

  broadcast(values, comm, alarmChanged) {
    const delta = {};
    for (const [node, v] of Object.entries(values)) {
      const last = (this.lastSent[node] ||= {});
      const d = {};
      for (const [k, val] of Object.entries(v)) {
        const r = typeof val === 'number' ? Math.round(val * 1000) / 1000 : val;
        if (last[k] !== r) {
          d[k] = r;
          last[k] = r;
        }
      }
      if (Object.keys(d).length) delta[node] = d;
    }
    const msg = { type: 'delta', values: delta, comm, counts: this.alarms.counts(), diag: this.diag(), t: Date.now() };
    if (alarmChanged) msg.alarms = this.alarms.list();
    if (this.pendingEvents?.length) {
      msg.events = this.pendingEvents;
      this.pendingEvents = [];
    }
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of this.clients) res.write(data);
  }

  fullSnapshot() {
    const values = {};
    for (const n of Object.values(this.nodes)) values[n.name] = n.values;
    return {
      type: 'full',
      values,
      comm: Object.fromEntries(Object.values(this.nodes).map((n) => [n.name, n.ok])),
      alarms: this.alarms.list(),
      counts: this.alarms.counts(),
      events: this.events.slice(-200),
      diag: this.diag(),
      t: Date.now(),
    };
  }

  // ------------------------------------------------------------------ writes
  async writeTag(node, tagName, value, source = 'Operator') {
    const n = this.nodes[node];
    if (!n) throw new Error(`Unknown node ${node}`);
    const t = n.map.get(tagName);
    if (t.ro) throw new Error(`${node}.${tagName} is read-only`);
    if (node === 'PLANT' ? t.owner !== 'INS' : !!t.owner) throw new Error(`${node}.${tagName} is written by ${t.owner || 'the controllers'} and cannot be set from the HMI`);
    if (!n.client.connected) throw new Error(`No communication with ${node}`);
    let v = value;
    if (t.type === 'bool') v = value === true || value === 1 || value === '1' || value === 'true';
    else v = Number(value);
    if (t.type !== 'bool' && !Number.isFinite(v)) throw new Error('Value must be numeric');
    if (t.area === 'co') await n.client.writeSingleCoil(t.address, v);
    else await n.client.writeMultipleRegisters(t.address, encodeTag(t, v));
    if (!t.pulse || v) {
      const shown = t.enum && t.type !== 'bool' ? t.enum[v] ?? v : t.type === 'bool' ? (t.pulse ? 'PRESSED' : v ? 'ON' : 'OFF') : v;
      this.addEvent({ type: source === 'Instructor' ? 'INSTRUCTOR' : 'OPERATOR', pri: 3, text: `${source}: ${node} ${tagName} (${t.desc}) -> ${shown}` });
    }
    return { ok: true };
  }

  // ------------------------------------------------------------------ http
  json(res, obj, code = 200) {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }

  fail(res, code, message) {
    if (!res.headersSent) this.json(res, { ok: false, error: message }, code);
  }

  async body(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const s = Buffer.concat(chunks).toString('utf8');
    return s ? JSON.parse(s) : {};
  }

  catalog() {
    const nodes = {};
    for (const n of NODE_NAMES) {
      const c = MAPS[n].catalog();
      nodes[n] = { ...c, host: this.cfg.nodes[n].host, port: this.cfg.nodes[n].port, unitId: this.cfg.nodes[n].unitId, title: this.cfg.nodes[n].title };
      // OpenPLC soft-PLC: where OpenPLC Editor and the runtime web page reach it
      const plc = this.cfg.nodes[n].runtime === 'openplc' ? this.cfg.openplc.nodes[n] : null;
      if (plc) nodes[n].openplc = { ip: plc.ip, webPort: plc.webPort, project: `plc/projects/${n}` };
    }
    const snaps = listSnapshots();
    const ics = IC_LIST.map((ic) => ({ ...ic, builtin: true, snapshot: snaps.some((s) => s.id === ic.id) }));
    for (const s of snaps) if (!ics.some((i) => i.id === s.id)) ics.push({ id: s.id, name: s.name, desc: s.desc, builtin: false, snapshot: true });
    return { nodes, peers: PEERS, malfunctions: MALFUNCTIONS.map(([tag, desc, group]) => ({ tag, desc, group })), ics, hmi: this.cfg.hmi };
  }

  async route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (p === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(this.fullSnapshot())}\n\n`);
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return;
    }
    if (p === '/api/catalog') return this.json(res, this.catalog());
    if (p === '/api/write' && req.method === 'POST') {
      const b = await this.body(req);
      try {
        return this.json(res, await this.writeTag(b.node, b.tag, b.value, b.source));
      } catch (err) {
        return this.fail(res, 400, err.message);
      }
    }
    if (p === '/api/history') {
      const keys = (url.searchParams.get('tags') || '').split(',').filter(Boolean);
      return this.json(res, this.history.query(keys, Number(url.searchParams.get('seconds') || 600)));
    }
    if (p === '/api/alarms') return this.json(res, { alarms: this.alarms.list(), counts: this.alarms.counts() });
    if (p === '/api/ack' && req.method === 'POST') {
      const b = await this.body(req);
      const n = this.alarms.ack(b.id || 'ALL');
      if (n) this.addEvent({ type: 'ACK', pri: 3, text: `Operator acknowledged ${n} alarm(s)` });
      this.broadcastAlarms();
      return this.json(res, { ok: true, acked: n });
    }
    if (p === '/api/events') return this.json(res, this.events.slice(-1000));
    if (p === '/api/diag') return this.json(res, this.diag());
    if (p === '/api/raw') {
      const node = this.nodes[url.searchParams.get('node')];
      const area = url.searchParams.get('area');
      const start = Number(url.searchParams.get('start') || 0);
      const count = Math.min(250, Number(url.searchParams.get('count') || 32));
      if (!node || !['co', 'di', 'hr', 'ir'].includes(area)) return this.fail(res, 400, 'bad node/area');
      try {
        const values = await node.client.readArea(area, start, count);
        return this.json(res, { ok: true, values });
      } catch (err) {
        return this.fail(res, 502, err.message);
      }
    }
    return this.serveStatic(p, res);
  }

  broadcastAlarms() {
    const data = `data: ${JSON.stringify({ type: 'delta', values: {}, alarms: this.alarms.list(), counts: this.alarms.counts(), events: this.pendingEvents || [] })}\n\n`;
    this.pendingEvents = [];
    for (const res of this.clients) res.write(data);
  }

  async serveStatic(p, res) {
    const rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR)) return this.fail(res, 403, 'forbidden');
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch {
      this.fail(res, 404, 'not found');
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const hmi = new HmiServer();
  hmi.start().catch((err) => {
    log.error(err);
    process.exit(1);
  });
  const shutdown = () => hmi.stop().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
