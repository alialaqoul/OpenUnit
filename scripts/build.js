/**
 * "Build" for a dependency-free runtime: validates every register map, syntax-checks all
 * server and browser modules and regenerates the Modbus register documentation.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../src/common/config.js';
import { MAPS } from '../src/maps/index.js';
import { generate } from './generate-modbus-map.js';

const files = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
};
walk(path.join(ROOT_DIR, 'src'));
for (const f of files) execFileSync(process.execPath, ['--check', f]);
console.log(`Syntax OK: ${files.length} modules`);

let tags = 0;
for (const m of Object.values(MAPS)) tags += m.tags.size;
console.log(`Register maps OK: ${Object.keys(MAPS).length} nodes, ${tags} tags`);
console.log(`Documentation: ${generate()}`);
