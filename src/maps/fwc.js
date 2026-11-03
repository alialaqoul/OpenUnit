import { TagMap, PID_MODE } from '../common/tags.js';
import { commonTags } from './common.js';

export const FWC_PEERS = { read: ['BMS', 'DEH'], write: [] };

export function buildFwcMap(opts = {}) {
  const m = new TagMap('FWC', 'Feedwater & Condensate Control', opts);
  commonTags(m, ['BMS', 'DEH']);
  m.motor('BFP_A', { desc: 'Boiler feed pump A', group: 'BFP' });
  m.motor('BFP_B', { desc: 'Boiler feed pump B', group: 'BFP' });
  m.motor('BFP_C', { desc: 'Boiler feed pump C', group: 'BFP' });
  m.valve('EBD', { desc: 'Emergency blowdown valve', group: 'Drum' });
  m.valve('HPH', { desc: 'HP heaters in service', group: 'Heaters', labels: ['IN SERVICE', 'BYPASS'] });

  m.pid('LIC_DRUM', {
    desc: 'Drum level master',
    pvUnits: 'mm',
    pvMin: -500,
    pvMax: 500,
    sp: 0,
    kp: 2.5,
    ti: 90,
    dp: 0,
    group: 'Drum',
  });
  m.pid('FIC_FW', {
    desc: 'Feedwater flow (3-element)',
    pvUnits: 't/h',
    pvMin: 0,
    pvMax: 2600,
    kp: 0.6,
    ti: 8,
    dp: 0,
    cas: true,
    group: 'Drum',
  });
  m.pid('PIC_FWDP', {
    desc: 'Feedwater valve differential pressure (BFP master)',
    pvUnits: 'bar',
    pvMin: 0,
    pvMax: 50,
    sp: 14,
    kp: 0.8,
    ti: 8,
    dp: 1,
    cas: true,
    group: 'BFP',
  });
  m.station('SC_BFPA', { desc: 'BFP A speed (scoop)', group: 'BFP' });
  m.station('SC_BFPB', { desc: 'BFP B speed (scoop)', group: 'BFP' });
  m.station('SC_BFPC', { desc: 'BFP C speed (scoop)', group: 'BFP' });
  m.pid('LIC_DA', {
    desc: 'Deaerator level control',
    pvUnits: 'mm',
    pvMin: 0,
    pvMax: 3000,
    sp: 2000,
    kp: 2.5,
    ti: 60,
    dp: 0,
    group: 'Deaerator',
  });
  m.pid('PIC_DA', {
    desc: 'Deaerator pegging steam pressure',
    pvUnits: 'bar',
    pvMin: 0,
    pvMax: 10,
    sp: 1.5,
    kp: 2,
    ti: 30,
    dp: 2,
    group: 'Deaerator',
  });
  m.station('HIC_CBD', { desc: 'Continuous blowdown', group: 'Drum' });

  m.hr('ELEM_SEL', '', 'Drum level element selection', { type: 'u16', init: 0, enum: ['AUTO', '1-ELEMENT', '3-ELEMENT'] });
  m.hr('DP_SP_MODE', '', 'FW DP setpoint program', { type: 'u16', init: 1, enum: ['OPERATOR', 'PROGRAM'] });
  m.ir('DRUM_LVL_SEL', 'mm', 'Drum level (median of 3)', { dp: 0, alarm: { h: 100, hh: 200, l: -100, ll: -200, pri: 1 } });
  m.ir('FW_DP', 'bar', 'Feedwater valve differential pressure', { dp: 1 });
  m.ir('BFP_MASTER', '%', 'BFP master demand');
  m.ir('STEAM_FLOW_PCT', '%', 'Steam flow (% MCR)');
  m.ir('BFP_RUNNING', '', 'Number of BFPs running', { type: 'u16' });
  m.di('E3_ACTIVE', 'Three-element control active');
  m.di('LT_DEVIATION', 'Drum level transmitter deviation', { alarm: { on: true, pri: 2, text: 'Drum level transmitter deviation > 50 mm' } });
  m.di('LVL_AUTO', 'Drum level control in automatic');
  m.di('RB_BFP', 'BFP runback request', { alarm: { on: true, pri: 1, text: 'RUNBACK - loss of boiler feed pump' } });
  void PID_MODE;
  return m;
}
