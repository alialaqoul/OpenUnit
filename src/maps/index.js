import { PLANT_MAP } from './plant.js';
import { buildCcsMap, CCS_PEERS } from './ccs.js';
import { buildBmsMap, BMS_PEERS } from './bms.js';
import { buildCmbMap, CMB_PEERS } from './cmb.js';
import { buildFwcMap, FWC_PEERS } from './fwc.js';
import { buildStcMap, STC_PEERS } from './stc.js';
import { buildDehMap, DEH_PEERS } from './deh.js';
import { buildGenMap, GEN_PEERS } from './gen.js';
import { buildBopMap, BOP_PEERS } from './bop.js';
import { addPlcImage, readPlcSource } from './plcImage.js';
import { plcNodes, PLC_DIR } from '../common/config.js';

const BUILDERS = {
  CCS: buildCcsMap,
  BMS: buildBmsMap,
  CMB: buildCmbMap,
  FWC: buildFwcMap,
  STC: buildStcMap,
  DEH: buildDehMap,
  GEN: buildGenMap,
  BOP: buildBopMap,
};

/** Peer-to-peer data exchange: which controllers each controller reads from / writes to. */
export const PEERS = {
  CCS: CCS_PEERS,
  BMS: BMS_PEERS,
  CMB: CMB_PEERS,
  FWC: FWC_PEERS,
  STC: STC_PEERS,
  DEH: DEH_PEERS,
  GEN: GEN_PEERS,
  BOP: BOP_PEERS,
};

/**
 * Builds the register maps of every node. Controllers listed in `openplc` get the OpenPLC
 * Runtime register model plus their I/O image (see plcImage.js); the others and the plant keep
 * the native layout.
 */
export function buildMaps(openplc = [], { plcDir = PLC_DIR } = {}) {
  const maps = { PLANT: PLANT_MAP };
  for (const [n, build] of Object.entries(BUILDERS)) maps[n] = build({ layout: openplc.includes(n) ? 'openplc' : 'native' });
  for (const n of openplc) addPlcImage(maps[n], n, { maps, peers: PEERS[n], source: readPlcSource(plcDir, n) });
  return maps;
}

export const MAPS = buildMaps(plcNodes());
