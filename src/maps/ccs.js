import { TagMap } from '../common/tags.js';
import { commonTags } from './common.js';

export const CCS_PEERS = { read: ['DEH', 'CMB', 'FWC', 'BMS'], write: ['CMB', 'DEH', 'STC'] };
export const CCS_MODES = ['BASE (MANUAL)', 'BOILER FOLLOW', 'TURBINE FOLLOW', 'COORDINATED'];

export function buildCcsMap(opts = {}) {
  const m = new TagMap('CCS', 'Unit Coordinated Control', opts);
  commonTags(m, ['DEH', 'CMB', 'FWC', 'BMS', 'STC']);
  m.hr('MODE_REQ', '', 'Requested unit control mode', { type: 'u16', init: 0, enum: CCS_MODES });
  m.hr('ULD_TARGET', 'MW', 'Unit load target', { init: 700, dp: 0 });
  m.hr('ULD_RATE', 'MW/min', 'Unit loading rate', { init: 14, dp: 1 });
  m.hr('MAX_LOAD', 'MW', 'Maximum load limit', { init: 710, dp: 0 });
  m.hr('MIN_LOAD', 'MW', 'Minimum load limit', { init: 210, dp: 0 });
  m.hr('PRESS_MODE', '', 'Pressure mode', { type: 'u16', init: 1, enum: ['FIXED', 'SLIDING'] });
  m.hr('PRESS_FIXED', 'bar', 'Fixed throttle pressure setpoint', { init: 167, dp: 1 });
  m.hr('PRESS_RATE', 'bar/min', 'Pressure setpoint rate', { init: 4, dp: 1 });
  m.hr('FREQ_BIAS', '', 'Frequency bias on unit load', { type: 'u16', init: 1, enum: ['OFF', 'ON'] });
  m.co('GO', 'Unit load ramp GO', { pulse: true });
  m.co('HOLD', 'Unit load ramp HOLD', { pulse: true });

  m.pid('PIC_TP', {
    desc: 'Boiler master (throttle pressure)',
    pvUnits: 'bar',
    pvMin: 0,
    pvMax: 200,
    sp: 167,
    outMin: 0,
    outMax: 110,
    kp: 3.5,
    ti: 500,
    td: 20,
    dp: 1,
    group: 'Boiler master',
  });

  m.ir('MODE_ACT', '', 'Active unit control mode', { type: 'u16', enum: CCS_MODES });
  m.ir('ULD_ACT', 'MW', 'Unit load demand (ramped)', { dp: 1 });
  m.ir('ULD_FREQ', 'MW', 'Unit load demand incl. frequency bias', { dp: 1 });
  m.ir('PRESS_SP', 'bar', 'Throttle pressure setpoint (active)', { dp: 1 });
  m.ir('PRESS_DEV', 'bar', 'Throttle pressure deviation', { dp: 1, alarm: { h: 10, l: -10, pri: 2 } });
  m.ir('BLR_DMD', '%', 'Boiler demand', { dp: 1 });
  m.ir('CAPACITY', 'MW', 'Available unit capacity', { dp: 0 });
  m.ir('RB_TARGET', 'MW', 'Runback target', { dp: 0 });
  m.di('RB_ACTIVE', 'Runback in progress', { alarm: { on: true, pri: 1, text: 'UNIT RUNBACK IN PROGRESS' } });
  m.di('RAMPING', 'Load ramp in progress');
  m.di('BLOCK_INC', 'Load increase blocked');
  m.di('BLOCK_DEC', 'Load decrease blocked');
  m.di('CC_PERM', 'Coordinated control permissive');
  m.di('BF_PERM', 'Boiler follow permissive');
  m.di('TF_PERM', 'Turbine follow permissive');
  m.di('MODE_DROPPED', 'Control mode degraded automatically', { alarm: { on: true, pri: 2, text: 'CCS mode degraded - check permissives' } });
  return m;
}
