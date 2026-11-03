import { TagMap } from '../common/tags.js';
import { commonTags, peerBlock } from './common.js';

export const CMB_PEERS = { read: ['BMS'], write: [] };

export function buildCmbMap(opts = {}) {
  const m = new TagMap('CMB', 'Combustion & Draft Control', opts);
  commonTags(m, ['BMS', 'CCS']);
  for (const p of ['A', 'B']) m.motor(`APH_${p}`, { desc: `Air preheater ${p}`, group: 'Air heaters' });
  for (const p of ['A', 'B']) m.motor(`ID_${p}`, { desc: `ID fan ${p}`, group: 'Draft' });
  for (const p of ['A', 'B']) m.motor(`FD_${p}`, { desc: `FD fan ${p}`, group: 'Draft' });

  m.pid('FIC_GAS', {
    desc: 'Fuel master (natural gas flow -> gas control valve)',
    pvUnits: 't/h',
    pvMin: 0,
    pvMax: 180,
    kp: 0.5,
    ti: 6,
    cas: true,
    group: 'Fuel',
  });
  m.pid('FIC_AIR', {
    desc: 'Total air flow (FD master)',
    pvUnits: 't/h',
    pvMin: 0,
    pvMax: 3200,
    kp: 0.35,
    ti: 6,
    cas: true,
    dp: 0,
    group: 'Air',
  });
  m.station('SC_FDA', { desc: 'FD fan A blade pitch', group: 'Air' });
  m.station('SC_FDB', { desc: 'FD fan B blade pitch', group: 'Air' });
  m.pid('AIC_O2', {
    desc: 'O2 trim',
    pvUnits: '%',
    pvMin: 0,
    pvMax: 10,
    sp: 2.0,
    outUnits: '%',
    outMin: 80,
    outMax: 120,
    out: 100,
    kp: 0.8,
    ti: 150,
    dp: 2,
    group: 'Air',
  });
  m.pid('PIC_FURN', {
    desc: 'Furnace pressure (ID master)',
    pvUnits: 'mbar',
    pvMin: -15,
    pvMax: 15,
    sp: -1.0,
    kp: 1.0,
    ti: 5,
    dp: 2,
    group: 'Draft',
  });
  m.station('SC_IDA', { desc: 'ID fan A inlet vane', group: 'Draft' });
  m.station('SC_IDB', { desc: 'ID fan B inlet vane', group: 'Draft' });

  m.hr('PURGE_AIR', 't/h', 'Minimum (purge) air flow', { init: 816, dp: 0 }); // 36 % of MCR air
  m.hr('O2_BIAS', '%', 'O2 setpoint operator bias', { init: 0, dp: 2 });
  m.hr('LIGHTOFF_POS', '%', 'Gas control valve light-off position', { init: 6, dp: 1 });
  m.hr('MIN_FIRE_POS', '%', 'Gas control valve minimum-fire position', { init: 4, dp: 1 });
  m.ir('BLR_DMD', '%', 'Boiler demand in use');
  m.ir('GAS_DMD', 't/h', 'Gas flow demand (cross-limited)');
  m.ir('GAS_CAPACITY', 't/h', 'Gas flow capacity of elevations in service');
  m.ir('AIR_DMD', 't/h', 'Air flow demand (cross-limited)', { dp: 0 });
  m.ir('FUEL_HEAT_EST', 'MW', 'Estimated firing rate', { dp: 0 });
  m.ir('FURN_PRESS_SEL', 'mbar', 'Furnace pressure (median of 3)', { dp: 2, alarm: { h: 5, hh: 15, l: -7, ll: -18, pri: 1 } });
  m.ir('O2_SP_PROG', '%', 'O2 setpoint program', { dp: 2 });
  m.di('FM_AUTO', 'Fuel master in automatic (CAS)');
  m.di('AIR_AUTO', 'Air flow control in automatic');
  m.di('FURN_AUTO', 'Furnace pressure control in automatic');
  m.di('CROSS_LIMIT', 'Air/fuel cross limit active', { alarm: { on: true, pri: 3, text: 'Air/fuel cross-limiting active' } });
  m.di('RB_FAN', 'Fan runback request', { alarm: { on: true, pri: 1, text: 'RUNBACK - loss of ID/FD fan' } });
  peerBlock(m, 'CCS', () => {
    m.hr('BLR_DMD_REM', '%', 'Boiler demand from CCS boiler master');
    m.hr('CCS_BM_AUTO', '', 'CCS boiler master in auto', { type: 'u16' });
  });
  return m;
}
