import { TagMap } from '../common/tags.js';
import { commonTags, peerBlock } from './common.js';

export const STC_PEERS = { read: ['BMS', 'DEH'], write: [] };

export function buildStcMap(opts = {}) {
  const m = new TagMap('STC', 'Steam Temperature Control', opts);
  commonTags(m, ['BMS', 'DEH', 'CCS']);
  m.valve('SPRAY_BLOCK', { desc: 'SH spray block valve', group: 'SH', mode: 1 });
  m.pid('TIC_MS', {
    desc: 'Main steam temperature (master)',
    pvUnits: 'degC',
    pvMin: 300,
    pvMax: 600,
    sp: 538,
    outUnits: 'degC',
    outMin: 300,
    outMax: 530,
    kp: 1.0,
    ti: 250,
    group: 'SH',
  });
  m.pid('TIC_DSH', {
    desc: 'Desuperheater outlet temperature (SH spray)',
    pvUnits: 'degC',
    pvMin: 200,
    pvMax: 600,
    sp: 450,
    kp: 1.2,
    ti: 25,
    cas: true,
    group: 'SH',
  });
  m.pid('TIC_RH', {
    desc: 'Reheat temperature (burner tilt)',
    pvUnits: 'degC',
    pvMin: 300,
    pvMax: 600,
    sp: 538,
    outUnits: 'deg',
    outMin: -30,
    outMax: 30,
    kp: 2,
    ti: 200,
    group: 'RH',
  });
  m.pid('TIC_RHS', {
    desc: 'Reheat emergency spray',
    pvUnits: 'degC',
    pvMin: 300,
    pvMax: 600,
    sp: 545,
    kp: 3,
    ti: 60,
    group: 'RH',
  });
  m.hr('RHS_OFFSET', 'degC', 'RH spray setpoint offset above RH SP', { init: 6 });
  m.ir('DSH_SP_MIN', 'degC', 'Minimum DSH outlet setpoint (superheat margin)');
  m.ir('MS_SUPERHEAT', 'K', 'Main steam superheat', { dp: 0 });
  m.di('SPRAY_PERMIT', 'SH spray permitted (load > 20 %)');
  peerBlock(m, 'CCS', () => {
    m.hr('BLR_DMD_FF', '%', 'Boiler demand feed-forward from CCS');
  });
  return m;
}
