import { TagMap } from '../common/tags.js';
import { commonTags } from './common.js';

export const BOP_PEERS = { read: ['DEH'], write: [] };

export function buildBopMap(opts = {}) {
  const m = new TagMap('BOP', 'Balance of Plant / Turbine Auxiliaries', opts);
  commonTags(m, ['DEH']);
  m.motor('CWP_A', { desc: 'CW pump A', group: 'CW' });
  m.motor('CWP_B', { desc: 'CW pump B', group: 'CW' });
  m.motor('VP_A', { desc: 'Vacuum pump A', group: 'Vacuum' });
  m.motor('VP_B', { desc: 'Vacuum pump B', group: 'Vacuum' });
  m.motor('CEP_A', { desc: 'Condensate pump A', group: 'Condensate' });
  m.motor('CEP_B', { desc: 'Condensate pump B', group: 'Condensate' });
  m.motor('AOP', { desc: 'AC lube oil pump', group: 'Lube oil' });
  m.motor('EOP', { desc: 'DC emergency oil pump', group: 'Lube oil' });
  m.motor('JOP', { desc: 'Jacking oil pump', group: 'Lube oil' });
  m.motor('TG', { desc: 'Turning gear', group: 'Lube oil', tripAlarm: true });
  m.valve('GLAND', { desc: 'Gland steam supply', group: 'Vacuum' });
  m.valve('VB', { desc: 'Vacuum breaker', group: 'Vacuum' });
  m.valve('HW_DUMP', { desc: 'Hotwell dump valve', group: 'Condensate' });
  m.pid('LIC_HW', {
    desc: 'Hotwell level control (make-up)',
    pvUnits: 'mm',
    pvMin: 0,
    pvMax: 1500,
    sp: 800,
    kp: 2,
    ti: 120,
    dp: 0,
    group: 'Condensate',
  });
  m.di('VAC_OK', 'Condenser vacuum established (< 200 mbar)');
  m.di('CW_OK', 'CW system in service');
  m.di('LO_OK', 'Lube oil pressure normal');
  m.ir('COND_PRESS', 'mbar', 'Condenser pressure (selected)', { dp: 0 });
  return m;
}
