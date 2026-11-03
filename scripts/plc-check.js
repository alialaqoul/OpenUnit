/**
 * Checks the PLC programs without downloading anything:
 *   1. the controller logic (ST) with the MatIEC compiler of OpenPLC Runtime v3 (on the OpenPLC host);
 *   2. the generated function block diagrams with OpenPLC Editor's own compile (transpile to ST and
 *      check it), when the projects are FBD (openplc.language, default "fbd").
 *
 *   npm run plc:check [-- NODE ...]
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { CONTROLLER_NAMES, loadNetworkConfig, PLC_DIR, ROOT_DIR } from '../src/common/config.js';
import { runHostScript, toHostPath, holdHost } from '../src/openplc/host.js';
import { findCli, runCli } from '../src/openplc/editor.js';

process.env.SIM_RUNTIME = 'openplc';
const cfg = loadNetworkConfig().openplc;
const args = process.argv.slice(2).map((s) => s.toUpperCase());
const nodes = args.length ? args : CONTROLLER_NAMES.filter((n) => existsSync(path.join(PLC_DIR, 'src', `${n}.st`)));
const build = (extra) => spawnSync(process.execPath, [path.join(ROOT_DIR, 'scripts', 'plc-build.js'), ...extra, ...nodes], { encoding: 'utf8' });

let failed = 0;
console.log('[1/2] Controller logic (ST) with MatIEC');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'plc-check-'));
let b = build(['--st', `--out=${tmp}`]);
if (b.status !== 0) {
  process.stderr.write(b.stderr);
  process.exit(1);
}
const keep = holdHost();
for (const n of nodes) {
  const r = await runHostScript('check-st.sh', [toHostPath(path.join(tmp, n)), cfg.cycleMs], { timeoutMs: 120000 });
  if (r.code !== 0) failed++;
}
keep.kill();
rmSync(tmp, { recursive: true, force: true });

if ((cfg.language ?? 'fbd') === 'fbd') {
  console.log('[2/2] Function block diagrams with OpenPLC Editor');
  const cli = findCli();
  if (!cli) {
    console.log('  openplc-cli not found (install OpenPLC Editor 4.x and start it once) - skipped');
  } else {
    b = build([]);
    process.stdout.write(b.stdout);
    if (b.status !== 0) {
      process.stderr.write(b.stderr);
      process.exit(1);
    }
    for (const n of nodes) {
      const r = await runCli(cli, ['compile', path.join(PLC_DIR, 'projects', n), '--target', 'OpenPLC Runtime v3', '--json']);
      if (r.code === 0 && r.json?.ok) console.log(`${n}: diagram OK`);
      else {
        failed++;
        console.log(`${n}: diagram FAILED (exit ${r.code}) ${r.json?.error?.message ?? ''}`);
        const tail = r.err.split('\n').filter((l) => /error/i.test(l)).slice(-15).join('\n');
        if (tail) console.log(tail);
      }
    }
  }
}
process.exit(failed ? 1 : 0);
