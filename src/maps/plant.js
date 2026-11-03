import { TagMap } from '../common/tags.js';
import { PERF_TAGS } from '../plant/model/performanceTags.js';

/**
 * PLANT node = process simulator acting as the field I/O (remote I/O racks).
 *   Input registers / discrete inputs : transmitters, limit switches, motor feedback (read by everyone)
 *   Holding registers / coils         : actuator commands, each block owned by one controller
 *
 * Pressures: steam/water/gas supply/oil in bar(g); condenser mbar(a); furnace, burner header and gland in mbar(g).
 * Electrical system 60 Hz, turbine-generator 3600 rpm.
 * Fuel: natural gas, 4 burner elevations (A-D) on a corner (tangential) fired furnace.
 */
/** Gas burner elevations (each elevation = 6 burners with HEI igniters and flame scanners). */
export const ELEVS = ['A', 'B', 'C', 'D'];
export const BEARINGS = [1, 2, 3, 4, 5, 6];

export const MOTORS = [
  ['CWP_A', 'CW pump A'],
  ['CWP_B', 'CW pump B'],
  ['CEP_A', 'Condensate pump A'],
  ['CEP_B', 'Condensate pump B'],
  ['BFP_A', 'Boiler feed pump A'],
  ['BFP_B', 'Boiler feed pump B'],
  ['BFP_C', 'Boiler feed pump C'],
  ['VP_A', 'Vacuum pump A'],
  ['VP_B', 'Vacuum pump B'],
  ['AOP', 'AC lube oil pump'],
  ['EOP', 'DC emergency oil pump'],
  ['JOP', 'Jacking oil pump'],
  ['TG', 'Turning gear motor'],
  ['APH_A', 'Air preheater A'],
  ['APH_B', 'Air preheater B'],
  ['ID_A', 'ID fan A'],
  ['ID_B', 'ID fan B'],
  ['FD_A', 'FD fan A'],
  ['FD_B', 'FD fan B'],
];

export const MALFUNCTIONS = [
  ['MF_BFP_A_TRIP', 'BFP A motor trip (electrical fault)', 'Feedwater'],
  ['MF_CEP_A_TRIP', 'Condensate pump A trip', 'Feedwater'],
  ['MF_FW_CV_STUCK', 'Feedwater control valve stuck', 'Feedwater'],
  ['MF_DRUM_LT_A_FAIL', 'Drum level transmitter A fails high', 'Feedwater'],
  ['MF_HPH_TRIP', 'HP heaters trip on high level (bypass)', 'Feedwater'],
  ['MF_TUBE_LEAK', 'Waterwall tube leak (severity t/h)', 'Boiler'],
  ['MF_SH_SPRAY_STUCK', 'SH spray valve stuck', 'Boiler'],
  ['MF_MS_PT_DRIFT', 'Main steam pressure transmitter drift', 'Boiler'],
  ['MF_ID_A_TRIP', 'ID fan A trip', 'Combustion'],
  ['MF_FD_A_TRIP', 'FD fan A trip', 'Combustion'],
  ['MF_GAS_PRESS_LOW', 'Gas supply pressure drop (pipeline / regulator)', 'Combustion'],
  ['MF_GFCV_STUCK', 'Gas flow control valve stuck', 'Combustion'],
  ['MF_FLAME_LOSS_B', 'Flame instability on elevation B burners', 'Combustion'],
  ['MF_IGN_FAIL_C', 'Elevation C igniters fail to spark', 'Combustion'],
  ['MF_CWP_A_TRIP', 'CW pump A trip', 'Turbine'],
  ['MF_AIR_INGRESS', 'Condenser air in-leakage (severity x)', 'Turbine'],
  ['MF_COND_FOULING', 'Condenser tube fouling', 'Turbine'],
  ['MF_VIB_HIGH', 'Bearing 3 high vibration (severity um)', 'Turbine'],
  ['MF_LO_LEAK', 'Lube oil system leak', 'Turbine'],
  ['MF_AOP_FAIL', 'AC lube oil pump fails to start', 'Turbine'],
  ['MF_GRID_FAULT', 'Grid fault - generator breaker opens (load rejection)', 'Electrical'],
  ['MF_EXCITER_FAIL', 'Excitation system failure (loss of field)', 'Electrical'],
  ['MF_GEN_FAULT', 'Generator internal fault (differential)', 'Electrical'],
];

export function buildPlantMap() {
  const m = new TagMap('PLANT', 'Process Simulator / Field I/O');

  // ---------------------------------------------------------------- inputs (IR)
  m.ir('SIM_TIME_MS', 'ms', 'Simulation clock', { type: 'u32' });
  m.ir('SIM_SPEED_ACT', 'x', 'Actual simulation speed', { dp: 1 });
  m.ir('IC_ACTIVE', '', 'Loaded initial condition', { type: 'u16' });
  m.ir('IC_SEQ', '', 'IC load sequence counter', { type: 'u16' });
  m.ir('SNAP_SEQ', '', 'Snapshot sequence counter', { type: 'u16' });
  m.ir('SNAP_SLOT', '', 'Last snapshot slot', { type: 'u16' });
  m.ir('HEARTBEAT', '', 'Plant heartbeat', { type: 'u16' });

  // Boiler water/steam
  m.ir('DRUM_PRESS', 'bar', 'Drum pressure', { dp: 1, min: 0, max: 220, alarm: { h: 198, hh: 204, pri: 1 } });
  m.ir('DRUM_LVL_A', 'mm', 'Drum level transmitter A', { min: -500, max: 500 });
  m.ir('DRUM_LVL_B', 'mm', 'Drum level transmitter B', { min: -500, max: 500 });
  m.ir('DRUM_LVL_C', 'mm', 'Drum level transmitter C', { min: -500, max: 500 });
  m.ir('DRUM_TEMP', 'degC', 'Drum saturation temperature', { min: 0, max: 400 });
  m.ir('DRUM_METAL_DT', 'K', 'Drum top/bottom metal temperature difference', { alarm: { h: 50, pri: 2 } });
  m.ir('FW_FLOW', 't/h', 'Feedwater flow to economizer', { min: 0, max: 2600 });
  m.ir('FW_TEMP', 'degC', 'Feedwater temperature (HPH outlet)', { min: 0, max: 320 });
  m.ir('FW_HDR_PRESS', 'bar', 'BFP discharge header pressure', { dp: 1, min: 0, max: 280 });
  m.ir('ECO_OUT_TEMP', 'degC', 'Economizer outlet water temperature', { min: 0, max: 400 });
  m.ir('STEAM_FLOW', 't/h', 'Main steam flow', { min: 0, max: 2600 });
  m.ir('MS_PRESS', 'bar', 'Main steam (throttle) pressure', { dp: 1, min: 0, max: 220, alarm: { h: 176, hh: 182, pri: 1 } });
  m.ir('MS_TEMP', 'degC', 'Main steam temperature', { min: 0, max: 600, alarm: { h: 548, hh: 560, pri: 1 } });
  m.ir('SH1_OUT_TEMP', 'degC', 'Primary SH outlet temperature (before DSH)', { min: 0, max: 600 });
  m.ir('DSH_OUT_TEMP', 'degC', 'Desuperheater outlet temperature', { min: 0, max: 600 });
  m.ir('SH_SPRAY_FLOW', 't/h', 'SH attemperator spray flow', { min: 0, max: 250 });
  m.ir('SH_METAL_TEMP', 'degC', 'Final SH tube metal temperature', { min: 0, max: 700, alarm: { h: 595, hh: 610, pri: 1 } });
  m.ir('CRH_PRESS', 'bar', 'Cold reheat pressure', { dp: 1, min: 0, max: 60 });
  m.ir('CRH_TEMP', 'degC', 'Cold reheat temperature', { min: 0, max: 450 });
  m.ir('HRH_PRESS', 'bar', 'Hot reheat pressure', { dp: 1, min: 0, max: 60 });
  m.ir('HRH_TEMP', 'degC', 'Hot reheat temperature', { min: 0, max: 600, alarm: { h: 548, hh: 560, pri: 1 } });
  m.ir('RH_SPRAY_FLOW', 't/h', 'RH emergency spray flow', { min: 0, max: 150 });
  m.ir('RH_METAL_TEMP', 'degC', 'Reheater tube metal temperature', { min: 0, max: 700, alarm: { h: 600, hh: 615, pri: 1 } });
  m.ir('HPB_POS', '%', 'HP bypass valve position');
  m.ir('HPB_FLOW', 't/h', 'HP bypass steam flow');
  m.ir('HPB_OUT_TEMP', 'degC', 'HP bypass outlet temperature');
  m.ir('LPB_POS', '%', 'LP bypass valve position');
  m.ir('LPB_FLOW', 't/h', 'LP bypass steam flow');
  m.ir('VENT_FLOW', 't/h', 'SH start-up vent flow');
  m.ir('SAFETY_FLOW', 't/h', 'Safety valve discharge flow');
  m.ir('BLOWDOWN_FLOW', 't/h', 'Blowdown flow (EBD + CBD)');

  // Combustion / draft
  m.ir('FURN_PRESS_A', 'mbar', 'Furnace pressure A', { dp: 2, min: -30, max: 30 });
  m.ir('FURN_PRESS_B', 'mbar', 'Furnace pressure B', { dp: 2, min: -30, max: 30 });
  m.ir('FURN_PRESS_C', 'mbar', 'Furnace pressure C', { dp: 2, min: -30, max: 30 });
  m.ir('AIR_FLOW', 't/h', 'Total combustion air flow', { dp: 0, min: 0, max: 3200 });
  m.ir('FD_A_FLOW', 't/h', 'FD fan A air flow', { dp: 0 });
  m.ir('FD_B_FLOW', 't/h', 'FD fan B air flow', { dp: 0 });
  for (const [t, d] of [
    ['FD_A_PITCH_FB', 'FD fan A blade pitch'],
    ['FD_B_PITCH_FB', 'FD fan B blade pitch'],
    ['ID_A_VANE_FB', 'ID fan A inlet vane'],
    ['ID_B_VANE_FB', 'ID fan B inlet vane'],
  ]) m.ir(t, '%', d);
  for (const f of ['FD_A', 'FD_B', 'ID_A', 'ID_B']) m.ir(`${f}_AMPS`, 'A', `${f.replace('_', ' fan ')} motor current`, { dp: 0 });
  m.ir('O2', '%', 'Flue gas O2 (economizer outlet)', { dp: 2, min: 0, max: 21, alarm: { l: 1.2, ll: 0.7, pri: 1 } });
  m.ir('CO', 'ppm', 'Flue gas CO', { dp: 0, alarm: { h: 200, pri: 2 } });
  m.ir('NOX', 'mg/Nm3', 'Flue gas NOx', { dp: 0 });
  m.ir('FEGT', 'degC', 'Furnace exit gas temperature', { dp: 0 });
  m.ir('ECO_GAS_OUT_T', 'degC', 'Economizer outlet gas temperature', { dp: 0 });
  m.ir('APH_GAS_OUT_T', 'degC', 'Air heater gas outlet temperature', { dp: 0, alarm: { h: 150, pri: 3 } });
  m.ir('APH_AIR_OUT_T', 'degC', 'Air heater hot air temperature', { dp: 0 });
  m.ir('GAS_SUPPLY_PRESS', 'bar', 'Natural gas supply pressure (after PRS)', { dp: 1, alarm: { l: 16, ll: 12, pri: 1 } });
  m.ir('GAS_HDR_PRESS', 'mbar', 'Burner gas header pressure', { dp: 0, alarm: { h: 3800, l: 180, pri: 1 } });
  m.ir('GAS_FLOW', 't/h', 'Total natural gas flow', { dp: 1 });
  m.ir('GAS_TEMP', 'degC', 'Gas temperature (after heater)', { dp: 0 });
  m.ir('GFCV_FB', '%', 'Gas flow control valve position');
  for (const x of ELEVS) m.ir(`GAS_${x}_FLOW`, 't/h', `Gas flow elevation ${x}`, { dp: 1 });
  m.ir('FUEL_HEAT', 'MW', 'Fuel heat input', { dp: 0 });
  m.ir('BOILER_EFF', '%', 'Boiler efficiency (calculated)', { dp: 1 });
  m.ir('TILT_FB', 'deg', 'Burner tilt position', { dp: 1 });
  m.ir('SH_SPRAY_FB', '%', 'SH spray valve position');
  m.ir('RH_SPRAY_FB', '%', 'RH spray valve position');
  m.ir('FCV_FB', '%', 'Feedwater control valve position');
  m.ir('DA_CV_FB', '%', 'Deaerator level control valve position');
  m.ir('MAKEUP_FB', '%', 'Condenser make-up valve position');
  m.ir('PEG_FB', '%', 'Deaerator pegging steam valve position');
  m.ir('CBD_FB', '%', 'Continuous blowdown valve position');

  // Turbine
  m.ir('SPEED_A', 'rpm', 'Turbine speed probe A', { dp: 0, min: 0, max: 4320 });
  m.ir('SPEED_B', 'rpm', 'Turbine speed probe B', { dp: 0, min: 0, max: 4320 });
  m.ir('SPEED_C', 'rpm', 'Turbine speed probe C', { dp: 0, min: 0, max: 4320 });
  m.ir('GV_POS', '%', 'HP governor (control) valve position');
  m.ir('ICV_POS', '%', 'Intercept valve position');
  m.ir('FIRST_STAGE_PRESS', 'bar', 'HP first stage pressure', { dp: 1 });
  m.ir('HP_EXH_TEMP', 'degC', 'HP exhaust temperature', { dp: 0, alarm: { h: 420, pri: 2 } });
  m.ir('HP_METAL_TEMP', 'degC', 'HP inner casing metal temperature', { dp: 0 });
  m.ir('IP_METAL_TEMP', 'degC', 'IP inner casing metal temperature', { dp: 0 });
  m.ir('CROSS_PRESS', 'bar', 'IP/LP crossover pressure', { dp: 2 });
  for (const b of BEARINGS) {
    m.ir(`VIB_${b}`, 'um', `Bearing ${b} shaft vibration`, { dp: 0, alarm: { h: 125, hh: 200, pri: 1 } });
    m.ir(`BRG_T_${b}`, 'degC', `Bearing ${b} metal temperature`, { dp: 0, alarm: { h: 100, hh: 110, pri: 2 } });
  }
  m.ir('ECCENTRICITY', 'um', 'Rotor eccentricity', { dp: 0, alarm: { h: 76, pri: 2 } });
  m.ir('AXIAL_DISP', 'mm', 'Rotor axial displacement', { dp: 2 });
  m.ir('LO_PRESS', 'bar', 'Lube oil header pressure', { dp: 2, alarm: { l: 1.0, ll: 0.7, pri: 1 } });
  m.ir('LO_TEMP', 'degC', 'Lube oil temperature', { dp: 0 });
  m.ir('COND_PRESS', 'mbar', 'Condenser pressure (abs)', { dp: 0, alarm: { h: 150, hh: 250, pri: 1 } });
  m.ir('LP_HOOD_TEMP', 'degC', 'LP exhaust hood temperature', { dp: 0, alarm: { h: 80, pri: 2 } });
  m.ir('HW_LVL', 'mm', 'Hotwell level', { dp: 0, min: 0, max: 1500, alarm: { l: 400, h: 1200, pri: 2 } });
  m.ir('CEP_FLOW', 't/h', 'Condensate flow', { dp: 0 });
  m.ir('CEP_PRESS', 'bar', 'Condensate pump discharge pressure', { dp: 1 });
  m.ir('DA_LVL', 'mm', 'Deaerator storage tank level', { dp: 0, min: 0, max: 3000, alarm: { l: 1200, ll: 800, h: 2600, pri: 1 } });
  m.ir('DA_PRESS', 'bar', 'Deaerator pressure', { dp: 2 });
  m.ir('DA_TEMP', 'degC', 'Deaerator temperature', { dp: 0 });
  for (const p of ['A', 'B', 'C']) {
    m.ir(`BFP_${p}_SPEED`, 'rpm', `BFP ${p} speed`, { dp: 0 });
    m.ir(`BFP_${p}_FLOW`, 't/h', `BFP ${p} flow`, { dp: 0 });
    m.ir(`BFP_${p}_AMPS`, 'A', `BFP ${p} motor current`, { dp: 0 });
  }
  m.ir('CW_FLOW', 't/h', 'Circulating water flow', { dp: 0 });
  m.ir('CW_IN_T', 'degC', 'CW inlet temperature', { dp: 1 });
  m.ir('CW_OUT_T', 'degC', 'CW outlet temperature', { dp: 1 });
  m.ir('GLAND_PRESS', 'mbar', 'Gland steam header pressure', { dp: 0 });

  // Generator / electrical
  m.ir('GEN_MW', 'MW', 'Generator active power', { dp: 1 });
  m.ir('GEN_MVAR', 'MVAr', 'Generator reactive power', { dp: 1 });
  m.ir('GEN_KV', 'kV', 'Generator terminal voltage', { dp: 2 });
  m.ir('GEN_KA', 'kA', 'Generator stator current', { dp: 2 });
  m.ir('GEN_FREQ', 'Hz', 'Generator frequency', { dp: 3 });
  m.ir('GEN_PF', '', 'Generator power factor', { dp: 3 });
  m.ir('GRID_FREQ', 'Hz', 'Grid frequency', { dp: 3 });
  m.ir('GRID_KV', 'kV', 'Grid (400 kV bus) voltage', { dp: 1 });
  m.ir('SYNC_PHASE', 'deg', 'Synchroscope phase angle generator vs grid', { dp: 1 });
  m.ir('SYNC_SLIP', 'Hz', 'Slip frequency generator - grid', { dp: 3 });
  m.ir('FIELD_AMPS', 'A', 'Field current', { dp: 0 });
  m.ir('FIELD_VOLTS', 'V', 'Field voltage', { dp: 0 });
  m.ir('LOAD_ANGLE', 'deg', 'Rotor load angle', { dp: 1 });
  m.ir('STATOR_TEMP', 'degC', 'Stator winding temperature', { dp: 0, alarm: { h: 112, hh: 120, pri: 2 } });
  m.ir('ROTOR_TEMP', 'degC', 'Rotor winding temperature', { dp: 0 });
  m.ir('H2_TEMP', 'degC', 'Cold hydrogen temperature', { dp: 0 });
  m.ir('AUX_MW', 'MW', 'Unit auxiliary load', { dp: 1 });
  m.ir('NET_MW', 'MW', 'Net unit output', { dp: 1 });

  // Heat cycle (feedwater heaters, extractions) - appended so the addresses above stay fixed
  m.ir('HW_TEMP', 'degC', 'Hotwell condensate temperature', { dp: 1 });
  m.ir('LPH1_FW_IN_T', 'degC', 'Condensate temperature to LPH1', { dp: 1 });
  m.ir('BFP_DISCH_T', 'degC', 'BFP discharge temperature (HPH6 inlet)', { dp: 1 });
  m.ir('CROSS_TEMP', 'degC', 'IP exhaust / crossover temperature', { dp: 0 });
  for (const [h, d] of [['LPH1', 'LP heater 1'], ['LPH2', 'LP heater 2'], ['LPH3', 'LP heater 3'], ['LPH4', 'LP heater 4'], ['HPH6', 'HP heater 6'], ['HPH7', 'HP heater 7']]) {
    m.ir(`${h}_FW_OUT_T`, 'degC', `${d} feedwater outlet temperature`, { dp: 1 });
    m.ir(`${h}_DRN_T`, 'degC', `${d} drain outlet temperature`, { dp: 1 });
    m.ir(`${h}_EXT_P`, 'bar(a)', `${d} extraction steam pressure (flange)`, { dp: 3 });
    m.ir(`${h}_EXT_T`, 'degC', `${d} extraction steam temperature`, { dp: 0 });
    m.ir(`${h}_EXT_FLOW`, 't/h', `${d} extraction steam flow`, { dp: 0 });
  }
  m.ir('DA_EXT_FLOW', 't/h', 'Deaerator extraction steam flow', { dp: 0 });
  m.ir('APH_AIR_IN_T', 'degC', 'Air heater air inlet temperature', { dp: 1 });
  m.ir('APH_O2_OUT', '%', 'Flue gas O2 after the air heater', { dp: 2 });
  m.ir('AFT', 'degC', 'Adiabatic flame temperature (calculated)', { dp: 0 });

  // EtaPRO performance calculations (templates evaluated on the measurements)
  for (const [tag, unit, desc, dp] of PERF_TAGS) m.ir(tag, unit, desc, { dp });

  // ---------------------------------------------------------------- inputs (DI)
  m.di('SIM_FROZEN', 'Simulation frozen');
  for (const [tag, desc] of MOTORS) {
    m.di(`${tag}_RUN`, `${desc} running`);
    m.di(`${tag}_TRIP`, `${desc} tripped`);
  }
  m.di('TG_ENGAGED', 'Turning gear engaged');
  m.di('MSV_OPEN', 'Main stop valves open');
  m.di('RSV_OPEN', 'Reheat stop valves open');
  m.di('EBD_OPEN', 'Emergency blowdown valve open');
  m.di('SH_VENT_OPEN', 'SH start-up vent open');
  m.di('GLAND_ON', 'Gland steam supply in service');
  m.di('VB_OPEN', 'Vacuum breaker open');
  m.di('HPH_IN_SERVICE', 'HP heaters in service');
  m.di('SPRAY_BLOCK_OPEN', 'SH spray block valve open');
  m.di('HW_DUMP_OPEN', 'Hotwell dump valve open');
  m.di('MGTV_OPEN', 'Main gas trip valves (SSV1+SSV2) open');
  m.di('MGTV_CLOSED', 'Main gas trip valves closed');
  m.di('GAS_VENT_OPEN', 'Gas header vent (bleed) valve open');
  for (const x of ELEVS) {
    m.di(`BRN_${x}_OPEN`, `Elevation ${x} burner gas valves open`);
    m.di(`IGN_${x}_FLAME`, `Elevation ${x} igniter flame proven`);
    m.di(`FLAME_${x}`, `Elevation ${x} main flame detected`);
  }
  m.di('GCB_CLOSED', 'Generator circuit breaker (52G) closed');
  m.di('FCB_CLOSED', 'Field circuit breaker (41) closed');
  m.di('OUT_OF_STEP', 'Generator pole slipping');
  m.di('GEN_DIFF_RELAY', 'Generator differential relay (87G) operated');
  m.di('MECH_OVERSPEED', 'Mechanical overspeed bolt tripped');
  m.di('SAFETY_VLV_LIFT', 'Boiler safety valve lifted');
  m.di('MFT_HW', 'Hardwired MFT relay tripped');
  m.di('TURB_TRIP_HW', 'Turbine trip solenoids de-energised');
  m.di('BMS_WD_FAIL', 'BMS watchdog failure (hardwired MFT)');
  m.di('DEH_WD_FAIL', 'DEH watchdog failure (hardwired turbine trip)');
  m.di('FURNACE_PUFF', 'Furnace puff (delayed ignition) occurred');

  // ---------------------------------------------------------------- outputs
  // Instructor station (written by the HMI / instructor)
  m.section('INS', () => {
    m.co('SIM_RUN', 'Run (1) / Freeze (0)', { init: false });
    m.co('IC_LOAD', 'Load selected initial condition (pulse)', { pulse: true });
    m.co('SNAP_SAVE', 'Save snapshot into selected slot (pulse)', { pulse: true });
    for (const [tag, desc] of MALFUNCTIONS) m.co(tag, desc);
    m.hr('SIM_SPEED', 'x', 'Simulation speed request', { init: 1 });
    m.hr('IC_SELECT', '', 'Initial condition selection', { type: 'u16', init: 4 });
    m.hr('SNAP_SELECT', '', 'Snapshot slot selection', { type: 'u16', init: 10 });
    m.hr('CW_INLET_T_SET', 'degC', 'CW inlet (sea/cooling tower) temperature', { init: 25 });
    m.hr('AMBIENT_T_SET', 'degC', 'Ambient air temperature', { init: 30 });
    m.hr('GRID_FREQ_SET', 'Hz', 'Grid frequency', { init: 60, dp: 3 });
    m.hr('GRID_KV_SET', 'kV', 'Grid voltage', { init: 400 });
    m.hr('GAS_LHV_SET', 'MJ/kg', 'Natural gas lower heating value', { init: 49, dp: 2 });
    m.hr('GAS_SUPPLY_SET', 'bar', 'Gas supply pressure (pipeline after PRS)', { init: 30, dp: 1 });
    m.hr('MF_TUBE_LEAK_SEV', 't/h', 'Tube leak size', { init: 80 });
    m.hr('MF_AIR_INGRESS_SEV', 'x', 'Air in-leakage multiplier', { init: 15 });
    m.hr('MF_VIB_SEV', 'um', 'Additional vibration bearing 3', { init: 150 });
  });

  m.section('BOP', () => {
    for (const t of ['CWP_A', 'CWP_B', 'VP_A', 'VP_B', 'CEP_A', 'CEP_B', 'AOP', 'EOP', 'JOP', 'TG']) m.co(`${t}_CMD`, `${t} run command`);
    m.co('GLAND_CMD', 'Gland steam supply valve open');
    m.co('VB_CMD', 'Vacuum breaker open');
    m.co('HW_DUMP_CMD', 'Hotwell dump valve open');
    m.hr('MAKEUP_DMD', '%', 'Condenser make-up valve demand');
  });

  m.section('FWC', () => {
    for (const t of ['BFP_A', 'BFP_B', 'BFP_C']) m.co(`${t}_CMD`, `${t} run command`);
    m.co('EBD_CMD', 'Emergency blowdown valve open');
    m.co('HPH_CMD', 'HP heaters in service');
    for (const t of ['A', 'B', 'C']) m.hr(`BFP_${t}_SPD_DMD`, '%', `BFP ${t} hydraulic coupling scoop demand`);
    m.hr('FCV_DMD', '%', 'Feedwater control valve demand');
    m.hr('DA_CV_DMD', '%', 'Deaerator level control valve demand');
    m.hr('PEG_DMD', '%', 'Deaerator pegging steam valve demand');
    m.hr('CBD_DMD', '%', 'Continuous blowdown valve demand');
  });

  m.section('STC', () => {
    m.co('SPRAY_BLOCK_CMD', 'SH spray block valve open');
    m.hr('SH_SPRAY_DMD', '%', 'SH spray control valve demand');
    m.hr('RH_SPRAY_DMD', '%', 'RH spray control valve demand');
    m.hr('TILT_DMD', 'deg', 'Burner tilt demand');
  });

  m.section('CMB', () => {
    for (const t of ['APH_A', 'APH_B', 'ID_A', 'ID_B', 'FD_A', 'FD_B']) m.co(`${t}_CMD`, `${t} run command`);
    m.hr('FD_A_PITCH_DMD', '%', 'FD fan A pitch demand');
    m.hr('FD_B_PITCH_DMD', '%', 'FD fan B pitch demand');
    m.hr('ID_A_VANE_DMD', '%', 'ID fan A vane demand');
    m.hr('ID_B_VANE_DMD', '%', 'ID fan B vane demand');
    m.hr('GFCV_DMD', '%', 'Gas flow control valve demand');
  });

  m.section('BMS', () => {
    m.co('MFT_TRIP', 'Master fuel trip relay (1 = tripped)', { init: true });
    m.co('MGTV_CMD', 'Main gas trip valves open');
    m.co('GAS_VENT_CMD', 'Gas header vent valve open');
    for (const x of ELEVS) m.co(`IGN_${x}_CMD`, `Elevation ${x} igniters on`);
    for (const x of ELEVS) m.co(`BRN_${x}_CMD`, `Elevation ${x} burner gas valves open`);
    m.hr('BMS_WD', '', 'BMS watchdog counter', { type: 'u16' });
  });

  m.section('DEH', () => {
    m.co('TURB_TRIP', 'Turbine trip (1 = tripped)', { init: true });
    m.co('MSV_CMD', 'Main stop valves open');
    m.co('RSV_CMD', 'Reheat stop valves open');
    m.co('SH_VENT_CMD', 'SH start-up vent open');
    m.hr('GV_DMD', '%', 'Governor valve demand');
    m.hr('ICV_DMD', '%', 'Intercept valve demand');
    m.hr('HPB_DMD', '%', 'HP bypass valve demand');
    m.hr('LPB_DMD', '%', 'LP bypass valve demand');
    m.hr('DEH_WD', '', 'DEH watchdog counter', { type: 'u16' });
  });

  m.section('GEN', () => {
    m.co('FCB_CMD', 'Field breaker close');
    m.co('GCB_CMD', 'Generator breaker close');
    m.hr('EXC_DMD', 'pu', 'Field current demand', { dp: 3 });
  });

  return m;
}

export const PLANT_MAP = buildPlantMap();
