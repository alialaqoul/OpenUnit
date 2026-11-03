import { TagMap } from '../common/tags.js';
import { commonTags, peerBlock } from './common.js';

export const DEH_PEERS = { read: ['BMS', 'GEN'], write: [] };

export const TURB_TRIP_CAUSES = [
  'NONE',
  'MANUAL TRIP',
  'ELECTRICAL OVERSPEED (110 % / 3960 rpm)',
  'MECHANICAL OVERSPEED',
  'LOW CONDENSER VACUUM',
  'LOW LUBE OIL PRESSURE',
  'HIGH SHAFT VIBRATION',
  'HIGH AXIAL DISPLACEMENT',
  'HIGH HP EXHAUST TEMPERATURE',
  'BOILER MFT',
  'GENERATOR PROTECTION (86G)',
  'HIGH BEARING TEMPERATURE',
  'DEH WATCHDOG / FIELD I/O FAILURE',
  'INITIAL / POWER-UP',
];

export const DEH_MODES = ['TRIPPED', 'SPEED CONTROL', 'LOAD CONTROL', 'REMOTE (CCS)', 'PRESSURE CONTROL (TF)'];
export const START_CLASS = ['COLD', 'WARM', 'HOT', 'VERY HOT'];

export function buildDehMap(opts = {}) {
  const m = new TagMap('DEH', 'Turbine Control & Protection (DEH)', opts);
  commonTags(m, ['BMS', 'GEN', 'CCS']);
  m.co('RESET', 'Turbine reset / latch', { pulse: true });
  m.co('TRIP_PB', 'Manual turbine trip', { pulse: true });
  m.co('GO', 'Speed / load ramp GO', { pulse: true });
  m.co('HOLD', 'Speed / load ramp HOLD', { pulse: true });
  m.hr('SPD_TARGET', 'rpm', 'Speed target', { init: 0, dp: 0 });
  m.hr('SPD_RATE', 'rpm/min', 'Acceleration rate', { init: 150, dp: 0 });
  m.hr('LOAD_TARGET', 'MW', 'Load target (local)', { init: 35, dp: 0 });
  m.hr('LOAD_RATE', 'MW/min', 'Loading rate (local)', { init: 14, dp: 1 });
  m.hr('VPL', '%', 'Valve position limit', { init: 100 });
  m.hr('FREQ_ON', '', 'Primary frequency response', { type: 'u16', init: 1, enum: ['OFF', 'ON'] });
  m.hr('DROOP', '%', 'Speed droop', { init: 5 });
  m.hr('MODE_SEL', '', 'Operator mode selection', { type: 'u16', init: 0, enum: ['LOCAL', 'REMOTE (CCS)'] });
  m.hr('TPL_SP', 'bar', 'Throttle pressure limiter', { init: 60, dp: 0 });

  m.pid('SPD_CTRL', { desc: 'Turbine speed control', pvUnits: 'rpm', pvMin: 0, pvMax: 4320, kp: 3, ti: 8, dp: 0, group: 'Governor' });
  m.pid('LOAD_CTRL', { desc: 'Turbine load control', pvUnits: 'MW', pvMin: 0, pvMax: 800, kp: 1.0, ti: 5, dp: 1, group: 'Governor' });
  m.pid('PIC_TPT', { desc: 'Throttle pressure control (turbine follow)', pvUnits: 'bar', pvMin: 0, pvMax: 200, kp: 1.5, ti: 20, dp: 1, group: 'Governor' });
  m.pid('PIC_HPB', { desc: 'HP bypass pressure control', pvUnits: 'bar', pvMin: 0, pvMax: 200, sp: 60, kp: 1.5, ti: 20, dp: 1, group: 'Bypass' });
  m.pid('PIC_LPB', { desc: 'LP bypass (hot reheat pressure) control', pvUnits: 'bar', pvMin: 0, pvMax: 50, sp: 9, kp: 1.5, ti: 15, dp: 1, group: 'Bypass' });
  m.hr('HPB_MODE', '', 'HP bypass setpoint mode', { type: 'u16', init: 0, enum: ['FIXED', 'FOLLOW'] });
  m.hr('HPB_RAMP', 'bar/min', 'HP bypass setpoint ramp rate', { init: 3, dp: 1 });
  m.hr('HPB_TARGET', 'bar', 'HP bypass pressure target', { init: 60, dp: 1 });
  m.valve('SH_VENT', { desc: 'SH start-up vent', group: 'Bypass', mode: 1 });

  m.di('TRIPPED', 'Turbine tripped', { alarm: { on: true, pri: 1, text: 'TURBINE TRIP' } });
  m.di('LATCHED', 'Turbine latched (reset)');
  m.ir('MODE', '', 'DEH operating mode', { type: 'u16', enum: DEH_MODES });
  m.ir('TRIP_CAUSE', '', 'Turbine trip first-out', { type: 'u16', enum: TURB_TRIP_CAUSES });
  m.ir('SPEED', 'rpm', 'Turbine speed (median)', { dp: 0, alarm: { h: 3780, hh: 3924, pri: 1 } });
  m.ir('SPEED_REF', 'rpm', 'Speed reference', { dp: 0 });
  m.ir('LOAD_REF', 'MW', 'Load reference', { dp: 1 });
  m.ir('FREQ_CORR', 'MW', 'Frequency correction', { dp: 1 });
  m.ir('GV_DEMAND', '%', 'Governor valve demand');
  m.ir('STRESS_HP', '%', 'HP rotor stress (TSE)', { dp: 0, alarm: { h: 90, pri: 2 } });
  m.ir('STRESS_IP', '%', 'IP rotor stress (TSE)', { dp: 0, alarm: { h: 90, pri: 2 } });
  m.ir('START_CLASS', '', 'Start classification', { type: 'u16', enum: START_CLASS });
  m.ir('MAX_VIB', 'um', 'Highest shaft vibration', { dp: 0 });
  m.di('RAMP_ACTIVE', 'Speed / load ramp in progress');
  m.di('OPC_ACTIVE', 'Overspeed protection controller active', { alarm: { on: true, pri: 1, text: 'OPC operated - governor & intercept valves closed' } });
  m.di('CRIT_ZONE', 'Speed within critical band');
  m.di('AT_SPEED', 'Turbine at synchronous speed');
  m.di('REM_READY', 'Ready for CCS remote control');
  m.di('TPL_ACTIVE', 'Throttle pressure limiter active', { alarm: { on: true, pri: 2, text: 'Throttle pressure limiter active' } });
  m.di('LPB_ILK', 'LP bypass interlocked (condenser not available)', { alarm: { on: true, pri: 2, text: 'LP bypass interlock - condenser not available' } });
  m.di('LATCH_PERM', 'Turbine latch permissive');

  peerBlock(m, 'CCS', () => {
    m.hr('LOAD_REF_REM', 'MW', 'Load reference from CCS');
    m.hr('PRESS_SP_REM', 'bar', 'Throttle pressure setpoint from CCS');
    m.hr('CCS_REQ', '', 'CCS request', { type: 'u16', enum: ['NONE', 'REMOTE LOAD', 'PRESSURE CONTROL'] });
  });
  peerBlock(m, 'GEN', () => {
    m.hr('SYNC_ADJ', 'rpm/s', 'Synchroniser speed adjust');
    m.hr('SYNC_ACTIVE', '', 'Auto synchroniser active', { type: 'u16' });
  });
  return m;
}
