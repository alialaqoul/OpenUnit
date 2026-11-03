import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CONTROLLER_NAMES, loadNetworkConfig, plcNodes } from './common/config.js';

/**
 * Starts the complete simulator:
 *   PLANT  - process model + field I/O Modbus server
 *   CCS, BMS, CMB, FWC, STC, DEH, GEN, BOP - one process per controller
 *   HMI    - SCADA server + web HMI
 *
 *   node src/launcher.js            separate processes (default, realistic distributed DCS)
 *   node src/launcher.js --single   everything in one process (still communicating via Modbus TCP)
 *   node src/launcher.js --openplc  controllers as OpenPLC Runtime v3 soft-PLCs (see plc/README.md)
 *   SIM_IC=1 node src/launcher.js   start from another initial condition
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const single = process.argv.includes('--single');
if (process.argv.includes('--openplc')) process.env.SIM_RUNTIME = 'openplc';
const cfg = loadNetworkConfig();
const plcs = plcNodes();
const nodeControllers = CONTROLLER_NAMES.filter((n) => !plcs.includes(n));

function banner() {
  const url = `http://${cfg.hmi.host}:${cfg.hmi.port}`;
  const lines = [
    '',
    '  OpenUnit - 700 MW Gas-Fired Steam Power Plant Simulator',
    '  --------------------------------------------------------',
    `  HMI:        ${url}`,
    '  Modbus TCP: ' + Object.entries(cfg.nodes).map(([n, c]) => `${n}:${c.port}`).join('  '),
    ...(plcs.length
      ? [
          `  OpenPLC:    ${plcs.map((n) => `${n} ${cfg.openplc.nodes[n].ip}`).join('  ')}`,
          '              (OpenPLC Editor: open plc/projects/<NODE>, Debugger shows the logic live)',
        ]
      : []),
    '  Stop with Ctrl+C',
    '',
  ];
  console.log(lines.join('\n'));
}

async function runSingle() {
  const { PlantNode } = await import('./plant/index.js');
  const { createController } = await import('./controllers/index.js');
  const { HmiServer } = await import('./hmi/server.js');
  const plant = new PlantNode();
  await plant.start();
  const ctrls = nodeControllers.map(createController);
  for (const c of ctrls) await c.start();
  const opc = plcs.length ? await (await import('./openplc/index.js')).startOpenPlc() : null;
  const hmi = new HmiServer();
  await hmi.start();
  banner();
  const stop = async () => {
    await hmi.stop();
    if (opc) await opc.stop();
    for (const c of ctrls) await c.stop();
    await plant.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

function runMulti() {
  const procs = new Map();
  let stopping = false;
  const spawn = (name, script, args = []) => {
    const child = fork(path.join(here, script), args, { stdio: 'inherit', env: process.env });
    procs.set(name, child);
    child.on('exit', (code) => {
      procs.delete(name);
      if (stopping) return;
      console.error(`[launcher] ${name} exited with code ${code} - restarting in 2 s`);
      setTimeout(() => !stopping && spawn(name, script, args), 2000);
    });
  };
  spawn('PLANT', 'plant/index.js');
  setTimeout(() => {
    for (const c of nodeControllers) spawn(c, 'controllers/index.js', [c]);
    // The OpenPLC process leaves the runtimes running when it is restarted; the launcher stops them.
    if (plcs.length) spawn('OPENPLC', 'openplc/index.js', ['--keep-runtimes']);
    setTimeout(() => {
      spawn('HMI', 'hmi/server.js');
      setTimeout(banner, 800);
    }, 500);
  }, 400);
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    for (const p of procs.values()) p.kill('SIGTERM');
    if (plcs.length) {
      const { stopAllRuntimes } = await import('./openplc/host.js');
      console.log('[launcher] stopping OpenPLC runtimes ...');
      await stopAllRuntimes();
    }
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (single) runSingle();
else runMulti();
