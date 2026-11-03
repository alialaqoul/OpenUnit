/**
 * Status and run/stop control of the OpenPLC soft-PLCs through their runtime REST API.
 *
 *   node scripts/plc-control.js status            every PLC: runtime, program state, Modbus server
 *   node scripts/plc-control.js run   <NODE|all>  start the PLC program
 *   node scripts/plc-control.js stop  <NODE|all>  stop the PLC program (outputs freeze, peers see it as lost)
 *   node scripts/plc-control.js restart <NODE|all> stop + start (memory cleared; the I/O bridge restores the
 *                                                  operator settings if the simulator is running)
 *
 * Stopping BMS or DEH while the plant runs trips the unit through the hardwired watchdog.
 */
import https from 'node:https';
import net from 'node:net';
import { CONTROLLER_NAMES, loadNetworkConfig } from '../src/common/config.js';

process.env.SIM_RUNTIME = 'openplc';
const cfg = loadNetworkConfig().openplc;
const [cmd = 'status', target = 'all'] = process.argv.slice(2);
const nodes = target.toLowerCase() === 'all' ? CONTROLLER_NAMES : target.split(',').map((s) => s.trim().toUpperCase());
for (const n of nodes) {
  if (!cfg.nodes[n]) {
    console.error(`Unknown controller ${n}. Valid: ${CONTROLLER_NAMES.join(', ')}`);
    process.exit(2);
  }
}

function request(port, method, path, { token, body } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        rejectUnauthorized: false, // the runtime uses a self-signed certificate
        timeout: 5000,
        headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(text) });
          } catch {
            resolve({ status: res.statusCode, json: null });
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve({ status: 0, error: err.message }));
    if (data) req.write(data);
    req.end();
  });
}

const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => {
      s.destroy();
      resolve(true);
    });
    s.on('error', () => resolve(false));
    s.setTimeout(1500, () => {
      s.destroy();
      resolve(false);
    });
  });

async function login(n) {
  const r = await request(cfg.nodes[n].apiPort, 'POST', '/api/login', { body: { username: cfg.user, password: cfg.password } });
  return r.json?.access_token ?? null;
}

async function state(n) {
  const p = cfg.nodes[n];
  const token = await login(n);
  if (!token) return { runtime: 'not running', plc: '-', modbus: (await portOpen(p.modbusPort)) ? 'up' : 'down' };
  const s = await request(p.apiPort, 'GET', '/api/status', { token });
  const plc = { 'STATUS:RUNNING': 'RUN', 'STATUS:STOPPED': 'STOP', 'STATUS:EMPTY': 'COMPILING' }[s.json?.status] ?? (s.json?.status || '?');
  return { runtime: 'running', plc, modbus: (await portOpen(p.modbusPort)) ? 'up' : 'down' };
}

async function control(n, what) {
  const p = cfg.nodes[n];
  const token = await login(n);
  if (!token) return `${n}: runtime not running (start the simulator with OpenPLC first)`;
  const r = await request(p.apiPort, 'GET', `/api/${what}`, { token });
  return `${n}: ${r.json?.status ?? r.error ?? `HTTP ${r.status}`}`;
}

if (cmd === 'status') {
  console.log('PLC   Editor IP     Runtime       PLC        Modbus        Web page');
  for (const n of nodes) {
    const p = cfg.nodes[n];
    const s = await state(n);
    console.log(`${n.padEnd(5)} ${p.ip.padEnd(13)} ${s.runtime.padEnd(13)} ${s.plc.padEnd(10)} ${`${s.modbus} :${p.modbusPort}`.padEnd(13)} http://localhost:${p.webPort}`);
  }
} else if (cmd === 'run' || cmd === 'start') {
  for (const n of nodes) console.log(await control(n, 'start-plc'));
} else if (cmd === 'stop') {
  for (const n of nodes) console.log(await control(n, 'stop-plc'));
} else if (cmd === 'restart') {
  for (const n of nodes) {
    console.log(await control(n, 'stop-plc'));
    console.log(await control(n, 'start-plc'));
  }
} else {
  console.error('usage: node scripts/plc-control.js status | run|stop|restart <NODE|all>');
  process.exit(2);
}
