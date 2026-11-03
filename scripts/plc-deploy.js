/**
 * Compiles the OpenPLC projects and downloads them into the soft-PLC runtimes with OpenPLC
 * Editor's own command line (openplc-cli), so the runtimes hold exactly what the Editor
 * debugger expects (same program, same MD5).
 *
 *   npm run plc:deploy [-- NODE ...]
 *
 * Needs OpenPLC Editor 4.x installed (it installs openplc-cli on first launch) and the runtimes
 * set up with `npm run plc:setup`. Works with the simulator running: the I/O bridge notices the
 * restarted PLC and restores its operator settings.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CONTROLLER_NAMES, loadNetworkConfig, PLC_DIR, ROOT_DIR } from '../src/common/config.js';
import { LoopbackRelay } from '../src/openplc/relay.js';
import { runHostScript, holdHost } from '../src/openplc/host.js';
import { editorEnv, findCli, runCli } from '../src/openplc/editor.js';

process.env.SIM_RUNTIME = 'openplc';
const cfg = loadNetworkConfig().openplc;
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const nodes = args.length ? args.map((s) => s.toUpperCase()) : CONTROLLER_NAMES.filter((n) => existsSync(path.join(PLC_DIR, 'src', `${n}.st`)));
const PARALLEL = 4;

function run(cmd, argv, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { env, windowsHide: true, shell: false });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, out, err }));
    child.on('error', (e) => resolve({ code: -1, out, err: e.message }));
  });
}

const cli = findCli();
if (!cli) {
  console.error('openplc-cli not found. Install OpenPLC Editor 4.x and launch it once (it installs the CLI),');
  console.error('or set OPENPLC_CLI to the path of openplc-cli(.cmd).');
  process.exit(1);
}

console.log(`Building projects: ${nodes.join(', ')}`);
const b = await run(process.execPath, [path.join(ROOT_DIR, 'scripts', 'plc-build.js'), ...nodes], process.env);
process.stdout.write(b.out);
if (b.code !== 0) {
  console.error(b.err);
  process.exit(1);
}

const keepAlive = holdHost(); // WSL would stop the runtimes as soon as no client is attached
for (const n of nodes) {
  const r = await runHostScript('instance.sh', ['start', n], { quiet: true, timeoutMs: 60000 });
  console.log(r.out.trim().split('\n').pop());
  if (r.code !== 0) {
    console.error(`${n}: the OpenPLC runtime does not start - run  npm run plc:setup  (or OpenUnit.cmd install) to repair it`);
    process.exit(1);
  }
}
const relay = new LoopbackRelay(
  nodes.flatMap((n) => [
    { name: `${n} debugger`, listenHost: cfg.nodes[n].ip, listenPort: 502, targetHost: '127.0.0.1', targetPort: cfg.nodes[n].modbusPort },
    { name: `${n} runtime API`, listenHost: cfg.nodes[n].ip, listenPort: 8443, targetHost: '127.0.0.1', targetPort: cfg.nodes[n].apiPort },
  ]),
);
await relay.start(); // routes already served by a running simulator are reported and skipped

/** A freshly started runtime takes several seconds before its REST API answers. */
function waitForPort(port, timeoutMs) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const attempt = () => {
      const sock = net.connect({ host: '127.0.0.1', port }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() - t0 > timeoutMs) resolve(false);
        else setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}
const waits = await Promise.all(nodes.map((n) => waitForPort(cfg.nodes[n].apiPort, 120000)));
nodes.forEach((n, i) => {
  if (!waits[i]) console.log(`${n}: runtime REST API not answering on port ${cfg.nodes[n].apiPort}`);
});

const env = editorEnv({ OPENPLC_CREDENTIALS: `${cfg.user}:${cfg.password}` });

const results = {};
const queue = [...nodes];
async function worker() {
  while (queue.length) {
    const n = queue.shift();
    const project = path.join(PLC_DIR, 'projects', n);
    const t0 = Date.now();
    console.log(`${n}: uploading to ${cfg.nodes[n].ip} ...`);
    const r = await runCli(cli, ['upload', project, '--target', 'OpenPLC Runtime v3', '--host', cfg.nodes[n].ip, '--create-user', '--yes', '--json'], env);
    const res = r.json;
    const ok = r.code === 0 && res?.ok && res.uploaded;
    results[n] = ok;
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    if (ok) console.log(`${n}: running new program (${secs} s)`);
    else {
      console.log(`${n}: FAILED (exit ${r.code}) ${res?.error?.message || ''}`);
      const tail = `${r.err}`.split('\n').filter((l) => /error|Error|failed/.test(l)).slice(-15).join('\n');
      if (tail) console.log(tail);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(PARALLEL, nodes.length) }, worker));
await relay.stop();
keepAlive.kill();
const failed = Object.entries(results).filter(([, ok]) => !ok).map(([n]) => n);
console.log(failed.length ? `\nFailed: ${failed.join(', ')}` : '\nAll PLC programs deployed.');
process.exit(failed.length ? 1 : 0);
