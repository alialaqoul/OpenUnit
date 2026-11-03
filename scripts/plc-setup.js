/**
 * Builds OpenPLC Runtime v3 inside the WSL distribution openplc.wsl.distro and creates one runtime
 * instance per controller with the ports from openplc.nodes.
 *
 *   npm run plc:setup
 *
 * OpenUnit.cmd install runs this after it has created the distribution; it is safe to re-run.
 * Then: npm run plc:deploy (compile + download the programs) and npm run start:openplc.
 */
import { execFileSync } from 'node:child_process';
import { CONTROLLER_NAMES } from '../src/common/config.js';
import { runHostScript, instanceArgs, hostConfig, holdHost } from '../src/openplc/host.js';

process.env.SIM_RUNTIME = 'openplc';
const h = hostConfig();

let distros = '';
try {
  distros = execFileSync('wsl.exe', ['-l', '-q'], { encoding: 'utf16le' });
} catch {
  console.error('WSL is not available: run OpenUnit.cmd install (it checks and installs the prerequisites).');
  process.exit(1);
}
if (!distros.split(/\r?\n/).map((s) => s.trim()).includes(h.distro)) {
  console.error(`WSL distribution "${h.distro}" not found: run OpenUnit.cmd install to create it.`);
  process.exit(1);
}

const keep = holdHost();
console.log(`[1/2] OpenPLC Runtime v3 in WSL "${h.distro}" (${h.home})`);
let r = await runHostScript('install-openplc.sh', [], { timeoutMs: 3600000 });
if (r.code !== 0) process.exit(1);

console.log('[2/2] Runtime instances');
for (const n of CONTROLLER_NAMES) {
  r = await runHostScript('setup-instance.sh', instanceArgs(n));
  if (r.code !== 0) process.exit(1);
}
keep.kill();
console.log('\nDone. Next: npm run plc:deploy   (compile and download the PLC programs)');
