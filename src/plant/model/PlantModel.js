import * as st from '../../common/steam.js';
import { clamp, median3, gauss } from '../../common/blocks.js';
import { ELEVS, MOTORS, BEARINGS } from '../../maps/plant.js';
import { DES, MOTOR_DATA, ACTUATORS, ONOFF_VALVES } from './constants.js';
import {
  design, fuelAnalysis, SPEC_HUM, NV_BOILER, HEATERS, gasH, gasT, gasSection, sectionUA, airHeaterHX, ahUA, flame, availEnergy, stodolaPin,
  toF, toC, toPsia, toKpph, toKgs, toKj,
} from './design.js';
import { combustion as CB, furnace as FN, turbine as TB, generator as GN, condenser as CD, fwh as FW, airheater as AH, boiler as BL, pumps as PU } from '../etapro/index.js';
import { PerformanceMonitor } from './performance.js';

/**
 * Process model of the unit. The process equations are the EtaPRO calculation templates
 * (src/plant/etapro) and the constants come from the design heat balance (design.js):
 *
 *   combustion       template 3 combustion analysis, excess air from the air / fuel ratio (3010)
 *   furnace          3680 adiabatic flame temperature, 3690 radiant absorption and exit gas temperature
 *   convective pass  3305 flue gas enthalpy, 3650 section heat transfer (clean htc ~ W^0.6 GIT^0.6)
 *   air heater       3800 / 3810 X-ratio and effectiveness, 3830 / 3903 leakage
 *   turbine          2080 stage flow factors (Stodola form), 2340 / 2350 / 2200 section efficiencies,
 *                    ELEP / UEEP with exhaust loss, 2221 stage power, 2520 / 2530 losses
 *   feedwater heaters 2990 Tsou zone model, 2900 / 2910 heater balances
 *   condenser        2690 HEI (cleanliness, CW temperature correction, tube velocity)
 *   pumps / fans     4120 / 4220, 7400 - 7402
 *
 * The dynamic states (storage of mass and energy) are integrated every step; the iterative
 * template calculations that set slowly varying quantities (expansion line, heater outlet
 * temperatures, condenser saturation) run in a slower loop.
 */

const P_ATM = st.P_ATM;
const TWO_PI = 2 * Math.PI;
const D = design();
const TD = D.turbine;
const GD = D.gas;
const LB = 2.20462262;
const SLOW_DT = 0.5; // s, period of the template (iterative) calculations
// Burner tilt moves the flame centre (3690 burner height): 0.015 of the furnace height per degree,
// +-0.45 at +-30 deg, i.e. about 1 K reheat temperature per degree at full load.
const TILT_X = 0.015;
const M_ECO = 60000; // kg economizer water inventory
// Casing / penthouse loss of a superheater or reheater section [MW/K]: about 1.5 MW each at full load
// (part of the template 3120 radiation loss), a cooling time constant of hours when boxed up.
const AMB_LOSS = 0.003;
const HTR_DES = Object.fromEntries(HEATERS.map((n) => [n, FW.heaterDesign(D.heaters[n].nv)]));
const LP_HTRS = ['LPH1', 'LPH2', 'LPH3', 'LPH4'];
/** Pure air (as a "flue gas" composition) for unfired gas paths. */
const FG_AIR = CB.flueGasFromExcessAir(fuelAnalysis(DES.GAS_LHV), 1e5, { specHum: SPEC_HUM });
/** Boiler feed pump (EtaPRO pump form): rated speed and curve at rated speed. */
const BFP_NV = { speed: 5000, bepFlow: 320, bepEff: 82 };
const FAN = {
  FD: { dp: 16, eff: 0.84, dens: 1.16 }, // inH2O total pressure rise at design flow, efficiency, kg/m3
  ID: { dp: 28, eff: 0.8, dens: 0.87 },
};

/** Critical flow function of a steam valve (choked below r = 0.55). */
function phi(r) {
  if (!(r < 1)) return 0;
  if (r <= 0.55) return 1;
  const x = (r - 0.55) / 0.45;
  return Math.sqrt(Math.max(0, 1 - x * x));
}

const lagTo = (cur, target, tau, dt) => cur + (target - cur) * Math.min(1, dt / Math.max(tau, 1e-6));
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
/** Expansion end point [kJ/kg] at Pout from (h, s) at enthalpy-drop efficiency eta (template 2140). */
const expand = (h, s, Pout, eta) => h - eta * (h - st.hPS(Pout, s));
/** Efficiency fall-off of a stage group at very low volumetric flow (ventilation). */
const lowFlow = (r) => clamp(r / 0.04, 0, 1) ** 0.5;
/** Liquid temperature [C] at P from h (saturated-liquid estimate and one Newton step on region 1). */
function tLiqP(P, h) {
  const ts = st.tsat(P);
  if (h >= st.hf(P)) return ts;
  const T = Math.min(st.tLiq(h), ts - 0.01);
  const w = st.water(P, T);
  return Math.min(ts - 0.01, T + (h - w.h) / Math.max(1, w.cp));
}

function heaterStates(amb) {
  const o = {};
  for (const n of HEATERS) o[n] = { tOut: amb, drainT: amb, ext: 0 };
  return o;
}

/** A fresh, completely cold and de-energised plant state. */
export function defaultState() {
  const mot = {};
  for (const [name] of MOTORS) mot[name] = { run: false, trip: false, startT: 0 };
  const act = {};
  for (const [name, a] of Object.entries(ACTUATORS)) act[name] = a.min !== undefined && a.min < 0 ? 0 : 0;
  const v = {};
  for (const name of Object.keys(ONOFF_VALVES)) v[name] = 0;
  const amb = 30;
  return {
    version: 2,
    t: 0,
    mot,
    act,
    v,
    // environment
    fg: DES.FREQ,
    vg: 1,
    cwIn: 25,
    amb,
    // boiler
    Td: amb,
    Mw: (DES.DRUM_VREF - 12) * st.rhoLiq(amb),
    hEco: st.hLiq(amb),
    Tsh1: amb,
    Tsh2: amb,
    Trh: amb,
    TmDrumDT: 0,
    dTdLag: 0,
    swell: 0,
    dPdtLag: 0,
    PdPrev: P_ATM,
    mOutLag: 0,
    svLift: false,
    Prh: P_ATM,
    Pcross: P_ATM,
    // combustion
    Pf: 0,
    gasSup: 3.0,
    gasHdr: 0,
    flame: Object.fromEntries(ELEVS.map((x) => [x, false])),
    ign: Object.fromEntries(ELEVS.map((x) => [x, false])),
    ignT: Object.fromEntries(ELEVS.map((x) => [x, 0])),
    fdFlow: { A: 0, B: 0 },
    idRun: { A: 0, B: 0 },
    airFlow: 0,
    o2: 20.9,
    unburned: 0,
    puffT: 0,
    qLag: 0,
    qRad: 0,
    fegt: amb,
    tAirHot: amb,
    // feedwater / condensate
    bfpN: { A: 0, B: 0, C: 0 },
    Mhw: 800 * DES.HW_KG_PER_MM,
    Mda: 2000e-3 * DES.DA_AREA * 995,
    Pda: P_ATM,
    Tda: amb,
    Tfw: amb,
    Tc: amb - 5,
    Pair: 101.3 - st.psat(amb - 5) * 1000,
    mcw: 0,
    htr: heaterStates(amb),
    extDA: 0,
    // turbine
    n: 0,
    tgEng: false,
    mechOS: false,
    Thp: amb,
    Tip: amb,
    bow: 10,
    vibKick: 0,
    loP: 0,
    loT: amb,
    brgT: BEARINGS.map(() => amb),
    tgJopLowT: 0,
    // generator
    If: 0,
    fcb: false,
    gcb: false,
    gcbCmdPrev: false,
    phase: 0,
    oopT: 0,
    oosT: 0,
    Tst: amb,
    Trot: amb,
    Pe: 0,
    // bookkeeping
    hpbSpray: 0,
    lowDaT: { A: 0, B: 0, C: 0 },
    lowHwT: { A: 0, B: 0 },
  };
}

export class PlantModel {
  constructor(state = defaultState()) {
    this.s = state;
    this.f = {}; // per-step derived values (not part of the persistent state)
    this.flicker = { t: 0, on: true };
    this.perf = new PerformanceMonitor();
    this.prime();
  }

  setState(s) {
    // Merge onto a default state so snapshots from older versions still load.
    const base = defaultState();
    for (const [k, v] of Object.entries(s)) {
      base[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? { ...base[k], ...v } : v;
    }
    this.s = base;
    this.f = {};
    this.perf = new PerformanceMonitor();
    this.prime();
  }

  /** Command inputs that hold the current state (used to prime derived values). */
  inputsFromState() {
    const s = this.s;
    const u = {};
    for (const [n] of MOTORS) u[`${n}_CMD`] = s.mot[n].run;
    for (const a of Object.keys(ACTUATORS)) u[ACTUATORS[a].dmd] = s.act[a];
    for (const [n, v] of Object.entries(ONOFF_VALVES)) u[v.cmd] = s.v[n] > 0.5;
    u.MFT_TRIP = !Object.values(s.flame).some(Boolean) && !(s.v.MGTV > 0.5);
    for (const x of ELEVS) u[`IGN_${x}_CMD`] = false;
    u.GAS_SUPPLY_SET = s.gasSup * 10;
    u.TURB_TRIP = !(s.v.MSV > 0.5);
    u.FCB_CMD = s.fcb;
    u.GCB_CMD = s.gcb;
    u.EXC_DMD = s.If;
    u.GRID_FREQ_SET = s.fg;
    u.GRID_KV_SET = s.vg * DES.GRID_KV;
    u.CW_INLET_T_SET = s.cwIn;
    u.AMBIENT_T_SET = s.amb;
    return u;
  }

  /** Evaluates all algebraic quantities for the current state without advancing time. */
  prime() {
    const u = this.inputsFromState();
    for (let i = 0; i < 12; i++) {
      this.slowAcc = SLOW_DT;
      this.step(0, u);
    }
  }

  /** Advances the model by dt seconds of simulation time with command inputs u. */
  step(dt, u) {
    this.lastInputs = u;
    const s = this.s;
    s.t += dt;
    this.slowAcc = (this.slowAcc ?? SLOW_DT) + dt;
    this.#environment(dt, u);
    this.#protection(dt, u);
    this.#motors(dt, u);
    this.#valves(dt, u);
    this.#actuators(dt, u);
    this.#combustion(dt, u);
    this.#feedwater(dt);
    this.#boiler(dt, u);
    this.#turbine(dt);
    if (this.slowAcc >= SLOW_DT) {
      this.#templates(this.slowAcc, u);
      this.slowAcc = 0;
    }
    this.#heaters(dt);
    this.#condensate(dt, u);
    this.#generator(dt, u);
    this.#auxiliaries(dt, u);
  }

  // ------------------------------------------------------------------ environment
  #environment(dt, u) {
    const s = this.s;
    const fSet = clamp(u.GRID_FREQ_SET ?? DES.FREQ, DES.FREQ * 0.9, DES.FREQ * 1.1);
    s.fg += clamp(fSet - s.fg, -0.05 * dt, 0.05 * dt);
    const vSet = clamp((u.GRID_KV_SET ?? 400) / DES.GRID_KV, 0.8, 1.2);
    s.vg = lagTo(s.vg, vSet, 5, dt);
    s.cwIn = lagTo(s.cwIn, clamp(u.CW_INLET_T_SET ?? 25, 5, 40), 60, dt);
    s.amb = lagTo(s.amb, clamp(u.AMBIENT_T_SET ?? 30, -10, 55), 60, dt);
    this.f.lhv = clamp(u.GAS_LHV_SET ?? DES.GAS_LHV, 30, 55);
  }

  // ------------------------------------------------------------------ hardwired protection
  #protection(dt, u) {
    const f = this.f;
    f.mftHW = !!u.MFT_TRIP || !!u._bmsWdFail;
    if (this.s.n > DES.RPM * 1.11) this.s.mechOS = true;
    if (this.s.mechOS && this.s.n < DES.RPM * 0.95) this.s.mechOS = false;
    f.turbTripHW = !!u.TURB_TRIP || !!u._dehWdFail || this.s.mechOS;
    // Hydraulic OPC dump (EH system): above 103 % speed the governor and intercept valves are
    // dumped closed until the speed is back below 101 %, independent of the DEH scan rate.
    if (!this.s.gcb && this.s.n > DES.RPM * 1.03) this.s.opcHw = true;
    if (this.s.opcHw && (this.s.n < DES.RPM * 1.01 || this.s.gcb)) this.s.opcHw = false;
  }

  // ------------------------------------------------------------------ motors
  #motorFault(name, u) {
    const s = this.s;
    switch (name) {
      case 'BFP_A':
      case 'BFP_B':
      case 'BFP_C': {
        const p = name.slice(-1);
        if (name === 'BFP_A' && u.MF_BFP_A_TRIP) return true;
        return s.lowDaT[p] > 3;
      }
      case 'CEP_A':
        if (u.MF_CEP_A_TRIP) return true;
        return s.lowHwT.A > 5;
      case 'CEP_B':
        return s.lowHwT.B > 5;
      case 'CWP_A':
        return !!u.MF_CWP_A_TRIP;
      case 'ID_A':
        return !!u.MF_ID_A_TRIP;
      case 'FD_A':
        return !!u.MF_FD_A_TRIP;
      case 'AOP':
        return !!u.MF_AOP_FAIL;
      case 'TG':
        return s.tgJopLowT > 15 || (s.loP < 0.04 && s.mot.TG.run);
      default:
        return false;
    }
  }

  #motors(dt, u) {
    const s = this.s;
    for (const [name] of MOTORS) {
      const m = s.mot[name];
      const cmd = !!u[`${name}_CMD`];
      const fault = this.#motorFault(name, u);
      if (fault && (m.run || m.startT > 0 || cmd)) {
        if (m.run || m.startT > 0) m.trip = true;
        else if (cmd && !m.trip) m.trip = true; // start attempt into an active fault
      }
      if (m.trip) {
        m.run = false;
        m.startT = 0;
        if (!cmd && !fault) m.trip = false;
        continue;
      }
      // Turning gear motor only runs while the rotor is at or below turning speed.
      const allowed = name !== 'TG' || s.n < 10;
      if (cmd && allowed) {
        if (!m.run) {
          m.startT += dt;
          if (m.startT >= MOTOR_DATA[name].start) {
            m.run = true;
            m.startT = 0;
          }
        }
      } else {
        m.run = false;
        m.startT = 0;
      }
    }
    // protective timers evaluated with the latest process values
    const daLvl = this.f.daLevel ?? 2000;
    for (const p of ['A', 'B', 'C']) s.lowDaT[p] = s.mot[`BFP_${p}`].run && daLvl < 600 ? s.lowDaT[p] + dt : 0;
    const hwLvl = s.Mhw / DES.HW_KG_PER_MM;
    for (const p of ['A', 'B']) s.lowHwT[p] = s.mot[`CEP_${p}`].run && hwLvl < 150 ? s.lowHwT[p] + dt : 0;
    s.tgJopLowT = s.mot.TG.run && !s.mot.JOP.run ? s.tgJopLowT + dt : 0;
  }

  // ------------------------------------------------------------------ on/off valves
  #valves(dt, u) {
    const s = this.s;
    const f = this.f;
    for (const [name, def] of Object.entries(ONOFF_VALVES)) {
      let want = !!u[def.cmd];
      if ((name === 'MSV' || name === 'RSV') && f.turbTripHW) want = false;
      // The master fuel trip relay de-energises all gas shut-off valves and opens the vent.
      if ((name === 'MGTV' || name.startsWith('BRN_')) && f.mftHW) want = false;
      if (name === 'GAS_VENT' && f.mftHW) want = true;
      if (name === 'HPH' && u.MF_HPH_TRIP) want = false;
      const rate = dt / (want ? def.open : def.close);
      s.v[name] = clamp(s.v[name] + (want ? rate : -rate), 0, 1);
    }
  }

  // ------------------------------------------------------------------ modulating actuators
  #actuators(dt, u) {
    const s = this.s;
    const f = this.f;
    for (const [name, def] of Object.entries(ACTUATORS)) {
      const lo = def.min ?? 0;
      const hi = def.max ?? 100;
      let target = clamp(Number(u[def.dmd] ?? s.act[name]) || 0, lo, hi);
      let rate = def.rate;
      if (name === 'GV' || name === 'ICV') {
        if (f.turbTripHW || s.opcHw) {
          target = 0;
          rate = 500;
        } else if (target < s.act[name]) rate = 200; // EH actuators close fast
      }
      if (name === 'SH_SPRAY' && u.MF_SH_SPRAY_STUCK) continue;
      if (name === 'FCV' && u.MF_FW_CV_STUCK) continue;
      if (name === 'GFCV' && u.MF_GFCV_STUCK) continue;
      const d = target - s.act[name];
      s.act[name] += clamp(d, -rate * dt, rate * dt);
    }
  }

  // ------------------------------------------------------------------ combustion & draft
  #combustion(dt, u) {
    const s = this.s;
    const f = this.f;
    const lhv = f.lhv;

    // Natural gas supply and fuel train (SSV1 + SSV2 = MGTV, vent between them, flow control valve)
    const supplySet = clamp((Number(u.GAS_SUPPLY_SET) || 30) / 10, 0.3, 5) * (u.MF_GAS_PRESS_LOW ? 0.36 : 1);
    s.gasSup = lagTo(s.gasSup, supplySet, u.MF_GAS_PRESS_LOW ? 25 : 10, dt);
    const pSupAbs = s.gasSup + P_ATM;
    const mValve = DES.GFCV_K * s.v.MGTV * (s.act.GFCV / 100) * pSupAbs; // choked flow, kg/s
    const brnSum = ELEVS.reduce((a, x) => a + s.v[`BRN_${x}`], 0);
    const kOut = DES.BURNER_K * brnSum + (s.v.GAS_VENT > 0.5 ? 1.5 : 0);
    if (kOut > 0.02) {
      const pss = Math.min((mValve / kOut) ** 2, s.gasSup * 1000);
      s.gasHdr = lagTo(s.gasHdr, pss, 1.5, dt);
    } else {
      // Closed header: fills through the control valve, protected by a relief valve at 120 kPa.
      s.gasHdr = Math.min(120, s.gasHdr + (mValve / DES.GAS_HDR_C) * dt);
      s.gasHdr = lagTo(s.gasHdr, 0, 900, dt);
    }
    s.gasHdr = clamp(s.gasHdr, 0, s.gasSup * 1000);
    f.mValve = mValve;

    // Burner elevations
    this.flicker.t -= dt;
    if (this.flicker.t <= 0) {
      this.flicker.t = 0.5;
      this.flicker.on = Math.random() > 0.35;
    }
    const airOk = s.airFlow > 0.12 * DES.AIR_FULL;
    let burn = 0;
    let unburned = 0;
    let gasTotal = 0;
    f.gasElev = {};
    for (const x of ELEVS) {
      const flow = DES.BURNER_K * s.v[`BRN_${x}`] * Math.sqrt(Math.max(0, s.gasHdr));
      f.gasElev[x] = flow;
      gasTotal += flow;
      const ignOk = !!u[`IGN_${x}_CMD`] && !f.mftHW && airOk && !(x === 'C' && u.MF_IGN_FAIL_C);
      s.ignT[x] = ignOk ? s.ignT[x] + dt : 0;
      s.ign[x] = s.ignT[x] > 2;
      const stable = s.gasHdr > 8;
      let flame = flow > 0.05 && airOk && stable && (s.ign[x] || s.flame[x]);
      if (x === 'B' && u.MF_FLAME_LOSS_B && flame) flame = this.flicker.on || s.ign[x];
      s.flame[x] = flame;
      if (flame) burn += flow;
      else unburned += flow;
    }
    f.gasTotal = gasTotal;
    f.burn = burn;
    const qFuel = burn * lhv;
    f.qFuel = qFuel;
    const ult = fuelAnalysis(lhv);
    f.ult = ult;
    f.qHHV = (burn * toKj(ult.MassHHVLb)) / 1000; // MW

    // Unburned fuel accumulation and furnace puff on delayed ignition
    s.unburned += unburned * dt;
    s.unburned -= s.unburned * Math.min(1, (dt * (s.airFlow / DES.AIR_FULL)) / 30);
    s.puffT = Math.max(0, s.puffT - dt);
    if (s.unburned > 40 && (qFuel > 5 || ELEVS.some((x) => s.ign[x]))) {
      s.Pf += 3000 + 30 * s.unburned;
      s.puffT = 10;
      s.unburned = 0;
    }

    // Air
    for (const p of ['A', 'B']) {
      const run = s.mot[`FD_${p}`].run;
      const target = run ? 400 * (0.06 + 0.94 * (s.act[`FD_${p}_PITCH`] / 100)) : 0;
      s.fdFlow[p] = lagTo(s.fdFlow[p], target, run ? 1.5 : 4, dt);
      s.idRun[p] = lagTo(s.idRun[p], s.mot[`ID_${p}`].run ? 1 : 0, s.mot[`ID_${p}`].run ? 3 : 6, dt);
    }
    const inleak = s.Pf < 0 ? 12 * Math.sqrt(Math.min(30, -s.Pf / 100)) : 0;
    const airTotal = s.fdFlow.A + s.fdFlow.B + inleak;
    s.airFlow = lagTo(s.airFlow, airTotal, 0.5, dt);

    // Combustion analysis (template 3): excess air from the wet air / fuel ratio (inverse of 3010),
    // flue gas composition and the wet O2 at the economizer outlet.
    let ea = 1000;
    if (burn > 0.05) ea = CB.excessAirFromAirFuel(ult, s.airFlow / burn, { specHum: SPEC_HUM });
    f.ea = ea / 100;
    const fg = burn > 0.05 ? CB.flueGasFromExcessAir(ult, clamp(ea, 0, 5000), { specHum: SPEC_HUM }) : FG_AIR;
    f.fg = fg;
    const o2True = qFuel > 5 ? (ea > 0 ? clamp(fg.WetO2PctVol, 0, 20.9) : 0) : 20.9;
    s.o2 = lagTo(s.o2, o2True, 8, dt);
    f.co = qFuel > 5 ? (ea < 0 ? 2000 + 400 * -ea : s.o2 < 1.2 ? 15 + (1.2 - s.o2) * 1500 : 12) : 0;

    // Flue gas & furnace pressure
    const steamLeak = this.f.tubeLeak ?? 0;
    const gasIn = s.airFlow + burn + unburned + steamLeak;
    let idOut = 0;
    for (const p of ['A', 'B']) idOut += s.idRun[p] * 520 * (0.04 + 0.96 * (s.act[`ID_${p}_VANE`] / 100));
    idOut *= Math.max(0, 1 + s.Pf / 2500);
    const draft = 25 * Math.max(0, 1 + s.Pf / 1000); // natural chimney draft
    const gasOut = idOut + draft;
    const qLagPrev = s.qLag;
    s.qLag = lagTo(s.qLag, qFuel, 0.8, dt);
    const dQdt = dt > 0 ? (s.qLag - qLagPrev) / dt : 0;
    if (dt > 0) s.Pf += ((gasIn - gasOut) / 0.12 + 0.5 * dQdt) * dt;
    s.Pf = clamp(s.Pf, -6000, 6000);
    f.gasFlow = gasIn;
    f.Wg = s.airFlow + burn + steamLeak;
    f.L = qFuel / DES.Q_FUEL;
  }

  // ------------------------------------------------------------------ feedwater pumps & valves
  #feedwater(dt) {
    const s = this.s;
    const f = this.f;
    for (const p of ['A', 'B', 'C']) {
      const run = s.mot[`BFP_${p}`].run;
      const target = run ? 1500 + 3900 * (s.act[`BFP_${p}_SCOOP`] / 100) : 0;
      s.bfpN[p] = lagTo(s.bfpN[p], target, run ? 3 : 8, dt);
    }
    const Ps = s.Pda + 0.25; // suction incl. booster/static head (abs)
    const Pd = f.Pd ?? Math.max(P_ATM, st.psat(s.Td));
    const Pms = f.Pms ?? Pd;
    const Pcrh = f.Pcrh ?? s.Prh;
    const fcv = s.act.FCV / 100;
    const blockOpen = s.v.SPRAY_BLOCK > 0.5;
    const sh = s.act.SH_SPRAY / 100;
    const rh = s.act.RH_SPRAY / 100;
    const hpbSpray = s.hpbSpray;
    const sys = (Ph) => {
      const qMain = 700 * fcv * Math.sqrt(Math.max(0, Ph - Pd - 0.4) / 1.5);
      const qShs = blockOpen ? 60 * sh * Math.sqrt(Math.max(0, Ph - Pms) / 4) : 0;
      const qRhs = 18 * rh * Math.sqrt(Math.max(0, Ph - Pcrh) / 16);
      const qHpbs = Ph > Pcrh + 0.5 ? hpbSpray : 0;
      return { qMain, qShs, qRhs, qHpbs, total: qMain + qShs + qRhs + qHpbs };
    };
    const pumpQ = (Ph) => {
      const q = {};
      let tot = 0;
      for (const p of ['A', 'B', 'C']) {
        const nn = s.bfpN[p] / 5000;
        const head = 26 * nn * nn;
        const dp = Ph - Ps;
        q[p] = head > dp ? Math.sqrt((head - dp) / 3.5e-5) : 0;
        tot += q[p];
      }
      return { q, tot };
    };
    let lo = Ps;
    let hi = Ps + 32;
    let Ph = Ps;
    if (pumpQ(lo).tot > sys(lo).total) {
      for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        if (pumpQ(mid).tot > sys(mid).total) lo = mid;
        else hi = mid;
      }
      Ph = (lo + hi) / 2;
    }
    const flows = sys(Ph);
    const pumps = pumpQ(Ph);
    // Pump flows must match system flow exactly; distribute any bisection residual pro rata.
    const scale = pumps.tot > 1e-6 ? flows.total / pumps.tot : 0;
    f.Ph = Ph;
    f.qMain = flows.qMain;
    f.qShs = flows.qShs;
    f.qRhs = flows.qRhs;
    f.qHpbs = flows.qHpbs;
    f.bfpTotal = flows.total;
    f.bfpQ = {};
    f.bfpAmps = {};
    f.bfpKw = 0;
    // Pump power (templates 4120 / 4220): hydraulic power over the curve efficiency at the speed
    const rho = st.rhoLiq(s.Tda);
    const dpPa = Math.max(0, Ph - Ps) * 1e6;
    const headFt = (dpPa / (rho * 9.80665)) * 3.2808399;
    let effSum = 0;
    let qSum = 0;
    for (const p of ['A', 'B', 'C']) {
      const q = pumps.q[p] * scale;
      const run = s.mot[`BFP_${p}`].run;
      const recirc = run ? Math.max(0, 70 - q) : 0;
      const qt = q + recirc;
      f.bfpQ[p] = qt;
      let kw = 0;
      if (run) {
        const gpm = (qt / rho) * 15850.32;
        const eta = PU.curveEfficiency({ ...BFP_NV, bepFlow: (BFP_NV.bepFlow / rho) * 15850.32 }, gpm, Math.max(500, s.bfpN[p])) / 100;
        const whp = PU.hydraulicHp(gpm, headFt, rho * 0.06242796);
        kw = whp / 1.341022 / Math.max(0.2, eta) / 0.97 + 150; // motor efficiency, hydraulic coupling slip losses
        effSum += eta * qt;
        qSum += qt;
      }
      f.bfpKw += kw;
      f.bfpAmps[p] = this.#amps(`BFP_${p}`, kw);
    }
    // feed pump enthalpy rise dh = v dP / eta  ->  pump discharge temperature
    const etaAvg = qSum > 1 ? effSum / qSum : 0.8;
    f.bfpDh = qSum > 1 ? (dpPa / rho / 1000) / Math.max(0.3, etaAvg) : 0;
    f.tBfpOut = tLiqP(Math.max(Ph, P_ATM), st.hLiq(s.Tda) + f.bfpDh);
  }

  // ------------------------------------------------------------------ furnace, gas path, boiler water / steam
  #boiler(dt, u) {
    const s = this.s;
    const f = this.f;
    const Pd = Math.max(P_ATM, st.psat(s.Td));
    const boiling = s.Td >= 99.9;
    f.Pd = Pd;

    // Superheater pressure drop and throttle pressure
    const dPsh = Math.min(0.5 * (Pd - P_ATM), DES.SH_DP * (s.mOutLag / DES.MS_FLOW) ** 2 * (DES.DRUM_P / Math.max(Pd, 0.5)));
    const Pms = Pd - Math.max(0, dPsh);
    f.Pms = Pms;
    const Tms = s.Tsh2;
    const tf = Math.sqrt(811 / (Math.max(Tms, 100) + 273));
    const Pcrh = f.Pcrh ?? s.Prh;
    const P1 = Math.min(f.P1 ?? Pcrh, Pms);
    // Governor valves into the first stage (the first stage pressure from the stage flow factors)
    const mHp = TD.kGv * s.v.MSV * (s.act.GV / 100) * Pms * tf * phi(P1 / Pms);
    const mHpb = DES.HPB_CAP * (s.act.HPB / 100) * (Pms / 16.8) * phi(Pcrh / Pms);
    const mVent = s.v.SH_VENT * 3.5 * Pms * phi(P_ATM / Pms);
    if (Pd > 20.6) s.svLift = true;
    if (Pd < 20.1) s.svLift = false;
    const mSv = s.svLift ? 150 * (Pd / 20.6) : 0;
    const mOut = boiling ? mHp + mHpb + mVent + mSv : 0;
    s.mOutLag = lagTo(s.mOutLag, mOut, 1, dt);
    const mShs = Math.min(f.qShs ?? 0, mOut);
    const mGen = Math.max(0, mOut - mShs);
    Object.assign(f, { mHp: boiling ? mHp : 0, mHpb: boiling ? mHpb : 0, mVent: boiling ? mVent : 0, mSv: boiling ? mSv : 0, mGen, mShs, mOut });

    // HP bypass desuperheating spray (keeps bypass outlet near 330 C)
    const hMs = st.hSteam(Pms, Tms);
    const hFw = st.hLiq(s.Tfw);
    const hTargetHpb = f.mHpb > 0.1 ? st.hSteam(Pcrh, Math.min(330, Tms)) : hMs;
    s.hpbSpray = f.mHpb > 0.1 && hMs > hTargetHpb ? (f.mHpb * (hMs - hTargetHpb)) / Math.max(200, hTargetHpb - hFw) : 0;
    f.hHpbOut = f.mHpb > 0.1 ? (f.mHpb * hMs + (f.qHpbs ?? 0) * hFw) / (f.mHpb + (f.qHpbs ?? 0)) : hMs;

    // Blowdown and tube leak
    const dpHead = Math.max(0, Pd - P_ATM + 0.05);
    const mEbd = s.v.EBD * 40 * Math.sqrt(dpHead / 18.6);
    const mCbd = (s.act.CBD / 100) * 6 * Math.sqrt(dpHead / 18.6);
    const mLeak = u.MF_TUBE_LEAK ? ((u.MF_TUBE_LEAK_SEV ?? 80) / 3.6) * clamp(dpHead / 3, 0, 1) : 0;
    f.tubeLeak = mLeak;
    f.mBd = mEbd + mCbd;

    // ---- furnace (templates 3680 / 3690)
    const fg = f.fg;
    const Wg = Math.max(0.1, f.Wg);
    const firing = f.qFuel > 2 && f.burn > 0.05;
    let hIn;
    let qRadTarget = 0;
    if (firing) {
      const radLoss = BL.radiationLoss(f.qHHV * 3.412142, GD.heatInHHV, NV_BOILER.cooledWalls);
      f.radLoss = radLoss;
      hIn = availEnergy(f.ult, fg, s.tAirHot, radLoss);
      // radiant absorption from the template loop (3690), scaled to the fuel burnt since then
      if (!(f.furn?.burn > 0.05)) this.#furnace();
      qRadTarget = f.furn.q * (f.burn / f.furn.burn);
    } else {
      // purge / unfired: air through the furnace exchanges heat with the waterwalls
      f.aft = s.tAirHot;
      f.radLoss = 0;
      f.furn = null;
      hIn = gasH(fg, s.tAirHot);
      qRadTarget = (Wg * 0.15 * (s.tAirHot - s.Td)) / 1000;
    }
    s.qRad = lagTo(s.qRad, qRadTarget, firing ? 4 : 30, dt);
    // exit gas temperature from the energy actually absorbed (consistent with the gas enthalpy)
    const fegtTarget = gasT(fg, hIn - (s.qRad * 1000) / Wg);
    s.fegt = lagTo(s.fegt, clamp(fegtTarget, -20, 2200), firing ? 2 : 60, dt);
    const qww = s.qRad * (1 - GD.platenFrac);
    const qPl = s.qRad * GD.platenFrac;
    f.qww = qww;
    f.qPl = qPl;

    // ---- convective pass: final SH bank -> RH -> primary SH -> economizer (3305 / 3650)
    const Psh1 = (Pd + Pms) / 2;
    const tg0 = s.fegt;
    const ua = (k, tgIn, i) => sectionUA(GD.UA[k], Wg, GD.Wg, tgIn, GD.tg[i]);
    // section mean steam temperature: inlet / outlet average with flow, the outlet (metal) node without
    const mean = (tIn, tOut, flow) => tOut + (clamp(flow / 30, 0, 1) * (tIn - tOut)) / 2;
    const tDsh = f.Tdsh ?? s.Tsh1;
    const sec2 = gasSection(fg, Wg, tg0, mean(tDsh, s.Tsh2, f.mOut ?? 0), ua('sh2', tg0, 0));
    const tCrh = f.Tcrh ?? s.Trh;
    const secR = gasSection(fg, Wg, sec2.TgOut, mean(tCrh, s.Trh, (f.mCrhIn ?? 0) + (f.qRhs ?? 0)), ua('rh', sec2.TgOut, 1));
    const sec1 = gasSection(fg, Wg, secR.TgOut, mean(boiling ? st.tsat(Psh1) : s.Td, s.Tsh1, f.mGen ?? 0), ua('sh1', secR.TgOut, 2));
    const tEco = tLiqP(Pd + 1.5, s.hEco);
    const secE = gasSection(fg, Wg, sec1.TgOut, (s.Tfw + tEco) / 2, ua('eco', sec1.TgOut, 3));
    f.tg = [tg0, sec2.TgOut, secR.TgOut, sec1.TgOut, secE.TgOut];

    // ---- air heaters (regenerative, 3800 / 3810; leakage 3830 / 3903)
    const nAph = (s.mot.APH_A.run ? 1 : 0) + (s.mot.APH_B.run ? 1 : 0);
    const tAirIn = s.amb + (s.fdFlow.A + s.fdFlow.B > 5 ? 2 : 0);
    const ahU = ahUA(GD.uaAh, Wg, GD.Wg, s.airFlow, GD.Wa) * (nAph / 2);
    const ah = airHeaterHX(fg, Wg, secE.TgOut, s.airFlow, tAirIn, ahU);
    f.ah = ah;
    f.tAirIn = tAirIn;
    s.tAirHot = lagTo(s.tAirHot, ah.TaOut, 60, dt);
    f.ahLeak = nAph > 0 ? NV_BOILER.ahLeakage : 0;
    f.tStack = toC(AH.gasOutWithLeak(toF(ah.Tgonl), toF(tAirIn), f.ahLeak));
    f.o2AhOut = (f.ahLeak * 21 + 90 * s.o2) / (f.ahLeak + 90); // inverse of template 3903

    // ---- economizer
    const qFw = f.qMain ?? 0;
    const hfD = st.hLiq(s.Td);
    s.hEco += dt * ((secE.q * 1000 - qFw * (s.hEco - hFw)) / M_ECO);
    s.hEco = clamp(s.hEco, st.hLiq(Math.min(s.Tfw, s.Td) - 1), st.hf(Pd));
    f.qEcoUsed = secE.q;
    f.tEco = tEco;

    // ---- drum energy & mass balance
    const hgD = st.hg(Pd);
    const level = this.#drumLevel();
    const carry = level > 300 ? clamp((level - 300) / 200, 0, 1) * 0.15 : 0;
    const C = s.Mw * st.dhfdT(s.Td) + DES.DRUM_METAL_C;
    const qLossAmb = 2.0 * Math.max(0, s.Td - s.amb) / 330; // MW
    const dE = qww * 1000 + qFw * (s.hEco - hfD) - mGen * (1 - carry) * (hgD - hfD) - qLossAmb * 1000;
    const dTd = (dE / C) * dt;
    s.Td = clamp(s.Td + dTd, 5, 372);
    s.dTdLag = lagTo(s.dTdLag, dt > 0 ? (dTd / dt) * 60 : s.dTdLag, 120, dt);
    s.TmDrumDT = lagTo(s.TmDrumDT, Math.abs(s.dTdLag) * 8, 300, dt);
    s.Mw = Math.max(1000, s.Mw + (qFw - mGen - mEbd - mCbd - mLeak) * dt);

    // Swell / shrink
    const dPdt = dt > 0 ? (Pd - s.PdPrev) / dt : 0;
    s.PdPrev = Pd;
    s.dPdtLag = lagTo(s.dPdtLag, dPdt, 3, dt);
    const swellSS = boiling ? Math.min(250, (60 * (mGen / 572) * Math.sqrt(st.rhof(Pd) / st.rhog(Pd))) / 1.93) : 0;
    s.swell = lagTo(s.swell, swellSS - 500 * s.dPdtLag, 6, dt);
    f.level = this.#drumLevel();

    // ---- primary superheater (before attemperator)
    const hIn1 = hgD - carry * st.hfg(Pd);
    const q1 = sec1.q;
    const h1 = st.hSteam(Psh1, s.Tsh1);
    const Tsh1Prev = s.Tsh1;
    const amb1 = AMB_LOSS * (s.Tsh1 - s.amb); // MW casing loss
    s.Tsh1 += ((((q1 - amb1) * 1000 - mGen * (h1 - hIn1)) / DES.SH1_C) * dt);
    if (boiling && mGen > 0.5) s.Tsh1 = Math.max(s.Tsh1, st.tsat(Psh1));

    // ---- attemperator
    const h1n = h1 + (s.Tsh1 - Tsh1Prev) * st.cpSteam(Psh1, s.Tsh1);
    const mMs = mGen + mShs;
    const hMix = mMs > 0.5 ? (mGen * h1n + mShs * hFw) / mMs : h1n;
    f.Tdsh = mMs > 0.5 ? st.tSteam(Pms, hMix, f.Tdsh) : s.Tsh1;
    f.wetSH = mMs > 0.5 && hMix < st.hg(Pms);

    // ---- platen + final superheater
    const q2 = qPl + sec2.q;
    const h2 = st.hSteam(Pms, s.Tsh2);
    const amb2 = AMB_LOSS * (s.Tsh2 - s.amb);
    s.Tsh2 += ((((q2 - amb2) * 1000 - mMs * (h2 - hMix)) / DES.SH2_C) * dt);
    if (boiling && mMs > 0.5) s.Tsh2 = Math.max(s.Tsh2, st.tsat(Pms));
    f.qSh = q1 + q2;
    f.qSh1 = q1;
    f.qSh2 = q2;

    // ---- reheater (flows from previous turbine step)
    const mRhIn = (f.mCrhIn ?? 0) + (f.qRhs ?? 0);
    const hCrh = f.hCrhMix ?? st.hSteam(s.Prh, s.Trh);
    const hRhIn = mRhIn > 0.5 ? ((f.mCrhIn ?? 0) * hCrh + (f.qRhs ?? 0) * hFw) / mRhIn : hCrh;
    const qr = secR.q;
    const hr = st.hSteam(s.Prh, s.Trh);
    const ambR = AMB_LOSS * (s.Trh - s.amb);
    s.Trh += ((((qr - ambR) * 1000 - mRhIn * (hr - hRhIn)) / DES.RH_C) * dt);
    if (mRhIn > 0.5) s.Trh = Math.max(s.Trh, st.tsat(s.Prh));
    f.qRh = qr;
    f.Tcrh = st.tSteam(s.Prh, hRhIn, f.Tcrh);
    f.qAbs = qww + f.qEcoUsed + Math.max(0, f.qSh) + Math.max(0, f.qRh);
  }

  /** Templates 3680 / 3690: flame temperature and radiant absorption [MW] for the current firing. */
  #furnace() {
    const s = this.s;
    const f = this.f;
    const fg = f.fg;
    const fl = flame(f.ult, fg, s.tAirHot, f.radLoss ?? 0.2);
    const fe = FN.furnaceExitTemp(f.ult, fg, fl.raw, f.burn * LB, {
      wallAreaFt2: GD.wallAreaFt2,
      beamLengthFt: NV_BOILER.beamLengthFt,
      burnerHeight: clamp(NV_BOILER.burnerHeight + TILT_X * s.act.TILT, 0.02, 0.95),
    }, { psi: NV_BOILER.psiClean });
    const Wg = Math.max(0.1, f.Wg);
    f.aft = fl.aft;
    f.emissivity = fe.emissivity;
    f.furn = { burn: f.burn, q: (fe.furnaceAbsorption / 3.412142) * (Wg / Math.max(0.1, f.burn * fg.WetGasPerlbFuel)) };
  }

  #drumLevel() {
    const s = this.s;
    const v = s.Mw / st.rhoLiq(s.Td);
    return ((v - DES.DRUM_VREF) / DES.DRUM_AREA) * 1000 + s.swell;
  }

  // ------------------------------------------------------------------ turbine
  #turbine(dt) {
    const s = this.s;
    const f = this.f;
    const x = f.exp ?? this.#designExpansion();
    const Pcond = (f.PcondKpa ?? s.Pair + st.psat(s.Tc) * 1000) / 1000; // MPa abs
    const hph = s.v.HPH > 0.5;
    const ext = s.htr;

    // HP turbine: N2 packing leakage to the IP bowl, HPH7 extraction, HPH6 from cold reheat
    const mHp = f.mHp;
    const Wn2 = TD.n2Frac * mHp;
    const W7 = hph ? Math.min(ext.HPH7.ext, 0.15 * mHp) : 0;
    const W2 = Math.max(0, mHp - Wn2 - W7);
    const W6 = hph ? Math.min(ext.HPH6.ext, 0.25 * W2) : 0;
    const mHpExh = Math.max(0, W2 - W6);

    // Reheater pressure (storage) and the IP turbine (stage flow factor, intercept valves as area)
    const Prh = Math.max(Pcond + 0.001, s.Prh);
    const Pbowl = 0.98 * Prh;
    const mIp = s.v.RSV * (s.act.ICV / 100) * TD.kIp * Math.sqrt(Math.max(0, Pbowl * Pbowl - s.Pcross * s.Pcross) / x.pv.ip);
    const mLpb = DES.LPB_CAP * (s.act.LPB / 100) * (Prh / 4) * phi(Pcond / Prh);
    const mRhSv = Prh > 4.9 ? (Prh - 4.9) * 600 : 0;
    const mCrhIn = mHpExh + f.mHpb + (f.qHpbs ?? 0);
    const mRhIn = mCrhIn + (f.qRhs ?? 0);
    s.Prh = Math.max(0.004, s.Prh + ((mRhIn - mIp - mLpb - mRhSv) / DES.RH_C_MASS) * dt);
    const Pcrh = s.Prh + TD.dpRh * (mRhIn / TD.Wrh) ** 2;
    f.Pcrh = Pcrh;
    f.mIp = mIp;
    f.mLpb = mLpb;
    // HP stage pressures from the stage flow coefficients (2080, Stodola form), exhaust upwards
    // (the first stage pressure is relaxed: valve flow and stage pressure are solved one step apart)
    f.PE7 = stodolaPin(TD.kHp2, W2, Pcrh, x.pv.hp2);
    const p1 = stodolaPin(TD.kHp1, mHp, f.PE7, x.pv.hp1);
    f.P1 = f.P1 === undefined ? p1 : f.P1 + 0.4 * (p1 - f.P1);
    f.W7 = W7;
    f.W6 = W6;
    f.Wn2 = Wn2;

    // IP / LP: DA extraction at the crossover, LP heater extractions; pressures from the condenser up
    const Wbowl = mIp + Wn2 * (mIp > 0.5 ? 1 : 0);
    const W5 = Math.min(s.extDA, 0.2 * Wbowl);
    const g0 = Math.max(0, Wbowl - W5);
    const we = LP_HTRS.slice().reverse().map((n) => Math.min(ext[n].ext, 0.12 * g0)); // LPH4..LPH1
    const g = [g0];
    for (const w of we) g.push(Math.max(0, g[g.length - 1] - w));
    const PE = [];
    PE[4] = Pcond;
    for (let i = 4; i >= 1; i--) PE[i - 1] = stodolaPin(TD.kLp[i], g[i], PE[i], x.pv.lp[i]);
    const PcrossT = stodolaPin(TD.kLp[0], g[0], PE[0], x.pv.lp[0]);
    s.Pcross = lagTo(s.Pcross, Math.min(PcrossT, Pbowl), 0.5, dt);
    f.PE = { e4: PE[0], e3: PE[1], e2: PE[2], e1: PE[3] };
    f.W5 = W5;
    f.gLp = g;
    f.Wbowl = Wbowl;

    // Section power (template 2221) from the expansion line of the template loop
    const pHp = (mHp * x.dh.hp0 + (mHp - Wn2) * x.dh.hp1 + W2 * x.dh.hp2) / 1000;
    const pIp = (Wbowl * x.dh.ip) / 1000;
    let pLp = 0;
    for (let i = 0; i < 5; i++) pLp += (g[i] * x.dh.lp[i]) / 1000;
    const pMech = Math.max(0, pHp + pIp + pLp);
    f.pMech = pMech;
    f.pHp = pHp;
    f.pIp = pIp;
    f.pLp = pLp;
    f.mLp = g0;
    f.mExh = g[4];
    f.Tcross = x.tX;
    const nr = s.n / DES.RPM;
    const windHp = 60 * nr ** 3 * Math.exp(-mHp / 20);
    f.Thpx = Math.min(600, (mHp > 0.1 ? x.tCrh : s.Thp) + windHp);
    f.mCrhIn = mCrhIn;
    f.hCrhMix = mCrhIn > 0.1 ? (mHpExh * x.hCrh + f.mHpb * f.hHpbOut) / Math.max(0.1, mHpExh + f.mHpb) : st.hSteam(Pcrh, s.Trh);

    // Rotor losses [MW]: bearings (2530 ~ n^2), blade windage without steam flow
    const pCondKpa = Pcond * 1000;
    const pWind = nr ** 3 * (0.3 + 12 * (pCondKpa / 101.3)) * Math.exp(-g[4] / 30) + 0.5 * nr ** 3 * Math.exp(-mHp / 20);
    const pBrg = D.cycle.mech * nr * nr;
    const excited = s.If > 0.1 ? 1.0 * nr * Math.min(1.5, s.If) ** 2 * 0.6 : 0;
    const losses = pWind + pBrg + (s.gcb ? 0 : excited);
    f.lossMech = losses;

    if (s.gcb) {
      // generator losses (template 2520) at the last output
      const genLoss = GN.generatorLosses(Math.max(1, f.genMW ?? s.Pe), f.genMVAR ?? 0, TD.nvHp.genH2Psig, DES.MVA * 1000);
      f.genLoss = genLoss;
      s.n = s.fg * 60;
      s.Pe = pMech - losses - genLoss;
    } else {
      f.genLoss = 0;
      s.Pe = 0;
      const omega = Math.max(s.n, 5) * (TWO_PI / 60);
      const pAcc = pMech - losses;
      s.n += (((pAcc * 1e6) / (DES.INERTIA * omega)) * (60 / TWO_PI)) * dt;
      if (s.mot.TG.run && s.n < 10) {
        s.tgEng = true;
        if (pMech < 0.3) s.n = lagTo(s.n, 4, 3, dt);
      }
      if (s.n < 0.5 && pAcc < 0.05 && !s.tgEng) s.n = Math.max(0, s.n - 0.5 * dt);
      s.n = Math.max(0, s.n);
    }
    if (s.n > 10 || !s.mot.TG.run) s.tgEng = false;

    // Condenser heat (2600): exhaust at the used energy end point, LPH1 drains, LP bypass
    const hfc = st.hLiq(s.Tc);
    const hLpbIn = mLpb > 0.01 ? Math.min(st.hSteam(Prh, s.Trh), 2900) : 0;
    const drains = ext.LPH1.ext + ext.LPH2.ext + ext.LPH3.ext + ext.LPH4.ext;
    const hD1 = st.hLiq(ext.LPH1.drainT);
    f.qCond = Math.max(0, g[4] * (x.ueep - hfc) + Math.min(drains, g0 - g[4]) * Math.max(0, hD1 - hfc) + mLpb * (hLpbIn - hfc)) / 1000;
    f.mCondIn = g0 + mLpb + f.mVent * 0; // vent discharges to atmosphere
    f.lpHood = st.tsat(Pcond) + 60 * nr ** 3 * Math.exp(-g0 / 20) + (mLpb > 5 ? 8 : 0);
    f.hph = hph;
  }

  /** Expansion line at the design point (used until the template loop has run). */
  #designExpansion() {
    const c = D.cycle;
    return {
      pv: TD.pvDes,
      dh: { hp0: c.hThr - c.h1, hp1: c.h1 - c.hE7, hp2: c.hE7 - c.hCrh, ip: c.hBowl - c.hX, lp: [c.hX - c.lp.LPH4.hE, c.lp.LPH4.hE - c.lp.LPH3.hE, c.lp.LPH3.hE - c.lp.LPH2.hE, c.lp.LPH2.hE - c.lp.LPH1.hE, c.lp.LPH1.hE - c.ueep] },
      h: { h1: c.h1, e7: c.hE7, crh: c.hCrh, x: c.hX, e4: c.lp.LPH4.hE, e3: c.lp.LPH3.hE, e2: c.lp.LPH2.hE, e1: c.lp.LPH1.hE },
      hCrh: c.hCrh,
      hX: c.hX,
      tX: c.tX,
      tCrh: st.tSteam(TD.P.crh, c.hCrh),
      ueep: c.ueep,
      elep: c.elep,
      etaHp: c.etaHp,
      etaIp: c.etaIp,
      etaLp: c.etaLp,
      tExt: {},
    };
  }

  // ------------------------------------------------------------------ template (iterative) calculations
  #templates(dtSlow, u) {
    const s = this.s;
    const f = this.f;
    const Pcond = Math.max(0.0008, (f.PcondKpa ?? 7) / 1000);
    const x = { pv: { ...TD.pvDes, lp: [...TD.pvDes.lp] }, dh: { lp: [0, 0, 0, 0, 0] }, h: {}, tExt: {} };
    if (f.qFuel > 2 && f.burn > 0.05) this.#furnace();

    // ---- HP expansion (2340 design efficiency vs flow, partial arc)
    const Pms = f.Pms;
    const Tms = Math.max(s.Tsh2, st.tsat(Pms) + 0.5);
    const hThr = st.hSteam(Pms, Tms);
    const sThr = st.sSteam(Pms, Tms);
    const rHp = f.mHp / TD.Wdes;
    const effFlow = rHp > 0.02 ? TB.designHpEff(toKpph(f.mHp), toPsia(Pms), toF(Tms), TD.nvHp) / TD.hpEffDes : 0.7;
    const etaHp = clamp(TD.etaHp * effFlow, 0.4, 0.92); // ventilation heating at low flow is the separate windage term
    const P1 = Math.min(f.P1, Pms * 0.999);
    const PE7 = Math.min(f.PE7, P1);
    const Pcrh = Math.min(f.Pcrh, PE7);
    const h1 = expand(hThr, sThr, P1, etaHp);
    const hE7 = expand(hThr, sThr, PE7, etaHp);
    const hCrh = expand(hThr, sThr, Pcrh, etaHp);
    x.dh.hp0 = hThr - h1;
    x.dh.hp1 = h1 - hE7;
    x.dh.hp2 = hE7 - hCrh;
    x.pv.hp1 = P1 * st.vPH(P1, h1);
    x.pv.hp2 = PE7 * st.vPH(PE7, hE7);
    x.hCrh = hCrh;
    x.tCrh = st.tSteam(Pcrh, hCrh);
    x.tExt.HPH7 = st.tSteam(PE7, hE7);
    x.tExt.HPH6 = x.tCrh;
    x.etaHp = etaHp;
    x.h = { thr: hThr, h1, e7: hE7, crh: hCrh };

    // ---- IP expansion (2350 design efficiency, N2 leakage mixed into the bowl)
    const Prh = Math.max(s.Prh, Pcond * 1.01);
    const Trh = Math.max(s.Trh, st.tsat(Prh) + 0.5);
    const hRh = st.hSteam(Prh, Trh);
    const Wn2 = f.Wn2 ?? 0;
    const hBowl = f.mIp + Wn2 > 0.5 ? (f.mIp * hRh + Wn2 * h1) / (f.mIp + Wn2) : hRh;
    const Pbowl = 0.98 * Prh;
    const sBowl = st.sPH(Pbowl, hBowl);
    const etaIp = TD.etaIp * lowFlow(f.mIp / TD.Wrh);
    const Px = Math.min(s.Pcross, Pbowl * 0.999);
    const hX = expand(hBowl, sBowl, Px, etaIp);
    x.dh.ip = hBowl - hX;
    x.pv.ip = Pbowl * st.vPH(Pbowl, hBowl);
    x.hX = hX;
    x.tX = st.tSteam(Px, hX);
    x.etaIp = etaIp;
    x.h.bowl = hBowl;
    x.h.x = hX;

    // ---- LP expansion: ELEP / UEEP with exhaust loss (2200) from the crossover
    const sX = st.sPH(Px, hX);
    const PE = f.PE ?? { e4: TD.P.e4, e3: TD.P.e3, e2: TD.P.e2, e1: TD.P.e1 };
    const pts = [PE.e4, PE.e3, PE.e2, PE.e1].map((p) => Math.min(p, Px * 0.999));
    const g = f.gLp ?? [0, 0, 0, 0, 0];
    let etaLp = TD.etaLp * lowFlow(g[0] / D.cycle.Wlp);
    let ueep;
    if (g[0] > 2 && g[4] > 0.5) {
      const r = TB.ueepReheat(toPsia(Px), toF(x.tX), toKpph(g[0]), 0, 0, toPsia(Pcond), toKpph(g[4]), TD.nvLp);
      const elep = toKj(r.elep);
      etaLp = clamp((hX - elep) / Math.max(1, hX - st.hPS(Pcond, sX)), 0.05, 0.95) * lowFlow(g[0] / D.cycle.Wlp);
      ueep = Math.max(expand(hX, sX, Pcond, etaLp), toKj(r.ueep) - (elep - expand(hX, sX, Pcond, etaLp)));
      x.elep = elep;
      x.exhLoss = toKj(r.exhaustLoss);
      x.annulusVel = r.annulusVelocity * 0.3048;
    } else {
      ueep = expand(hX, sX, Pcond, etaLp);
      x.elep = ueep;
      x.exhLoss = 0;
      x.annulusVel = 0;
    }
    const hL = [hX, ...pts.map((p) => expand(hX, sX, p, etaLp))];
    for (let i = 0; i < 4; i++) x.dh.lp[i] = Math.max(0, hL[i] - hL[i + 1]);
    x.dh.lp[4] = Math.max(0, hL[4] - ueep);
    const pvPts = [Px, ...pts];
    x.pv.lp = pvPts.map((p, i) => p * st.vPH(p, hL[i]));
    x.ueep = ueep;
    x.etaLp = etaLp;
    x.h.e4 = hL[1];
    x.h.e3 = hL[2];
    x.h.e2 = hL[3];
    x.h.e1 = hL[4];
    x.tExt.LPH4 = st.tSteam(pts[0], hL[1]);
    x.tExt.LPH3 = st.tSteam(pts[1], hL[2]);
    x.tExt.LPH2 = st.tSteam(pts[2], hL[3]);
    x.tExt.LPH1 = st.tSteam(pts[3], hL[4]);
    x.pExt = { HPH7: PE7, HPH6: Pcrh, LPH4: pts[0], LPH3: pts[1], LPH2: pts[2], LPH1: pts[3] };
    f.exp = x;

    // ---- feedwater heaters: Tsou prediction (2990) -> outlet temperature, drain temperature and extraction flow targets
    this.#heaterTargets();

    // ---- condenser (2690 HEI): saturation temperature for the heat load at the CW flow and cleanliness
    const Q = (f.qCond ?? 0) * 3.412142;
    const gpm = (s.mcw / 997) * 15850.32;
    const clean = (u.MF_COND_FOULING ? 0.45 : 1) * D.condenser.nv.cleanDesign;
    if (s.mcw > 200 && Q > 3) {
      const r = CD.condenserPressure(D.condenser.nv, Q, gpm, toF(s.cwIn), clean);
      f.tcTarget = toC(r.tsat);
      f.cwRise = r.rise / 1.8;
    } else if (s.mcw > 200) {
      f.tcTarget = s.cwIn + 0.5 + (Q / 3) * 2;
      f.cwRise = Q > 0 ? Q / 3.412142 / ((s.mcw * 4.186) / 1000) : 0;
    } else {
      f.tcTarget = (f.qCond ?? 0) > 2 ? 110 : s.amb;
      f.cwRise = 0;
    }
    void dtSlow;
  }

  /** Heater predictions (template 2990 Tsou, US units) for the current flows and steam conditions. */
  #heaterTargets() {
    const s = this.s;
    const f = this.f;
    const x = f.exp;
    const tgt = {};
    const hph = s.v.HPH > 0.5;
    const predict = (name, fwKgs, fwP, fwInT, drainIn, drainT) => {
      const Pe = x.pExt[name];
      const Psh = 0.97 * Pe;
      const tsat = st.tsat(Psh);
      const off = { tOut: fwInT, drainT: fwInT, ext: 0, ttd: 0, dca: 0 };
      if (!(fwKgs > 3) || tsat < fwInT + 1 || (name.startsWith('HPH') && !hph)) return off;
      const a = {
        fwFlow: toKpph(fwKgs), fwInP: toPsia(fwP), fwInT: toF(fwInT), stmP: toPsia(Psh), stmT: toF(Math.max(x.tExt[name], tsat + 0.05)),
        drainInFlow: toKpph(drainIn), drainInP: toPsia(Psh * 1.3 + 0.01), drainInT: toF(drainT),
      };
      const guess = this.htrGuess?.[name] ?? null;
      const r = FW.heaterPredict(HTR_DES[name], a, guess);
      if (!Number.isFinite(r.fwOutT) || !Number.isFinite(r.extrFlow)) return off;
      (this.htrGuess ??= {})[name] = r;
      const tOut = clamp(toC(r.fwOutT), fwInT, tsat + 5);
      return { tOut, drainT: clamp(toC(r.drainOutT), fwInT, tsat), ext: Math.max(0, toKgs(r.extrFlow)), ttd: r.ttd / 1.8, dca: r.dca / 1.8 };
    };
    const ht = s.htr;
    // LP heaters: condensate flow, drains cascade LPH4 -> LPH1 -> condenser
    const mCep = f.mCep ?? 0;
    const pCep = P_ATM + (f.cepPress ?? 0.1);
    tgt.LPH4 = predict('LPH4', mCep, pCep, ht.LPH3.tOut, 0, 0);
    tgt.LPH3 = predict('LPH3', mCep, pCep, ht.LPH2.tOut, ht.LPH4.ext, ht.LPH4.drainT);
    tgt.LPH2 = predict('LPH2', mCep, pCep, ht.LPH1.tOut, ht.LPH4.ext + ht.LPH3.ext, ht.LPH3.drainT);
    tgt.LPH1 = predict('LPH1', mCep, pCep, s.Tc + 0.3, ht.LPH4.ext + ht.LPH3.ext + ht.LPH2.ext, ht.LPH2.drainT);
    // HP heaters: feedwater through the heaters (spray is taken after them), drains HPH7 -> HPH6 -> DA
    const fwHp = (f.qMain ?? 0) + (f.qShs ?? 0);
    const pFw = Math.max(f.Ph ?? P_ATM, P_ATM);
    tgt.HPH7 = predict('HPH7', fwHp, pFw, ht.HPH6.tOut, 0, 0);
    tgt.HPH6 = predict('HPH6', fwHp, pFw, f.tBfpOut ?? s.Tda, ht.HPH7.ext, ht.HPH7.drainT);
    f.htrTgt = tgt;
  }

  // ------------------------------------------------------------------ heater states (thermal lags)
  #heaters(dt) {
    const s = this.s;
    const f = this.f;
    const tgt = f.htrTgt;
    if (!tgt) return;
    for (const n of HEATERS) {
      const h = s.htr[n];
      const t = tgt[n];
      const tau = n.startsWith('HPH') ? 60 : 40;
      h.tOut = lagTo(h.tOut, t.tOut, tau, dt);
      h.drainT = lagTo(h.drainT, t.drainT, tau, dt);
      h.ext = lagTo(h.ext, t.ext, 8, dt);
      h.ttd = t.ttd;
      h.dca = t.dca;
    }
    // feedwater to the economizer: HP heater outlet, or the bypass when the heaters are out of service
    const fwTarget = f.hph ? s.htr.HPH7.tOut : f.tBfpOut ?? s.Tda;
    s.Tfw = lagTo(s.Tfw, fwTarget, f.hph ? 10 : 30, dt);
  }

  // ------------------------------------------------------------------ condenser, hotwell, deaerator
  #condensate(dt, u) {
    const s = this.s;
    const f = this.f;
    const cwPumps = (s.mot.CWP_A.run ? 1 : 0) + (s.mot.CWP_B.run ? 1 : 0);
    const mcwTarget = cwPumps === 2 ? 2 * DES.CW_PUMP_FLOW : cwPumps * DES.CW_PUMP_FLOW * 1.2;
    s.mcw = lagTo(s.mcw, mcwTarget, 20, dt);
    const tcTarget = f.tcTarget ?? s.Tc;
    f.cwOut = s.cwIn + (f.cwRise ?? 0);
    s.Tc = lagTo(s.Tc, Math.min(110, tcTarget), 45, dt);
    const pVap = st.psat(s.Tc) * 1000;
    const pTot = pVap + s.Pair;
    const drive = clamp((101.3 - pTot) / 101.3, 0, 1);
    const ingress =
      (0.0006 * (s.v.GLAND > 0.5 ? 1 : 25) * (u.MF_AIR_INGRESS ? Math.max(1, u.MF_AIR_INGRESS_SEV ?? 15) : 1) + s.v.VB * 3) *
      drive;
    const vps = (s.mot.VP_A.run ? 1 : 0) + (s.mot.VP_B.run ? 1 : 0);
    const removal = (vps * s.Pair) / 450;
    s.Pair = clamp(s.Pair + (ingress - removal) * dt, 0, Math.max(0, 101.3 - Math.min(pVap, 101.3)));
    f.PcondKpa = clamp(pVap + s.Pair, 0.8, 110);

    // Hotwell
    const nCep = (s.mot.CEP_A.run ? 1 : 0) + (s.mot.CEP_B.run ? 1 : 0);
    const head = nCep === 2 ? 3.5 : nCep === 1 ? 3.2 : 0;
    const dpAvail = head - (s.Pda - P_ATM) - 0.3;
    let mCep = nCep > 0 ? 650 * (s.act.DA_CV / 100) * Math.sqrt(Math.max(0, dpAvail) / 2.2) : 0;
    mCep = Math.min(mCep, nCep * 600);
    if (s.Mhw <= 0) mCep = 0;
    f.mCep = mCep;
    f.cepPress = nCep > 0 ? Math.max(0, head - 0.6 * (mCep / 600) ** 2) : 0.05;
    f.cepKw = nCep > 0 ? (mCep * f.cepPress * 1000) / 995 / 0.8 + 120 * nCep : 0;
    const makeup = (s.act.MAKEUP / 100) * 40;
    const hwLvl = s.Mhw / DES.HW_KG_PER_MM;
    const dump = hwLvl > 100 ? s.v.HW_DUMP * 35 : 0;
    f.makeup = makeup;
    s.Mhw = Math.max(0, s.Mhw + (f.mCondIn + makeup - mCep - dump) * dt);

    // Deaerator: condensate from LPH4, HP heater drains, extraction steam from the crossover
    // (template 2910 balance) or pegging steam
    const peg = (s.act.PEG / 100) * 12;
    const hpDrains = f.hph ? s.htr.HPH6.ext + s.htr.HPH7.ext : 0;
    const extAvail = 0.92 * s.Pcross > P_ATM + 0.02 && (f.mIp ?? 0) > 5;
    const pExt = extAvail ? 0.92 * s.Pcross : 0;
    const pPeg = P_ATM + 0.35 * (s.act.PEG / 100);
    s.Pda = lagTo(s.Pda, Math.max(P_ATM, pPeg, pExt), 40, dt);
    const tSatDa = st.tsat(s.Pda);
    const tLph = s.htr.LPH4.tOut;
    const hfDa = st.hf(s.Pda);
    const hX = f.exp?.hX ?? D.cycle.hX;
    let w5 = 0;
    if (extAvail) {
      const need = mCep * (hfDa - st.hLiq(tLph)) - hpDrains * Math.max(0, st.hLiq(s.htr.HPH6.drainT) - hfDa);
      w5 = clamp(need / Math.max(200, hX - hfDa), 0, 60);
    }
    s.extDA = lagTo(s.extDA, w5, 5, dt);
    const heating = peg + s.extDA > 0.5;
    s.Mda = Math.max(0, s.Mda + (mCep + s.extDA + peg + hpDrains - f.bfpTotal) * dt);
    const rhoDa = st.rhoLiq(s.Tda);
    f.daLevel = (s.Mda / (DES.DA_AREA * rhoDa)) * 1000;
    let dTda = (mCep * (tLph - s.Tda) + hpDrains * (s.htr.HPH6.drainT - s.Tda)) / Math.max(s.Mda, 5000);
    if (heating) dTda += (tSatDa - s.Tda) / 120;
    else dTda += (s.amb - s.Tda) / 40000;
    s.Tda = Math.min(tSatDa + 0.1, s.Tda + dTda * dt);
    f.mExtDA = s.extDA;
  }

  // ------------------------------------------------------------------ generator & grid
  #generator(dt, u) {
    const s = this.s;
    const f = this.f;
    s.fcb = !!u.FCB_CMD;
    let ifTarget = s.fcb ? clamp(Number(u.EXC_DMD) || 0, 0, 2.3) : 0;
    if (u.MF_EXCITER_FAIL && s.fcb) ifTarget = 0.05;
    // Thyristor exciter: fast negative field forcing when the demand drops (e.g. on load rejection).
    s.If = lagTo(s.If, ifTarget, !s.fcb ? 0.3 : ifTarget < s.If ? 0.15 : 0.5, dt);
    const E = s.If * (s.n / DES.RPM);
    const fGen = s.n / 60;

    // Breaker
    const cmd = !!u.GCB_CMD;
    const rising = cmd && !s.gcbCmdPrev;
    s.gcbCmdPrev = cmd;
    if (s.gcb && (!cmd || u.MF_GRID_FAULT)) s.gcb = false;
    s.oopT = Math.max(0, s.oopT - dt);
    if (!s.gcb && rising && !u.MF_GRID_FAULT) {
      const dV = Math.abs((s.flux ?? E) * (s.n / DES.RPM) - s.vg);
      const slip = fGen - s.fg;
      if (Math.abs(s.phase) > 20 || Math.abs(slip) > 0.3 || dV > 0.12) {
        s.oopT = 3;
        s.vibKick = 180;
      }
      s.gcb = true;
      s.phase = 0;
    }
    if (!s.gcb) s.phase = wrap180(s.phase + 360 * (fGen - s.fg) * dt);

    if (s.gcb) {
      const Ppu = s.Pe / DES.MVA;
      const x = (Ppu * 1.0) / (Math.max(E, 0.01) * s.vg);
      let delta;
      if (x > 0.995 || x < -0.995) {
        s.oosT += dt;
        delta = Math.PI / 2;
      } else {
        s.oosT = Math.max(0, s.oosT - dt);
        delta = Math.asin(x);
      }
      const Qpu = E * s.vg * Math.cos(delta) - s.vg * s.vg;
      const Vt = s.vg + 0.13 * Qpu;
      f.genMW = s.Pe;
      f.genMVAR = Qpu * DES.MVA;
      f.genKV = Vt * DES.GEN_KV;
      f.genKA = Math.sqrt(f.genMW ** 2 + f.genMVAR ** 2) / (Math.sqrt(3) * Math.max(1, f.genKV));
      f.loadAngle = (delta * 180) / Math.PI;
      // Rotor flux behind transient reactance: what the terminals see right after a load rejection.
      s.flux = lagTo(s.flux ?? 1, Vt + 0.25 * Qpu + 0.1 * Ppu, 0.5, dt);
      // Unprotected pole slipping is cleared by the grid's out-of-step protection after 5 s.
      if (s.oosT > 5) s.gcb = false;
    } else {
      s.oosT = 0;
      f.genMW = 0;
      f.genMVAR = 0;
      // Off line the flux decays/builds towards the field current with the open-circuit time constant.
      s.flux = lagTo(s.flux ?? 0, s.If, 3, dt);
      f.genKV = (s.flux * (s.n / DES.RPM) + 0.005 * (s.n / DES.RPM)) * DES.GEN_KV;
      f.genKA = 0;
      f.loadAngle = 0;
    }
    f.genFreq = fGen;
    f.outOfStep = s.oosT > 0.3 || s.oopT > 0;
    const iPu = f.genKA / 21.6;
    s.Tst = lagTo(s.Tst, 40 + 62 * iPu * iPu, 900, dt);
    s.Trot = lagTo(s.Trot, 40 + 65 * (s.If / 1.75) ** 2, 600, dt);
  }

  // ------------------------------------------------------------------ lube oil, bearings, metal temps, aux power
  #auxiliaries(dt, u) {
    const s = this.s;
    const f = this.f;
    const nr = s.n / DES.RPM;
    // Lube oil
    let lo = Math.max(s.mot.AOP.run ? 0.17 : 0, s.mot.EOP.run ? 0.12 : 0, 0.2 * nr * nr);
    if (u.MF_LO_LEAK) lo -= 0.09;
    s.loP = lagTo(s.loP, Math.max(0, lo), 0.5, dt);
    s.loT = lagTo(s.loT, 38 + 8 * nr, 300, dt);
    // Bearings
    for (let i = 0; i < BEARINGS.length; i++) {
      let t = s.loT + nr * (30 + 4 * (i % 3));
      if (s.loP < 0.06 && s.n > 100) t += 90 * nr * clamp((0.06 - s.loP) / 0.06, 0, 1) + 20;
      if (i === 2 && u.MF_VIB_HIGH) t += 8;
      s.brgT[i] = lagTo(s.brgT[i], t, s.loP < 0.06 && s.n > 100 ? 20 : 90, dt);
    }
    // Rotor bow: develops on a hot stationary rotor, straightens on turning gear
    if (s.n < 1 && s.Thp > 150) s.bow = Math.min(250, s.bow + ((s.Thp - 150) / 150) * 0.02 * dt);
    else if (s.n >= 1) s.bow = Math.max(8, s.bow - (s.bow - 8) * Math.min(1, dt / 1200));
    s.vibKick = Math.max(0, s.vibKick - s.vibKick * Math.min(1, dt / 8));

    // Turbine metal temperatures
    const flowHp = f.mHp;
    const tSteamHp = flowHp > 2 ? s.Tsh2 - 30 * clamp(1 - flowHp / TD.Wdes, 0, 1) - 10 : null;
    s.Thp = tSteamHp !== null ? lagTo(s.Thp, tSteamHp, 1800 * Math.pow(DES.MS_FLOW / Math.max(flowHp, 30), 0.3), dt) : lagTo(s.Thp, s.amb, 150000, dt);
    s.Tip = f.mIp > 2 ? lagTo(s.Tip, s.Trh - 15, 2000 * Math.pow(TD.Wrh / Math.max(f.mIp, 30), 0.3), dt) : lagTo(s.Tip, s.amb, 120000, dt);

    // Fan power (templates 7400 - 7402): total pressure ~ flow^2, air / gas density 3303 / 3304
    f.fanKw = {};
    for (const p of ['A', 'B']) {
      const wa = s.fdFlow[p];
      const fd = FAN.FD;
      const acfmFd = (wa / fd.dens) * 2118.88;
      const dpFd = fd.dp * (wa / (GD.Wa / 2)) ** 2;
      f.fanKw[`FD_${p}`] = s.mot[`FD_${p}`].run ? (((dpFd * acfmFd) / 6356) / 1.341022 / fd.eff) * (1 + 0.3 * (1 - s.act[`FD_${p}_PITCH`] / 100)) + 60 : 0;
      const id = FAN.ID;
      const wgId = (f.Wg / 2) * s.idRun[p] * (1 + f.ahLeak / 100);
      const acfmId = (wgId / (id.dens * (401 / (273.15 + (f.tStack ?? 130))))) * 2118.88;
      const dpId = id.dp * (wgId / (GD.Wg / 2)) ** 2 + 0.4 * (-s.Pf / 249.1);
      const vane = Math.max(0.05, s.act[`ID_${p}_VANE`] / 100);
      f.fanKw[`ID_${p}`] = s.mot[`ID_${p}`].run ? (((Math.max(0, dpId) * acfmId) / 6356) / 1.341022 / (id.eff * (0.45 + 0.55 * vane))) + 120 : 0;
    }

    // Aux power
    let kw = 4500 + 1500 * clamp(f.L, 0, 1);
    for (const [name] of MOTORS) {
      const m = s.mot[name];
      if (!(m.run || m.startT > 0) || name.startsWith('BFP')) continue;
      kw += this.#motorKw(name);
    }
    kw += f.bfpKw;
    f.auxMW = kw / 1000;
  }

  /** Electrical input [kW] of a running motor. */
  #motorKw(name) {
    const f = this.f;
    if (f.fanKw && f.fanKw[name] !== undefined) return f.fanKw[name];
    if (name.startsWith('CEP_')) {
      const n = (this.s.mot.CEP_A.run ? 1 : 0) + (this.s.mot.CEP_B.run ? 1 : 0);
      return n > 0 ? (f.cepKw ?? 0) / n : 0;
    }
    return MOTOR_DATA[name].kw * 0.85;
  }

  #amps(name, kw) {
    const m = this.s.mot[name];
    if (m.startT > 0) return (MOTOR_DATA[name].kw / (1.732 * 6.6 * 0.88)) * 5.5;
    if (!m.run) return 0;
    return kw / (1.732 * 6.6 * 0.88);
  }

  // ------------------------------------------------------------------ measurements
  /** Builds the transmitter / status values published to the I/O map. */
  measure() {
    const s = this.s;
    const f = this.f;
    const nz = (sd) => sd * gauss();
    const g = (pAbs) => (pAbs - P_ATM) * 10; // bar(g)
    const out = {};
    const th = (kgs) => kgs * 3.6;
    const lvl = f.level;
    const lt = (off) => clamp(lvl + off + nz(2.5), -500, 500);
    out.DRUM_PRESS = g(f.Pd);
    out.DRUM_LVL_A = this.lastInputs.MF_DRUM_LT_A_FAIL ? 480 : lt(3);
    out.DRUM_LVL_B = lt(-2);
    out.DRUM_LVL_C = lt(0);
    out.DRUM_TEMP = s.Td;
    out.DRUM_METAL_DT = s.TmDrumDT;
    out.FW_FLOW = th(f.qMain) + nz(3);
    out.FW_TEMP = s.Tfw;
    out.FW_HDR_PRESS = g(f.Ph);
    out.ECO_OUT_TEMP = f.tEco;
    out.STEAM_FLOW = Math.max(0, th(f.mHp + f.mHpb + f.mVent + f.mSv) + nz(3));
    out.MS_PRESS = g(f.Pms) + (this.msDrift || 0) * 10;
    out.MS_TEMP = s.Tsh2 + nz(0.3);
    out.SH1_OUT_TEMP = s.Tsh1;
    out.DSH_OUT_TEMP = f.Tdsh;
    out.SH_SPRAY_FLOW = th(f.mShs);
    out.SH_METAL_TEMP = s.Tsh2 + (f.mOut > 5 ? 25 * clamp(f.L, 0, 1.2) + 10 : 0) + (f.wetSH ? -30 : 0);
    out.CRH_PRESS = g(f.Pcrh);
    out.CRH_TEMP = f.Tcrh;
    out.HRH_PRESS = g(s.Prh);
    out.HRH_TEMP = s.Trh + nz(0.3);
    out.RH_SPRAY_FLOW = th(f.qRhs);
    out.RH_METAL_TEMP = s.Trh + (f.mCrhIn > 5 ? 30 * clamp(f.L, 0, 1.2) + 10 : 0);
    out.HPB_POS = s.act.HPB;
    out.HPB_FLOW = th(f.mHpb);
    out.HPB_OUT_TEMP = f.mHpb > 0.5 ? st.tSteam(f.Pcrh, f.hHpbOut) : s.amb + (s.Tsh2 - s.amb) * 0.3;
    out.LPB_POS = s.act.LPB;
    out.LPB_FLOW = th(f.mLpb);
    out.VENT_FLOW = th(f.mVent);
    out.SAFETY_FLOW = th(f.mSv);
    out.BLOWDOWN_FLOW = th(f.mBd);

    // furnace pressure in mbar
    out.FURN_PRESS_A = (s.Pf + nz(12)) / 100;
    out.FURN_PRESS_B = (s.Pf + nz(12) + 5) / 100;
    out.FURN_PRESS_C = (s.Pf + nz(12) - 4) / 100;
    out.AIR_FLOW = th(s.airFlow) + nz(8);
    out.FD_A_FLOW = th(s.fdFlow.A);
    out.FD_B_FLOW = th(s.fdFlow.B);
    out.FD_A_PITCH_FB = s.act.FD_A_PITCH;
    out.FD_B_PITCH_FB = s.act.FD_B_PITCH;
    out.ID_A_VANE_FB = s.act.ID_A_VANE;
    out.ID_B_VANE_FB = s.act.ID_B_VANE;
    for (const fan of ['FD_A', 'FD_B', 'ID_A', 'ID_B']) out[`${fan}_AMPS`] = this.#amps(fan, this.#motorKw(fan));
    out.O2 = s.o2 + nz(0.02);
    out.CO = f.co;
    out.NOX = f.qFuel > 5 ? clamp(95 + 25 * (s.o2 - 2) + 70 * clamp(f.L, 0, 1.2) + 0.25 * ((f.aft ?? 1900) - 1960), 20, 500) : 0;
    out.FEGT = s.fegt;
    out.ECO_GAS_OUT_T = f.tg[4];
    out.APH_GAS_OUT_T = f.tStack;
    out.APH_AIR_OUT_T = s.tAirHot;
    out.GAS_SUPPLY_PRESS = s.gasSup * 10; // bar(g)
    out.GAS_HDR_PRESS = (s.gasHdr + (s.gasHdr > 1 ? nz(0.4) : 0)) * 10; // mbar(g)
    out.GAS_FLOW = th(f.gasTotal);
    out.GAS_TEMP = 22;
    out.GFCV_FB = s.act.GFCV;
    for (const x of ELEVS) out[`GAS_${x}_FLOW`] = th(f.gasElev[x]);
    out.FUEL_HEAT = f.qFuel;
    out.TILT_FB = s.act.TILT;
    out.SH_SPRAY_FB = s.act.SH_SPRAY;
    out.RH_SPRAY_FB = s.act.RH_SPRAY;
    out.FCV_FB = s.act.FCV;
    out.DA_CV_FB = s.act.DA_CV;
    out.MAKEUP_FB = s.act.MAKEUP;
    out.PEG_FB = s.act.PEG;
    out.CBD_FB = s.act.CBD;

    out.SPEED_A = s.n + nz(0.3);
    out.SPEED_B = s.n + nz(0.3);
    out.SPEED_C = s.n + nz(0.3);
    out.GV_POS = s.act.GV;
    out.ICV_POS = s.act.ICV;
    out.FIRST_STAGE_PRESS = f.mHp > 1 ? g(f.P1) : g(Math.max(P_ATM, f.Pcrh * 0.3 + P_ATM * 0.7));
    out.HP_EXH_TEMP = f.Thpx;
    out.HP_METAL_TEMP = s.Thp;
    out.IP_METAL_TEMP = s.Tip;
    out.CROSS_PRESS = g(s.Pcross);
    const crit = (n, c, w) => Math.exp(-(((n - c) / w) ** 2));
    const n = s.n;
    const nr = n / DES.RPM;
    const bowEff = (s.bow - 8) * (0.4 + 2.5 * Math.max(crit(n, 1980, 180), crit(n, 2280, 180))) * (n > 50 ? 1 : 0);
    const vibBase = [
      18 + 22 * nr * nr + 55 * crit(n, 2280, 108),
      16 + 20 * nr * nr + 50 * crit(n, 2280, 108),
      20 + 25 * nr * nr + 70 * crit(n, 1980, 108),
      19 + 22 * nr * nr + 60 * crit(n, 1980, 108),
      15 + 20 * nr * nr + 60 * crit(n, 1260, 96),
      14 + 18 * nr * nr + 55 * crit(n, 1260, 96),
    ];
    BEARINGS.forEach((b, i) => {
      let v = n > 30 ? vibBase[i] * clamp(n / 300, 0, 1) + bowEff * (i < 4 ? 1 : 0.4) + s.vibKick : 2;
      if (i === 2 && this.lastInputs.MF_VIB_HIGH) v += (this.lastInputs.MF_VIB_SEV ?? 150) * clamp(n / DES.RPM, 0.2, 1);
      if (s.loP < 0.06 && n > 100) v += 120;
      out[`VIB_${b}`] = Math.max(0, v + nz(1.2));
      out[`BRG_T_${b}`] = s.brgT[i];
    });
    out.ECCENTRICITY = n < 720 ? s.bow + 6 + nz(0.5) : 0;
    out.AXIAL_DISP = 0.15 + 0.3 * clamp(f.pMech / DES.MW, 0, 1.2) + nz(0.003);
    out.LO_PRESS = s.loP * 10; // bar(g)
    out.LO_TEMP = s.loT;
    out.COND_PRESS = f.PcondKpa * 10; // mbar(a)
    out.LP_HOOD_TEMP = f.lpHood;
    out.HW_LVL = s.Mhw / DES.HW_KG_PER_MM + nz(2);
    out.CEP_FLOW = th(f.mCep);
    out.CEP_PRESS = f.cepPress * 10;
    out.DA_LVL = f.daLevel + nz(3);
    out.DA_PRESS = g(s.Pda);
    out.DA_TEMP = s.Tda;
    for (const p of ['A', 'B', 'C']) {
      out[`BFP_${p}_SPEED`] = s.bfpN[p];
      out[`BFP_${p}_FLOW`] = th(f.bfpQ[p]);
      out[`BFP_${p}_AMPS`] = f.bfpAmps[p];
    }
    out.CW_FLOW = th(s.mcw);
    out.CW_IN_T = s.cwIn;
    out.CW_OUT_T = f.cwOut;
    out.GLAND_PRESS = s.v.GLAND > 0.5 ? 250 + nz(3) : 0; // mbar(g)

    out.GEN_MW = f.genMW;
    out.GEN_MVAR = f.genMVAR;
    out.GEN_KV = f.genKV;
    out.GEN_KA = f.genKA;
    out.GEN_FREQ = f.genFreq;
    const sva = Math.hypot(f.genMW, f.genMVAR);
    out.GEN_PF = sva > 1 ? f.genMW / sva : 0;
    out.GRID_FREQ = s.fg;
    out.GRID_KV = s.vg * DES.GRID_KV;
    out.SYNC_PHASE = s.gcb ? 0 : s.phase;
    out.SYNC_SLIP = s.gcb ? 0 : f.genFreq - s.fg;
    out.FIELD_AMPS = s.If * 2400;
    out.FIELD_VOLTS = s.If * 2400 * 0.11;
    out.LOAD_ANGLE = f.loadAngle;
    out.STATOR_TEMP = s.Tst;
    out.ROTOR_TEMP = s.Trot;
    out.H2_TEMP = 38 + 6 * clamp(f.genKA / 21.6, 0, 1.2);
    out.AUX_MW = f.auxMW;
    out.NET_MW = f.genMW - f.auxMW;

    // Discrete inputs
    out.SIM_FROZEN = false;
    for (const [name] of MOTORS) {
      out[`${name}_RUN`] = s.mot[name].run;
      out[`${name}_TRIP`] = s.mot[name].trip;
    }
    out.TG_ENGAGED = s.tgEng;
    out.MSV_OPEN = s.v.MSV > 0.98;
    out.RSV_OPEN = s.v.RSV > 0.98;
    out.EBD_OPEN = s.v.EBD > 0.5;
    out.SH_VENT_OPEN = s.v.SH_VENT > 0.5;
    out.GLAND_ON = s.v.GLAND > 0.5;
    out.VB_OPEN = s.v.VB > 0.5;
    out.HPH_IN_SERVICE = s.v.HPH > 0.98;
    out.SPRAY_BLOCK_OPEN = s.v.SPRAY_BLOCK > 0.98;
    out.HW_DUMP_OPEN = s.v.HW_DUMP > 0.5;
    out.MGTV_OPEN = s.v.MGTV > 0.98;
    out.MGTV_CLOSED = s.v.MGTV < 0.02;
    out.GAS_VENT_OPEN = s.v.GAS_VENT > 0.5;
    for (const x of ELEVS) {
      out[`BRN_${x}_OPEN`] = s.v[`BRN_${x}`] > 0.98;
      out[`IGN_${x}_FLAME`] = s.ign[x];
      out[`FLAME_${x}`] = s.flame[x];
    }
    out.GCB_CLOSED = s.gcb;
    out.FCB_CLOSED = s.fcb;
    out.OUT_OF_STEP = f.outOfStep;
    out.GEN_DIFF_RELAY = !!this.lastInputs.MF_GEN_FAULT;
    out.MECH_OVERSPEED = s.mechOS;
    out.SAFETY_VLV_LIFT = s.svLift;
    out.MFT_HW = f.mftHW;
    out.TURB_TRIP_HW = f.turbTripHW;
    out.BMS_WD_FAIL = !!this.lastInputs._bmsWdFail;
    out.DEH_WD_FAIL = !!this.lastInputs._dehWdFail;
    out.FURNACE_PUFF = s.puffT > 0;

    // Heat cycle instrumentation (feedwater heaters, extractions, cycle points)
    const x = f.exp;
    out.HW_TEMP = s.Tc;
    out.BFP_DISCH_T = f.tBfpOut;
    out.CROSS_TEMP = f.mIp > 1 ? x.tX : s.Tip * 0.5 + s.amb * 0.5;
    out.APH_AIR_IN_T = f.tAirIn;
    out.APH_O2_OUT = f.qFuel > 5 ? f.o2AhOut + nz(0.02) : 20.9;
    out.AFT = f.qFuel > 5 ? f.aft : 0;
    for (const nm of HEATERS) {
      const h = s.htr[nm];
      const pe = x.pExt[nm];
      out[`${nm}_FW_OUT_T`] = h.tOut;
      out[`${nm}_DRN_T`] = h.drainT;
      out[`${nm}_EXT_P`] = pe * 10; // bar(a)
      out[`${nm}_EXT_T`] = h.ext > 0.2 ? x.tExt[nm] : Math.min(x.tExt[nm], st.tsat(pe));
      out[`${nm}_EXT_FLOW`] = th(h.ext);
    }
    out.DA_EXT_FLOW = th(s.extDA);
    out.LPH1_FW_IN_T = s.Tc + 0.3;

    // EtaPRO performance calculations from the measurements (2 s cycle)
    Object.assign(out, this.perf.update(s.t, out, this));
    out.BOILER_EFF = out.PERF_BLR_EFF;
    return out;
  }

  /** Slowly drifting transmitter malfunction (applied outside the physics). */
  updateDrifts(dt, u) {
    if (u.MF_MS_PT_DRIFT) this.msDrift = Math.min(3, (this.msDrift || 0) + (0.5 / 60) * dt);
    else this.msDrift = 0;
  }

  /** Small summary used in logs and tests. */
  summary() {
    const o = this.measure();
    return {
      t: this.s.t,
      MW: o.GEN_MW,
      MS_P: o.MS_PRESS,
      MS_T: o.MS_TEMP,
      RH_T: o.HRH_TEMP,
      LVL: median3(o.DRUM_LVL_A, o.DRUM_LVL_B, o.DRUM_LVL_C),
      FURN: o.FURN_PRESS_B,
      O2: o.O2,
      SPEED: o.SPEED_A,
      COND: o.COND_PRESS,
      FUEL: o.FUEL_HEAT,
    };
  }
}


