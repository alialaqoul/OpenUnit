/**
 * Design data of the simulated unit: 700 MW gross, subcritical natural-circulation drum
 * boiler, natural gas fired from 4 burner elevations (corner/tangential firing), balanced
 * draft (2 x FD, 2 x ID fans), single reheat tandem-compound turbine
 * (HP + IP + 2xLP), 3600 rpm / 60 Hz hydrogen cooled generator.
 */
export const DES = Object.freeze({
  MW: 700,
  MVA: 823.5,
  GEN_KV: 22,
  GRID_KV: 400,
  FREQ: 60,
  RPM: 3600,
  INERTIA: 40600, // kg m2, turbine-generator train (H ~ 3.5 s at 3600 rpm)

  Q_FUEL: 1620, // MW fuel heat input (LHV) at MCR - design heat balance (design.js)
  GAS_LHV: 49, // MJ/kg natural gas (lower heating value)
  GAS_FLOW_FULL: 33.06, // kg/s natural gas at MCR (119 t/h)
  GFCV_K: 16.7, // kg/s per MPa(a) supply pressure at 100 % gas control valve (choked)
  BURNER_K: 0.65, // kg/s per sqrt(kPa) burner header pressure per elevation
  GAS_HDR_C: 0.14, // kg/kPa gas header storage
  AIR_PER_MW: 0.35, // kg/s stoichiometric air per MW fuel (natural gas ~17.2 kg/kg)
  AIR_FULL: 624.1, // kg/s combustion air at MCR (12 % excess air, 2.0 % O2 wet)
  GAS_FULL: 657.2, // kg/s flue gas through the boiler at MCR

  MS_FLOW: 607, // kg/s main steam at MCR (2185 t/h) - design heat balance throttle flow
  MS_P: 16.7, // MPa(g) rated throttle pressure
  MS_T: 538,
  RH_T: 538,
  DRUM_P: 18.2, // MPa(a) drum pressure at MCR
  SH_DP: 1.4, // MPa superheater pressure drop (drum - throttle) at MCR
  FW_T: 275,

  DRUM_VREF: 120, // m3 drum + riser water volume at normal water level
  DRUM_AREA: 80, // m2 effective level area
  DRUM_METAL_C: 750000, // kJ/K
  SH1_C: 160000,
  SH2_C: 120000,
  RH_C: 130000,
  UA_SH1: 0.464, // MW/K at design gas flow
  UA_SH2: 0.421,
  UA_RH: 0.5,
  FEGT_DES: 1150,

  K_GV: 39.5, // kg/s per MPa at 100 % GV
  K_ICV: 136,
  HPB_CAP: 240, // kg/s at rated pressure (40 %)
  LPB_CAP: 230,
  RH_C_MASS: 850, // kg/MPa reheater steam storage

  X_HP_EXT: 0.09, // HP exhaust extraction fraction (HP heater)
  X_IP_EXT: 0.14, // IP extractions (HP heater + deaerator)
  X_LP_EXT: 0.15, // LP extractions (LP heaters)
  ETA_HP: 0.86,
  ETA_IP: 0.9,
  ETA_LP: 0.75,
  K_PWR: 0.983, // calibration so that 597 kg/s gives ~700 MW gross

  CW_PUMP_FLOW: 10500, // kg/s per CW pump
  COND_UA: 121850, // kW/K
  HW_KG_PER_MM: 100,
  DA_AREA: 80,
});

/** Motor data: start time [s], rated power [kW]. */
export const MOTOR_DATA = {
  CWP_A: { start: 15, kw: 3200 },
  CWP_B: { start: 15, kw: 3200 },
  CEP_A: { start: 5, kw: 1600 },
  CEP_B: { start: 5, kw: 1600 },
  BFP_A: { start: 8, kw: 10500 },
  BFP_B: { start: 8, kw: 10500 },
  BFP_C: { start: 8, kw: 10500 },
  VP_A: { start: 3, kw: 160 },
  VP_B: { start: 3, kw: 160 },
  AOP: { start: 3, kw: 110 },
  EOP: { start: 2, kw: 40 },
  JOP: { start: 3, kw: 90 },
  TG: { start: 3, kw: 55 },
  APH_A: { start: 5, kw: 30 },
  APH_B: { start: 5, kw: 30 },
  ID_A: { start: 20, kw: 5000 },
  ID_B: { start: 20, kw: 5000 },
  FD_A: { start: 12, kw: 2500 },
  FD_B: { start: 12, kw: 2500 },
};

/** Modulating actuators: demand tag, stroke rate [%/s or deg/s], limits. */
export const ACTUATORS = {
  GV: { dmd: 'GV_DMD', rate: 25 },
  ICV: { dmd: 'ICV_DMD', rate: 25 },
  HPB: { dmd: 'HPB_DMD', rate: 15 },
  LPB: { dmd: 'LPB_DMD', rate: 15 },
  FCV: { dmd: 'FCV_DMD', rate: 6 },
  DA_CV: { dmd: 'DA_CV_DMD', rate: 5 },
  MAKEUP: { dmd: 'MAKEUP_DMD', rate: 5 },
  PEG: { dmd: 'PEG_DMD', rate: 5 },
  CBD: { dmd: 'CBD_DMD', rate: 2 },
  SH_SPRAY: { dmd: 'SH_SPRAY_DMD', rate: 6 },
  RH_SPRAY: { dmd: 'RH_SPRAY_DMD', rate: 6 },
  TILT: { dmd: 'TILT_DMD', rate: 1, min: -30, max: 30 },
  FD_A_PITCH: { dmd: 'FD_A_PITCH_DMD', rate: 5 },
  FD_B_PITCH: { dmd: 'FD_B_PITCH_DMD', rate: 5 },
  ID_A_VANE: { dmd: 'ID_A_VANE_DMD', rate: 5 },
  ID_B_VANE: { dmd: 'ID_B_VANE_DMD', rate: 5 },
  GFCV: { dmd: 'GFCV_DMD', rate: 10 },
  BFP_A_SCOOP: { dmd: 'BFP_A_SPD_DMD', rate: 4 },
  BFP_B_SCOOP: { dmd: 'BFP_B_SPD_DMD', rate: 4 },
  BFP_C_SCOOP: { dmd: 'BFP_C_SPD_DMD', rate: 4 },
};

/** On/off valves: command tag, open time [s], close time [s]. */
export const ONOFF_VALVES = {
  MSV: { cmd: 'MSV_CMD', open: 4, close: 0.15 },
  RSV: { cmd: 'RSV_CMD', open: 4, close: 0.15 },
  EBD: { cmd: 'EBD_CMD', open: 10, close: 10 },
  SH_VENT: { cmd: 'SH_VENT_CMD', open: 8, close: 8 },
  GLAND: { cmd: 'GLAND_CMD', open: 5, close: 5 },
  VB: { cmd: 'VB_CMD', open: 5, close: 5 },
  HPH: { cmd: 'HPH_CMD', open: 20, close: 3 },
  SPRAY_BLOCK: { cmd: 'SPRAY_BLOCK_CMD', open: 10, close: 10 },
  HW_DUMP: { cmd: 'HW_DUMP_CMD', open: 8, close: 8 },
  MGTV: { cmd: 'MGTV_CMD', open: 3, close: 0.5 },
  GAS_VENT: { cmd: 'GAS_VENT_CMD', open: 1, close: 1 },
  BRN_A: { cmd: 'BRN_A_CMD', open: 2, close: 0.5 },
  BRN_B: { cmd: 'BRN_B_CMD', open: 2, close: 0.5 },
  BRN_C: { cmd: 'BRN_C_CMD', open: 2, close: 0.5 },
  BRN_D: { cmd: 'BRN_D_CMD', open: 2, close: 0.5 },
};
