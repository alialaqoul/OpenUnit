import { TagMap } from '../common/tags.js';
import { commonTags } from './common.js';
import { ELEVS } from './plant.js';

export const BMS_PEERS = { read: ['DEH'], write: [] };

export const MFT_CAUSES = [
  'NONE',
  'MANUAL MFT PUSHBUTTON',
  'BOTH ID FANS OFF',
  'BOTH FD FANS OFF',
  'AIR FLOW < 25 %',
  'FURNACE PRESSURE HIGH-HIGH',
  'FURNACE PRESSURE LOW-LOW',
  'DRUM LEVEL HIGH-HIGH',
  'DRUM LEVEL LOW-LOW',
  'LOSS OF ALL FLAME',
  'LOSS OF ALL FUEL',
  'TURBINE TRIP WITH FIRING > BYPASS CAPACITY',
  'ALL BOILER FEED PUMPS OFF',
  'LIGHT-OFF TIME EXPIRED',
  'BMS WATCHDOG / FIELD I/O FAILURE',
  'INITIAL / POWER-UP',
  'GAS HEADER PRESSURE LOW-LOW',
  'GAS HEADER PRESSURE HIGH-HIGH',
  'GAS SUPPLY PRESSURE LOW',
];

export const GAS_TRAIN_STATES = ['CLOSED', 'OPENING', 'OPEN', 'TRIPPED'];

export const SEQ_STATES = ['OFF', 'STARTING', 'IN SERVICE', 'STOPPING', 'FLAME FAIL'];

export function buildBmsMap(opts = {}) {
  const m = new TagMap('BMS', 'Burner Management System', opts);
  commonTags(m, ['DEH']);
  m.co('MFT_PB', 'Manual MFT pushbutton', { pulse: true });
  m.co('PURGE_START', 'Start furnace purge', { pulse: true });
  m.co('MFT_RESET', 'MFT reset', { pulse: true });
  m.di('MFT', 'Master fuel trip active', { alarm: { on: true, pri: 1, text: 'MASTER FUEL TRIP' } });
  m.ir('MFT_CAUSE', '', 'MFT first-out cause', { type: 'u16', enum: MFT_CAUSES });
  m.di('PURGE_READY', 'Purge permissives satisfied');
  m.di('PURGE_ACTIVE', 'Purge in progress');
  m.di('PURGE_COMPLETE', 'Purge complete');
  m.ir('PURGE_REMAIN', 's', 'Purge time remaining', { dp: 0 });
  m.ir('LIGHTOFF_REMAIN', 's', 'Light-off time remaining', { dp: 0 });
  for (const [t, d] of [
    ['PP_FANS', 'Purge perm: ID and FD fan running'],
    ['PP_AIR', 'Purge perm: air flow 25 - 40 %'],
    ['PP_FUEL_OFF', 'Purge perm: gas trip valves & burner valves closed'],
    ['PP_FURN', 'Purge perm: furnace pressure normal'],
    ['PP_DRUM', 'Purge perm: drum level normal'],
    ['PP_NO_TRIP', 'Purge perm: no MFT condition present'],
  ]) m.di(t, d);
  m.di('FUEL_IN_SERVICE', 'Fuel in service');
  m.ir('ELEV_INSERV', '', 'Burner elevations in service', { type: 'u16' });
  m.ir('FIREBALL', '%', 'Flame intensity (fireball scanner)', { dp: 0 });
  m.co('GAS_TRAIN.OPEN', 'Open main gas trip valves', { pulse: true });
  m.co('GAS_TRAIN.CLOSE', 'Close main gas trip valves', { pulse: true });
  m.ir('GAS_TRAIN.STATE', '', 'Gas fuel train state', { type: 'u16', enum: GAS_TRAIN_STATES });
  m.di('GAS_TRAIN.PERM', 'Gas train open permissive');
  m.di('GAS_TRAIN.OPENED', 'Gas train open (SSVs open, vent closed)');

  for (const x of ELEVS) {
    m.co(`ELEV_${x}.START`, `Burner elevation ${x} light-off sequence`, { pulse: true });
    m.co(`ELEV_${x}.STOP`, `Burner elevation ${x} shut-down sequence`, { pulse: true });
    m.ir(`ELEV_${x}.STATE`, '', `Burner elevation ${x} state`, { type: 'u16', enum: SEQ_STATES });
    m.di(`ELEV_${x}.PERM`, `Burner elevation ${x} light-off permissive`);
    m.di(`ELEV_${x}.INSERV`, `Burner elevation ${x} in service`);
    m.di(`ELEV_${x}.FAIL`, `Burner elevation ${x} flame failure`, { alarm: { on: true, pri: 2, text: `Burner elevation ${x} flame failure / trip` } });
  }
  return m;
}
