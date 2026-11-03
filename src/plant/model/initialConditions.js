import * as st from '../../common/steam.js';
import { clamp } from '../../common/blocks.js';
import { ELEVS } from '../../maps/plant.js';
import { DES } from './constants.js';
import { defaultState } from './PlantModel.js';
import { design, fuelAnalysis, HEATERS, SPEC_HUM, stodolaPin } from './design.js';
import { combustion as CB } from '../calc/index.js';

const P_ATM = st.P_ATM;

/** Built-in initial conditions. Slots 10..19 are free for instructor snapshots. */
export const IC_LIST = [
  { id: 1, name: 'Cold shutdown', desc: 'Unit cold, drum filled to start-up level, turbine on barring gear, AOP running' },
  { id: 2, name: 'Hot standby', desc: 'Boiler at 60 bar firing gas elevation A on HP/LP bypass, vacuum established, turbine on barring gear' },
  { id: 3, name: 'FSNL - ready to sync', desc: 'Turbine at 3600 rpm full speed no load, field breaker closed, ready for synchronising' },
  { id: 4, name: '50 % load (350 MW)', desc: 'Unit on line at 350 MW, 3 gas elevations, coordinated control, sliding pressure' },
  { id: 5, name: '100 % load (700 MW)', desc: 'Unit on line at MCR, 4 gas elevations, coordinated control' },
];

/** Sliding-pressure program shared with the CCS: unit load [%] -> throttle pressure [MPa(g)]. */
export function slidingPressure(loadPct) {
  if (loadPct <= 30) return 9.0;
  if (loadPct >= 90) return 16.7;
  return 9.0 + ((loadPct - 30) / 60) * 7.7;
}

function setRun(s, names, run = true) {
  for (const n of names) s.mot[n] = { run, trip: false, startT: 0 };
}

/** Puts the given burner elevations in service at a total firing rate qFuel [MW]. */
function gasFiring(s, elevs, qFuel) {
  const m = qFuel / DES.GAS_LHV;
  s.v.MGTV = 1;
  s.v.GAS_VENT = 0;
  for (const x of elevs) {
    s.v[`BRN_${x}`] = 1;
    s.flame[x] = true;
  }
  s.gasHdr = (m / (DES.BURNER_K * elevs.length)) ** 2;
  s.act.GFCV = clamp((m / (DES.GFCV_K * (s.gasSup + P_ATM))) * 100, 0, 100);
  s.qLag = qFuel;
}

/** Heaters without extraction steam: condensate at hotwell temperature, feedwater at the BFP outlet. */
function idleHeaters(s) {
  for (const n of HEATERS) {
    const t = n.startsWith('HPH') ? s.Tda + 3 : s.Tc + 0.3;
    s.htr[n] = { tOut: t, drainT: t, ext: 0 };
  }
}

function levelMass(s, level, swell = 0) {
  const v = DES.DRUM_VREF + ((level - swell) / 1000) * DES.DRUM_AREA;
  return v * st.rhoLiq(s.Td);
}

export function coldState() {
  const s = defaultState();
  setRun(s, ['AOP', 'JOP', 'TG']);
  s.tgEng = true;
  s.n = 4;
  s.loP = 0.17;
  s.Mw = levelMass(s, -150);
  s.Mda = 2.0 * DES.DA_AREA * st.rhoLiq(s.Tda);
  return s;
}

function commonHot(s) {
  setRun(s, ['CWP_A', 'CWP_B', 'CEP_A', 'VP_A', 'VP_B', 'AOP', 'APH_A', 'APH_B', 'ID_A', 'ID_B', 'FD_A', 'FD_B']);
  s.v.GLAND = 1;
  s.v.HPH = 1;
  s.mcw = 2 * DES.CW_PUMP_FLOW;
  s.Pair = 0.2;
  s.Tc = 36;
  s.loP = 0.17;
  s.loT = 40;
  s.idRun = { A: 1, B: 1 };
  s.Pf = -100;
}

export function hotStandbyState() {
  const s = defaultState();
  commonHot(s);
  setRun(s, ['BFP_A', 'JOP', 'TG']);
  s.tgEng = true;
  s.n = 4;
  s.Td = st.tsat(6.0);
  s.Mw = levelMass(s, -50, 15);
  s.swell = 15;
  s.hEco = st.hLiq(250);
  s.Tsh1 = 400;
  s.Tsh2 = 430;
  s.Trh = 400;
  s.Prh = 1.0;
  s.Pcross = 0.01;
  s.Pda = 0.3;
  s.Tda = st.tsat(0.3);
  s.Tfw = s.Tda + 3;
  idleHeaters(s);
  s.Mda = 2.0 * DES.DA_AREA * st.rhoLiq(s.Tda);
  s.Thp = 380;
  s.Tip = 360;
  s.bow = 10;
  gasFiring(s, ['A'], 147);
  s.v.SPRAY_BLOCK = 0;
  Object.assign(s.act, { HPB: 40, LPB: 70, FCV: 18, DA_CV: 12, PEG: 40, BFP_A_SCOOP: 35, ICV: 0, GV: 0 });
  Object.assign(s.act, { FD_A_PITCH: 30, FD_B_PITCH: 30, ID_A_VANE: 32, ID_B_VANE: 32 });
  s.fdFlow = { A: 400 * (0.06 + 0.94 * 0.3), B: 400 * (0.06 + 0.94 * 0.3) };
  s.airFlow = s.fdFlow.A + s.fdFlow.B + 12;
  s.bfpN.A = 1500 + 3900 * 0.35;
  s.fegt = 530;
  s.o2 = 17;
  return s;
}

export function fsnlState() {
  const s = hotStandbyState();
  setRun(s, ['JOP', 'TG'], false);
  s.tgEng = false;
  s.n = DES.RPM;
  s.Td = st.tsat(8.2);
  s.Mw = levelMass(s, -30, 25);
  s.swell = 25;
  s.Tsh1 = 430;
  s.Tsh2 = 460;
  s.Trh = 430;
  s.Thp = 420;
  s.Tip = 400;
  s.v.MSV = 1;
  s.v.RSV = 1;
  s.fcb = true;
  s.If = 1.0;
  s.flux = 1.0;
  s.bow = 8;
  gasFiring(s, ['A'], 178);
  Object.assign(s.act, { GV: 2.8, ICV: 4.2, HPB: 35, LPB: 45, FCV: 22, BFP_A_SCOOP: 45 });
  s.bfpN.A = 1500 + 3900 * 0.45;
  return s;
}

/**
 * Approximate steady state at a fraction L of MCR from the design heat balance (design.js)
 * scaled to the load; the controllers settle the remainder.
 */
export function loadState(L) {
  const D = design();
  const c = D.cycle;
  const T = D.turbine;
  const s = defaultState();
  commonHot(s);
  const nElev = L > 0.75 ? 4 : L > 0.45 ? 3 : L > 0.2 ? 2 : 1;
  const elevsOn = ELEVS.slice(0, nElev);
  const nBfp = L > 0.45 ? 2 : 1;
  setRun(s, nBfp === 2 ? ['BFP_A', 'BFP_B'] : ['BFP_A']);
  setRun(s, ['AOP'], false);

  const pms = slidingPressure(L * 100) + P_ATM;
  const mMs = T.Wdes * L;
  const pd = pms + DES.SH_DP * L * L * (DES.DRUM_P / Math.max(pms + DES.SH_DP * 0.5, 1));
  s.Td = st.tsat(pd);
  const swell = (60 * ((mMs - 25 * L) / 572) * Math.sqrt(st.rhof(pd) / st.rhog(pd))) / 1.93;
  s.swell = swell;
  s.Mw = levelMass(s, 0, swell);
  s.mOutLag = mMs;
  s.PdPrev = pd;
  s.Tsh1 = D.gas.tsh1 - 15 * (1 - L);
  s.Tsh2 = DES.MS_T;
  s.Trh = L >= 0.5 ? DES.RH_T : 515;

  // Turbine stage pressures (stage flow coefficients at the scaled flows)
  s.Tc = D.condenser.tsat - (D.condenser.tsat - 25) * (1 - L) * 0.7;
  s.Pair = 0.15;
  const pc = st.psat(s.Tc);
  s.Pcross = T.P.cross * L + pc * (1 - L);
  const mBowl = c.Wbowl * L;
  const pBowl = stodolaPin(T.kIp, mBowl, s.Pcross, T.pvDes.ip);
  s.Prh = pBowl / 0.98;
  s.Pda = Math.max(P_ATM + 0.05, 0.92 * s.Pcross);
  s.Tda = st.tsat(s.Pda);
  s.Mda = 2.0 * DES.DA_AREA * st.rhoLiq(s.Tda);
  s.extDA = c.W5 * L;
  // Feedwater heaters at the scaled extraction pressures
  for (const n of HEATERS) {
    const h = D.heaters[n];
    const tsat = st.tsat(h.Psh * Math.max(0.15, L));
    const ttd = h.tsat - h.tOut;
    const tIn = h.nv.fwInT;
    s.htr[n] = { tOut: tsat - ttd, drainT: (tIn - 32) / 1.8 + 5.6 - (h.tsat - tsat) * 0.9, ext: h.We * L };
  }
  s.Tfw = s.htr.HPH7.tOut;
  s.hEco = st.hLiq(s.Tfw) + 100 * L;
  s.Thp = 515;
  s.Tip = 515;
  s.bow = 8;
  s.n = DES.RPM;
  s.loP = 0.2;
  s.loT = 46;
  s.brgT = s.brgT.map((_, i) => 46 + 30 + 4 * (i % 3));

  // Combustion
  const qFuel = DES.Q_FUEL * L * (1 + 0.05 * (1 - L));
  const gas = qFuel / DES.GAS_LHV;
  gasFiring(s, elevsOn, qFuel);
  const ea = 0.12 + 0.25 * (1 - L);
  const air = gas * (DES.AIR_FULL / DES.GAS_FLOW_FULL) * ((1 + ea) / 1.1167);
  const fd = (air - 12) / 2;
  const pitch = clamp(((fd / 400 - 0.06) / 0.94) * 100, 5, 100);
  Object.assign(s.act, { FD_A_PITCH: pitch, FD_B_PITCH: pitch });
  s.fdFlow = { A: fd, B: fd };
  s.airFlow = air;
  s.o2 = CB.flueGasFromExcessAir(fuelAnalysis(DES.GAS_LHV), ea * 100, { specHum: SPEC_HUM }).WetO2PctVol;
  const flue = air + gas;
  const idEach = flue / 2 / (520 * (1 - 100 / 2500));
  const vane = clamp(((idEach - 0.04) / 0.96) * 100, 5, 100);
  Object.assign(s.act, { ID_A_VANE: vane, ID_B_VANE: vane });
  s.fegt = D.gas.fegt - 250 * (1 - L);
  s.tAirHot = D.gas.tAirOut - 40 * (1 - L);
  s.qRad = (D.gas.duties.qWW / (1 - D.gas.platenFrac)) * L * (1 + 0.1 * (1 - L));

  // Turbine valves (governor valves into the first stage: pressure ratio from the stage flow coefficients)
  const tf = Math.sqrt(811 / (s.Tsh2 + 273));
  const p1 = (T.P.first * mMs) / T.Wdes;
  const ratio = p1 / pms;
  const phiR = ratio <= 0.55 ? 1 : Math.sqrt(Math.max(0.05, 1 - ((ratio - 0.55) / 0.45) ** 2));
  s.act.GV = clamp((mMs / (T.kGv * pms * tf * phiR)) * 100, 5, 100);
  s.act.ICV = 100;
  s.v.MSV = 1;
  s.v.RSV = 1;
  s.v.SPRAY_BLOCK = 1;

  // Feedwater
  const spray = 25 * L;
  const qMain = mMs - spray;
  s.act.FCV = 75;
  const ph = pd + 0.4 + 1.5 * (qMain / (700 * 0.75)) ** 2;
  const ps = s.Pda + 0.25;
  const qPump = mMs / nBfp;
  const nn = Math.sqrt((ph - ps + 3.5e-5 * qPump * qPump) / 26);
  const scoop = clamp(((nn * 5000 - 1500) / 3900) * 100, 0, 100);
  for (let i = 0; i < nBfp; i++) {
    const p = ['A', 'B'][i];
    s.act[`BFP_${p}_SCOOP`] = scoop;
    s.bfpN[p] = nn * 5000;
  }
  s.act.SH_SPRAY = clamp((spray / (60 * Math.sqrt(Math.max(0.5, ph - pms) / 4))) * 100, 0, 100);
  const dpAvail = 3.2 - (s.Pda - P_ATM) - 0.3;
  s.act.DA_CV = clamp(((c.Wc * L) / (650 * Math.sqrt(dpAvail / 2.2))) * 100, 5, 100);
  s.act.MAKEUP = 2;

  // Generator on line
  const mw = DES.MW * L;
  s.Pe = mw;
  const P = mw / DES.MVA;
  const Q = 0.25 * P + 0.05;
  s.If = Math.hypot(P, 1 + Q);
  s.fcb = true;
  s.gcb = true;
  s.gcbCmdPrev = true;
  s.Tst = 40 + 62 * L * L;
  s.Trot = 40 + 65 * (s.If / 1.75) ** 2;
  return s;
}

export function builtInState(id) {
  switch (id) {
    case 1:
      return coldState();
    case 2:
      return hotStandbyState();
    case 3:
      return fsnlState();
    case 4:
      return loadState(0.5);
    case 5:
      return loadState(1.0);
    default:
      return null;
  }
}
