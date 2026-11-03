/**
 * Opens OpenPLC Editor with the 8 controller projects on its start screen (recent projects), so a
 * click opens a controller's function block diagram. Builds the projects first if they are missing.
 *
 *   npm run plc:editor
 *
 * In the Editor: open a project, then Debugger -> connect to the runtime IP of the controller
 * (127.0.0.11 ... .18, user/password from openplc.user / openplc.password) to see the logic live.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CONTROLLER_NAMES, PLC_DIR, ROOT_DIR } from '../src/common/config.js';
import { addRecentProjects, editorEnv, findEditor } from '../src/openplc/editor.js';

process.env.SIM_RUNTIME = 'openplc';
const exe = findEditor();
if (!exe) {
  console.error('OpenPLC Editor is not installed - run OpenUnit.cmd install');
  process.exit(1);
}
const nodes = CONTROLLER_NAMES.filter((n) => existsSync(path.join(PLC_DIR, 'src', `${n}.st`)));
const missing = nodes.filter((n) => !existsSync(path.join(PLC_DIR, 'projects', n, 'project.json')));
if (missing.length) {
  const b = spawnSync(process.execPath, [path.join(ROOT_DIR, 'scripts', 'plc-build.js'), ...missing], { stdio: 'inherit' });
  if (b.status !== 0) process.exit(1);
}
const projects = nodes.map((n) => {
  const dir = path.join(PLC_DIR, 'projects', n);
  const name = JSON.parse(readFileSync(path.join(dir, 'project.json'), 'utf8')).meta?.name ?? n;
  return { dir, name };
});
addRecentProjects(projects);
// Electron attaches to the parent console on Windows even with stdio ignored, so the Editor's own
// log (e.g. its update check failing with 404 for v4.3.2) would land in the OpenUnit menu window.
spawn(exe, [], { env: editorEnv({ ELECTRON_NO_ATTACH_CONSOLE: '1' }), detached: true, stdio: 'ignore', windowsHide: false }).unref();
console.log('OpenPLC Editor started. Its start screen lists the controller projects:');
for (const p of projects) console.log(`  ${p.name}`);
