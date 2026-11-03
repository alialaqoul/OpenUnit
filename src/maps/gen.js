import { TagMap } from '../common/tags.js';
import { commonTags } from './common.js';

export const GEN_PEERS = { read: ['DEH'], write: ['DEH'] };

export const GEN_TRIP_CAUSES = [
  'NONE',
  'MANUAL 86G TRIP',
  'GENERATOR DIFFERENTIAL (87G)',
  'LOSS OF FIELD / POLE SLIP (40/78)',
  'REVERSE POWER (32)',
  'OVERVOLTAGE (59)',
  'OVER/UNDER FREQUENCY (81) 57.5 / 61.8 Hz',
  'OVER-EXCITATION V/Hz (24)',
  'STATOR OVERTEMPERATURE',
  'OVERCURRENT (51)',
  'LOW FORWARD POWER (sequential)',
];

export const SYNC_STATES = ['OFF', 'WAITING PERMISSIVES', 'MATCHING', 'CLOSING', 'SYNCHRONISED'];

export function buildGenMap(opts = {}) {
  const m = new TagMap('GEN', 'Generator, Excitation & Synchronising', opts);
  commonTags(m, ['DEH']);
  m.valve('FCB', { desc: 'Field circuit breaker (41)', group: 'Excitation', labels: ['CLOSE', 'OPEN'] });
  m.valve('GCB', { desc: 'Generator circuit breaker (52G)', group: 'Breaker', labels: ['CLOSE', 'OPEN'] });
  m.pid('AVR', { desc: 'Automatic voltage regulator', pvUnits: 'kV', pvMin: 0, pvMax: 30, sp: 22, outUnits: 'pu', outMin: 0, outMax: 2.3, kp: 1.2, ti: 3, dp: 2, group: 'Excitation' });
  m.hr('EXC_MODE', '', 'Excitation control mode', { type: 'u16', init: 0, enum: ['VOLTAGE', 'MVAR', 'POWER FACTOR'] });
  m.hr('MVAR_SP', 'MVAr', 'Reactive power setpoint', { init: 150, dp: 0 });
  m.hr('PF_SP', '', 'Power factor setpoint', { init: 0.95, dp: 3 });
  m.co('SYNC_ON', 'Auto synchroniser ON', { pulse: true });
  m.co('SYNC_OFF', 'Auto synchroniser OFF', { pulse: true });
  m.co('RESET_86', 'Generator lockout relay reset', { pulse: true });
  m.co('TRIP_86', 'Manual generator trip', { pulse: true });
  m.ir('SYNC_STATE', '', 'Auto synchroniser state', { type: 'u16', enum: SYNC_STATES });
  m.di('SYNC_CHECK', 'Synchro-check relay (25) permissive');
  m.di('LOCKOUT_86', 'Generator lockout relay 86G operated', { alarm: { on: true, pri: 1, text: 'GENERATOR TRIP - 86G operated' } });
  m.ir('TRIP_CAUSE', '', 'Generator trip first-out', { type: 'u16', enum: GEN_TRIP_CAUSES });
  m.ir('V_PU', 'pu', 'Generator voltage', { dp: 3 });
  m.ir('GRID_V_PU', 'pu', 'Grid voltage referred to generator', { dp: 3 });
  m.ir('VHZ', 'pu', 'Volts per hertz', { dp: 3, alarm: { h: 1.08, pri: 2 } });
  m.ir('DV_PCT', '%', 'Voltage difference generator - grid', { dp: 1 });
  m.di('OEL_ACTIVE', 'Over-excitation limiter active', { alarm: { on: true, pri: 2, text: 'Over-excitation limiter active' } });
  m.di('UEL_ACTIVE', 'Under-excitation limiter active', { alarm: { on: true, pri: 2, text: 'Under-excitation limiter active' } });
  m.di('REV_POWER', 'Reverse power detected', { alarm: { on: true, pri: 2, text: 'Generator reverse power' } });
  return m;
}
