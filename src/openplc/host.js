import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT_DIR, loadNetworkConfig } from '../common/config.js';

/**
 * The OpenPLC runtimes live in a dedicated WSL distribution (config openplc.wsl, created by
 * OpenUnit.cmd install). The scripts/openplc/*.sh helpers run there as root.
 */
export function hostConfig() {
  const w = loadNetworkConfig().openplc.wsl;
  return { distro: w.distro, home: w.home, instances: w.instances };
}

/** Windows path -> path inside WSL (C:\a\b -> /mnt/c/a/b). */
export function toHostPath(p) {
  const unix = path.resolve(p).split(path.win32.sep).join('/');
  const m = /^([A-Za-z]):(\/.*)$/.exec(unix);
  return m ? `/mnt/${m[1].toLowerCase()}${m[2]}` : unix;
}

/** Spawns one of the scripts/openplc helpers in WSL (arguments as separate argv entries, no shell quoting). */
export function spawnHostScript(script, args = []) {
  const h = hostConfig();
  const file = toHostPath(path.join(ROOT_DIR, 'scripts', 'openplc', script));
  const env = { ...process.env, OPENPLC_HOME: h.home, OPENPLC_INSTANCES: h.instances, WSLENV: 'OPENPLC_HOME/u:OPENPLC_INSTANCES/u' };
  return spawn('wsl.exe', ['-d', h.distro, '-u', 'root', '--', 'bash', file, ...args.map(String)], { env, windowsHide: true });
}

/** Runs a helper script to completion. Resolves { code, out }. */
export function runHostScript(script, args = [], { quiet = false, timeoutMs = 0 } = {}) {
  return new Promise((resolve) => {
    const child = spawnHostScript(script, args);
    let out = '';
    const onData = (d) => {
      out += d;
      if (!quiet) process.stdout.write(d);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = timeoutMs ? setTimeout(() => child.kill(), timeoutMs) : null;
    child.on('error', (err) => resolve({ code: -1, out: `${out}${err.message}` }));
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

/** Instance ports of a controller, as setup-instance.sh expects them. */
export function instanceArgs(node) {
  const p = loadNetworkConfig().openplc.nodes[node];
  return [node, p.modbusPort, p.webPort, p.apiPort, p.controlPort];
}

/**
 * Starts scripts/openplc/supervise.sh for the given controllers: it starts the runtimes,
 * restarts one that crashes and, by staying attached, keeps the WSL distribution alive. Resolves once the
 * instances are started; the runtimes are stopped with stopAllRuntimes().
 */
export function superviseRuntimes(nodes, { onLine = () => {} } = {}) {
  const child = spawnHostScript('supervise.sh', nodes);
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line === 'SUPERVISOR READY') resolve({ child });
        else if (line) onLine(line);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('close', (code) => reject(new Error(`OpenPLC supervisor exited (${code})`)));
  });
}

/** Stops the supervisor and every runtime instance. */
export function stopAllRuntimes() {
  return runHostScript('instance.sh', ['stopall'], { quiet: true, timeoutMs: 60000 });
}

/** WSL stops a distribution when no client is attached: hold it open while working. */
export function holdHost() {
  const h = hostConfig();
  return spawn('wsl.exe', ['-d', h.distro, '-u', 'root', '--', 'sleep', '3600'], { windowsHide: true, stdio: 'ignore' });
}
