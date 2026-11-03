import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { IC_DIR } from './config.js';

/** File based storage of initial conditions / snapshots: config/ic/ic<slot>.<node>.json */
export function icFile(slot, node) {
  return path.join(IC_DIR, `ic${slot}.${node}.json`);
}

export function saveIC(slot, node, data) {
  mkdirSync(IC_DIR, { recursive: true });
  writeFileSync(icFile(slot, node), JSON.stringify(data));
}

export function loadIC(slot, node) {
  const file = icFile(slot, node);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function listSnapshots() {
  if (!existsSync(IC_DIR)) return [];
  const out = [];
  for (const f of readdirSync(IC_DIR)) {
    const m = /^ic(\d+)\.meta\.json$/.exec(f);
    if (!m) continue;
    try {
      out.push({ id: Number(m[1]), ...JSON.parse(readFileSync(path.join(IC_DIR, f), 'utf8')) });
    } catch {
      /* ignore broken meta files */
    }
  }
  return out.sort((a, b) => a.id - b.id);
}
