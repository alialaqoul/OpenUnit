import { pathToFileURL } from 'node:url';
import { CcsController } from './ccs.js';
import { BmsController } from './bms.js';
import { CmbController } from './cmb.js';
import { FwcController } from './fwc.js';
import { StcController } from './stc.js';
import { DehController } from './deh.js';
import { GenController } from './gen.js';
import { BopController } from './bop.js';

export const CONTROLLER_CLASSES = {
  CCS: CcsController,
  BMS: BmsController,
  CMB: CmbController,
  FWC: FwcController,
  STC: StcController,
  DEH: DehController,
  GEN: GenController,
  BOP: BopController,
};

export function createController(name) {
  const Cls = CONTROLLER_CLASSES[name];
  if (!Cls) throw new Error(`Unknown controller ${name}. Valid: ${Object.keys(CONTROLLER_CLASSES).join(', ')}`);
  return new Cls();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const names = process.argv.slice(2).map((n) => n.toUpperCase());
  if (!names.length) {
    console.error('Usage: node src/controllers/index.js <CCS|BMS|CMB|FWC|STC|DEH|GEN|BOP> [...]');
    process.exit(1);
  }
  const ctrls = names.map(createController);
  Promise.all(ctrls.map((c) => c.start())).catch((err) => {
    console.error(err);
    process.exit(1);
  });
  const shutdown = () => Promise.all(ctrls.map((c) => c.stop())).then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
