/**
 * Design data of the unit and its design heat balance at MCR, solved with the calculation
 * library (src/plant/calc). The heat balance calibrates every constant
 * the dynamic model needs: turbine stage flow coefficients and efficiencies, feedwater heater
 * zones (Tsou), condenser surface (HEI), furnace wall area, convective section UA values and the
 * air heater - so that the process model reproduces the design point exactly and moves off it
 * by the same equations.
 *
 * Design targets: 700 MW gross at 16.8 MPa(a) / 538 C / 538 C with the fuel and air of 100 %
 * boiler demand (DES.Q_FUEL = 1620 MW LHV, DES.AIR_FULL = 624 kg/s - the figures the
 * controllers are scaled to). The throttle flow is solved for 700 MW and the turbine efficiency
 * level for the cycle heat input the boiler delivers from that fuel.
 *
 * Units: SI in the returned object (MPa abs, degC, kg/s, MW, kJ/kg) unless a key says otherwise;
 * `nv` sub-objects are design data in US customary units.
 */
import * as st from '../../common/steam.js';
import { fuel as FU, combustion as CB, fluegas as FG, furnace as FN, turbine as TB, generator as GN, condenser as CD, fwh as FW, boiler as BLR } from '../calc/index.js';
import { DES } from './constants.js';

// ------------------------------------------------------------------ unit conversions
const PSI = 145.0377;
export const toF = (c) => c * 1.8 + 32;
export const toC = (f) => (f - 32) / 1.8;
export const toPsia = (mpa) => mpa * PSI;
export const toMpa = (psia) => psia / PSI;
export const toKpph = (kgs) => kgs * 7.936641;
export const toKgs = (kpph) => kpph / 7.936641;
export const toBtu = (kjkg) => kjkg / 2.326;
export const toKj = (btulb) => btulb * 2.326;
const MW_PER_MMBTUH = 1 / 3.412142;
const LB_PER_KG = 2.20462262;

// ------------------------------------------------------------------ fuel
/** Pipeline natural gas, volume %. */
export const FUEL_COMP = { Methane: 96, Ethane: 2.2, Propane: 0.4, Nitrogen: 0.9, CarbonDioxide: 0.5 };
const ULT_BASE = FU.fuelGasVolumeToMass(FUEL_COMP);
const ultCache = new Map();
/**
 * Ultimate analysis with the heating values scaled to the instructor's LHV
 * [MJ/kg] - the composition stays, the calorific value follows the set point.
 */
export function fuelAnalysis(lhv = DES.GAS_LHV) {
  const key = Math.round(lhv * 1000);
  let u = ultCache.get(key);
  if (!u) {
    const k = lhv / toKj(ULT_BASE.MassLHVLb / 1000);
    u = { ...ULT_BASE, MassHHVLb: ULT_BASE.MassHHVLb * k, MassLHVLb: ULT_BASE.MassLHVLb * k };
    ultCache.set(key, u);
  }
  return u;
}
export const SPEC_HUM = 0.013; // lbm water / lbm dry air (default)

// ------------------------------------------------------------------ gas path (shared by design and model)
/** Wet flue gas enthalpy [kJ/kg] above 25 C at T [C]. */
export const gasH = (fg, tC) => toKj(FG.flueGasEnthalpy(fg, toF(tC)));
/** Inverse of gasH [C]. */
export const gasT = (fg, h) => toC(FG.flueGasTemperature(fg, toBtu(h)));
/** Wet air enthalpy [kJ/kg] above 25 C on the same basis (0.24 Btu/lbm F), so the air heater and the flame energy balance agree. */
export const airH = (tC) => 0.24 * 2.326 * 1.8 * (tC - 25);

/**
 * Convective section: heat [MW] from gas (Wg kg/s, inlet TgIn) to steam / water at mean
 * temperature Ts through UA [kW/K], with the gas temperature falling across the section,
 * and the gas outlet temperature by enthalpy.
 */
export function gasSection(fg, Wg, TgIn, Ts, UA) {
  if (!(Wg > 0.5) || !(UA > 0)) return { q: 0, TgOut: TgIn };
  const cp = (gasH(fg, TgIn) - gasH(fg, TgIn - 100)) / 100;
  const q = (UA * (TgIn - Ts)) / (1 + UA / (2 * Wg * cp)) / 1000;
  return { q, TgOut: gasT(fg, gasH(fg, TgIn) - (q * 1000) / Wg) };
}
/** Section UA at the actual gas flow and gas inlet temperature (clean htc ~ (GIT)^0.6, convective ~ W^0.6). */
export const sectionUA = (UAdes, Wg, WgDes, TgIn, TgInDes, clean = 1) =>
  UAdes * clean * Math.pow(Math.max(0, Wg) / WgDes, 0.6) * Math.pow((Math.max(TgIn, 20) + 273.15) / (TgInDes + 273.15), 0.6);

/** Counter-flow effectiveness with Cr = Cmin / Cmax. */
export function cfEffectiveness(ntu, cr) {
  if (!(ntu > 0)) return 0;
  if (Math.abs(1 - cr) < 1e-6) return ntu / (1 + ntu);
  const e = Math.exp(-ntu * (1 - cr));
  return (1 - e) / (1 - cr * e);
}
/**
 * Regenerative air heater: gas Wg at TgIn, air Wa at TaIn, UA [kW/K]. Returns the no-leak gas
 * outlet (Tgonl), the air outlet, the duty [MW], X-ratio and gas side efficiency.
 */
export function airHeaterHX(fg, Wg, TgIn, Wa, TaIn, UA) {
  if (!(Wg > 0.5) || !(Wa > 0.5) || !(UA > 0)) return { Tgonl: TgIn, TaOut: TaIn, q: 0, x: 0, eff: 0 };
  const cpg = (gasH(fg, TgIn) - gasH(fg, TaIn)) / Math.max(1, TgIn - TaIn);
  const cpa = (airH(TgIn) - airH(TaIn)) / Math.max(1, TgIn - TaIn);
  const Cg = Wg * cpg;
  const Ca = Wa * cpa;
  const Cmin = Math.min(Cg, Ca);
  const eps = cfEffectiveness(UA / Cmin, Cmin / Math.max(Cg, Ca));
  const q = eps * Cmin * (TgIn - TaIn);
  const Tgonl = gasT(fg, gasH(fg, TgIn) - q / Wg);
  const TaOut = TaIn + q / Ca;
  return { Tgonl, TaOut, q: q / 1000, x: (TgIn - Tgonl) / Math.max(0.1, TaOut - TaIn), eff: (100 * (TgIn - Tgonl)) / Math.max(1, TgIn - TaIn) };
}
/** Air heater UA [kW/K] at the actual gas and air flows (each side film ~ W^0.6, equal design resistances). */
export const ahUA = (UAdes, Wg, WgDes, Wa, WaDes) =>
  Wg > 0.5 && Wa > 0.5 ? (2 * UAdes) / (Math.pow(WgDes / Wg, 0.6) + Math.pow(WaDes / Wa, 0.6)) : 0;

/**
 * Available energy [kJ/kg wet gas] with combustion air at tAir [C], and the
 * adiabatic flame temperature [C].
 */
export function flame(ult, fg, tAir, radLossPct) {
  const a = FG.adiabaticFlameTemp(ult, fg, { radLoss: radLossPct, tAirOut: toF(tAir) });
  return { aft: toC(a.tF), avail: toKj(a.availEnergy), raw: a };
}
/** Available energy only [kJ/kg wet gas] (no temperature solve). */
export function availEnergy(ult, fg, tAir, radLossPct) {
  const avail =
    (ult.MassHHVLb * (1 - radLossPct / 100) + 0.24 * fg.WetAirPerlbFuel * (toF(tAir) - 77) - 1030 * ((8.936 * ult.Hydrogen) / 100 + ult.Moisture / 100)) /
    fg.WetGasPerlbFuel;
  return toKj(avail);
}
// ------------------------------------------------------------------ design data
/** Turbine form ("Utility Steam Turbine", US units) - '62 GL inputs. */
export const NV_TURBINE = {
  throttleP: toPsia(16.8),
  throttleT: toF(538),
  reheatT: toF(538),
  hpBaseEff: 87.0,
  hpSections: 1,
  pitchDia: 40,
  fapFlowRatio: 0.62, // first admission point (partial arc)
  reheatBaseEff: 91.0,
  annulusArea: 4 * 76.5, // ft2, 4 exhaust flows, 33.5 in last blades
  n2Frac: 0.012, // N2 packing leakage, fraction of throttle flow
  genH2Psig: 60,
};
/** Design stage pressures at MCR [MPa abs]. */
const P_DES = { thr: 16.8, first: 12.4, e7: 6.0, crh: 4.3, rh: 3.97, cross: 0.95, e4: 0.42, e3: 0.19, e2: 0.075, e1: 0.026 };
const EXT_LINE_LOSS = 0.03; // extraction line pressure drop (flange -> shell)
/** Heater design terminal differences [C] (TTD, DCA) and zone U values [Btu/h ft2 F]. */
const HEATER_SPEC = {
  LPH1: { ext: 'e1', ttd: 2.8, dca: 5.6, zones: [true, true, false], U: [350, 0, 0], tubes: 1250, kTube: 9.4 },
  LPH2: { ext: 'e2', ttd: 2.8, dca: 5.6, zones: [true, true, false], U: [350, 0, 0], tubes: 1250, kTube: 9.4 },
  LPH3: { ext: 'e3', ttd: 2.8, dca: 5.6, zones: [true, true, false], U: [380, 0, 0], tubes: 1250, kTube: 9.4 },
  LPH4: { ext: 'e4', ttd: 2.8, dca: 5.6, zones: [true, true, true], U: [380, 0, 130], tubes: 1250, kTube: 9.4 },
  HPH6: { ext: 'crh', ttd: 0, dca: 5.6, zones: [true, true, true], U: [420, 0, 140], tubes: 2100, kTube: 26 },
  HPH7: { ext: 'e7', ttd: -1.7, dca: 5.6, zones: [true, true, true], U: [420, 0, 150], tubes: 2100, kTube: 26 },
};
export const HEATERS = ['LPH1', 'LPH2', 'LPH3', 'LPH4', 'HPH6', 'HPH7'];
/** Condenser form (HEI), titanium 1 in BWG 22 tubes, single pass; area solved for the design TTD. */
const COND_SPEC = { passes: 1, od: 1.0, wall: 22, material: 10, cleanDesign: 0.85, cleanTarget: 0.85, subcoolBias: 0, ttdC: 3.5, velocity: 7.0 };
/** Boiler form. */
export const NV_BOILER = { cooledWalls: 4, o2Basis: 1, unaccountedLoss: 0.5, beamLengthFt: 38, burnerHeight: 0.32, psiClean: 0.62, tGonlC: 128, ahLeakage: 7 };

const SH_SPRAY_DES = 25; // kg/s at MCR
const TSH1_DES = 450; // primary SH outlet [C]
const DRUM_P_DES = DES.DRUM_P; // MPa(a)
const ECO_RISE_DES = 100; // kJ/kg economizer enthalpy rise at MCR (gas-fired: small economizer, ~60 K subcooled outlet)
const T_AMB_DES = 30;
const T_AIR_HOT_DES = 315; // air heater air outlet at MCR [C]
const FEGT_DES = 1180; // furnace exit gas temperature at MCR [C]
const CW_IN_DES = 25;
const CW_FLOW_DES = 2 * DES.CW_PUMP_FLOW; // kg/s

// ------------------------------------------------------------------ helpers
const hPT = (P, T) => st.hSteam(P, T);
const sPT = (P, T) => st.sSteam(P, T);
/** Expansion end point enthalpy [kJ/kg] at Pout from (hin, sin) at efficiency eta. */
const expand = (hin, sin, Pout, eta) => hin - eta * (hin - st.hPS(Pout, sin));
const tPH = (P, h) => st.tSteam(P, h);
const sPH = (P, h) => st.sPH(P, h);
const hLiqPT = (P, T) => st.hWater(Math.max(P, st.psat(T) + 0.01), T);
/** Power [MW] of a flow [kg/s] through an enthalpy drop [kJ/kg]. */
const flowPower = (kgs, dhKj) => (kgs * dhKj) / 1000;

/** Stodola ellipse coefficient K [kg/s per MPa / sqrt(MPa m3/kg)] of a stage group. */
export const stodolaK = (W, Pin, Pout, pvIn) => W / Math.sqrt(Math.max(1e-9, (Pin * Pin - Pout * Pout) / pvIn));
/** Stage group inlet pressure for a flow W, outlet pressure and inlet p*v (inverse ellipse). */
export const stodolaPin = (K, W, Pout, pvIn) => Math.sqrt(Pout * Pout + (W / K) ** 2 * pvIn);

// ------------------------------------------------------------------ design heat balance
/**
 * Turbine cycle at MCR for a throttle flow W [kg/s] and an efficiency level etaScale. Returns
 * stage states, extraction flows (heater balances), section powers
 * by group, the LP expansion end points, condenser pressure and the
 * cycle heat input.
 */
function turbineCycle(W, etaScale) {
  const P = P_DES;
  const nvT = NV_TURBINE;
  const hThr = hPT(P.thr, 538);
  const sThr = sPT(P.thr, 538);
  const etaHp = (0.86 * etaScale);
  const h1 = expand(hThr, sThr, P.first, etaHp);
  const hE7 = expand(hThr, sThr, P.e7, etaHp);
  const hCrh = expand(hThr, sThr, P.crh, etaHp);
  const Wn2 = nvT.n2Frac * W;
  // IP: bowl mix of hot reheat and N2 leakage
  const hRh = hPT(P.rh, 538);
  // FW chain temperatures from TTD (outlet) and DCA (drain)
  const sh = (k) => (1 - EXT_LINE_LOSS) * P[HEATER_SPEC[k].ext];
  const tOut = (k) => st.tsat(sh(k)) - HEATER_SPEC[k].ttd;

  let Pc = 0.007;
  let res;
  for (let it = 0; it < 12; it++) {
    const tHw = st.tsat(Pc);
    const Pcep = 2.6;
    const Pda = (1 - EXT_LINE_LOSS) * 0.95 * P.cross;
    const tDa = st.tsat(Pda);
    const Pfw = 20.6;
    // BFP work: dh = v dP / eta
    const vDa = 1 / st.rhof(Pda);
    const dhBfp = (vDa * (Pfw - Pda) * 1000) / 0.82;
    const hBfp = st.hf(Pda) + dhBfp;
    const tBfp = st.water(Pfw, tDa).h < hBfp ? solveTLiq(Pfw, hBfp) : tDa;
    // HP heaters (FW flow = throttle flow; spray taken after the HP heaters)
    const t6 = tOut('HPH6');
    const t7 = tOut('HPH7');
    const hFw6 = hLiqPT(Pfw, t6);
    const hFw7 = hLiqPT(Pfw - 0.1, t7);
    const hD7 = hLiqPT(sh('HPH7'), t6 + HEATER_SPEC.HPH7.dca);
    const hD6 = hLiqPT(sh('HPH6'), tBfp + HEATER_SPEC.HPH6.dca);
    const W7 = (W * (hFw7 - hFw6)) / (hE7 - hD7);
    const W6 = (W * (hFw6 - hBfp) - W7 * (hD7 - hD6)) / (hCrh - hD6);
    // IP turbine
    const Wrh = W - Wn2 - W7 - W6; // the N2 packing leakage bypasses the reheater into the IP bowl
    const Wbowl = Wrh + Wn2;
    const hBowl = (Wrh * hRh + Wn2 * h1) / Wbowl;
    const Pbowl = 0.98 * P.rh;
    const sBowl = sPH(Pbowl, hBowl);
    const nvIp = {
      reheatP: toPsia(P.rh), reheatT: toF(538), reheatDesFlow: toKpph(Wbowl), n2DesFlow: toKpph(Wn2), n2DesEnth: toBtu(h1), ipExhP: toPsia(P.cross), ipExhDp: 0,
    };
    const etaIp = (TB.designIpEff(nvIp) / 100) * etaScale;
    const hX = expand(hBowl, sBowl, P.cross, etaIp);
    const tX = tPH(P.cross, hX);
    // DA balance (condensate flow unknown): W_fw h_da = Wc h_c + W_hpdr h_d6 + W5 h_x
    const hDa = st.hf(Pda);
    const tLph4 = tOut('LPH4');
    const hC = hLiqPT(Pcep, tLph4);
    const Whpd = W7 + W6;
    const W5 = (W * (hDa - hC) - Whpd * (hD6 - hC)) / (hX - hC);
    const Wlp = Wbowl - W5;
    const Wc = W - Whpd - W5; // condensate through the LP heaters (= Wlp)
    // LP expansion line (from the crossover, base efficiency scaled)
    const nvLp = { reheatBaseEff: nvT.reheatBaseEff * etaScale, reheatDesFlow: toKpph(Wlp), reheatP: toPsia(P.cross), reheatT: toF(tX), annulusArea: nvT.annulusArea };
    // extraction states on the LP line
    const sX = sPH(P.cross, hX);
    // LP heaters top-down (drains cascade)
    const lp = {};
    let drainIn = 0;
    let hDrainIn = 0;
    let Wext = 0;
    const lpChain = ['LPH4', 'LPH3', 'LPH2', 'LPH1'];
    // first pass needs the LP efficiency: iterate it with the ELEP result
    let etaLp = 0.88;
    let u;
    for (let k = 0; k < 6; k++) {
      drainIn = 0;
      hDrainIn = 0;
      Wext = 0;
      for (const name of lpChain) {
        const spec = HEATER_SPEC[name];
        const Pe = P[spec.ext];
        const hE = expand(hX, sX, Pe, etaLp);
        const tIn = name === 'LPH1' ? tHw + 0.3 : tOut(lpChain[lpChain.indexOf(name) + 1]);
        const hIn = hLiqPT(Pcep, tIn);
        const hOut = hLiqPT(Pcep, tOut(name));
        const hD = hLiqPT(sh(name), tIn + spec.dca);
        const We = (Wc * (hOut - hIn) - drainIn * (hDrainIn - hD)) / (hE - hD);
        lp[name] = { Pe, hE, tIn, tOut: tOut(name), We, hD, tD: tIn + spec.dca, drainIn, hDrainIn };
        drainIn += We;
        hDrainIn = hD;
        Wext += We;
      }
      const Wexh = Wlp - Wext;
      u = TB.ueepReheat(toPsia(P.cross), toF(tX), toKpph(Wlp), 0, 0, toPsia(Pc), toKpph(Wexh), nvLp);
      const etaNew = (hX - toKj(u.elep)) / (hX - st.hPS(Pc, sX));
      if (Math.abs(etaNew - etaLp) < 1e-6) break;
      etaLp = etaNew;
    }
    const Wexh = Wlp - Wext;
    const ueep = toKj(u.ueep);
    // powers [MW] by group
    const pHp = flowPower(W, hThr - h1) + flowPower(W - Wn2, h1 - hE7) + flowPower(W - Wn2 - W7, hE7 - hCrh);
    const pIp = flowPower(Wbowl, hBowl - hX);
    const hL = [hX, lp.LPH4.hE, lp.LPH3.hE, lp.LPH2.hE, lp.LPH1.hE];
    let Wg = Wlp;
    let pLp = 0;
    const ws = [lp.LPH4.We, lp.LPH3.We, lp.LPH2.We, lp.LPH1.We];
    for (let i = 0; i < 4; i++) {
      pLp += flowPower(Wg, hL[i] - hL[i + 1]);
      Wg -= ws[i];
    }
    pLp += flowPower(Wg, hL[4] - ueep);
    // condenser: exhaust + LPH1 drains flashing
    const hfC = st.hf(Pc);
    const qCond = (Wexh * (ueep - hfC) + drainIn * (lp.LPH1.hD - hfC)) / 1000; // MW
    const cond = condenserDesignPressure(qCond, CW_FLOW_DES, CW_IN_DES);
    res = {
      W, Wn2, W7, W6, W5, Wrh, Wbowl, Wlp, Wexh, Wc, Whpd, lp, hThr, sThr, h1, hE7, hCrh, hRh, hBowl, sBowl, hX, tX, sX, etaHp, etaIp, etaLp,
      elep: toKj(u.elep), ueep, exhLoss: u.exhaustLoss, annulusVel: u.annulusVelocity, Pc, qCond, cond, pHp, pIp, pLp, Pda, tDa, hDa, hBfp, tBfp, dhBfp,
      t6, t7, hFw6, hFw7, hD6, hD7, Pfw, Pcep, tHw, tLph4, hC, nvIp, nvLp,
    };
    if (!cond || Math.abs(cond.P - Pc) < 1e-7) break;
    Pc = cond.P;
  }
  // generator
  const shaft = res.pHp + res.pIp + res.pLp;
  const mech = GN.mechanicalLosses(DES.MVA * 1000);
  const mvar = Math.sqrt(DES.MVA ** 2 - DES.MW ** 2);
  const gen = GN.generatorLosses(shaft - mech, mvar, NV_TURBINE.genH2Psig, DES.MVA * 1000);
  res.shaft = shaft;
  res.mech = mech;
  res.genLoss = gen;
  res.MW = shaft - mech - gen;
  res.Qcycle = (W * (hPT(P.thr, 538) - res.hFw7) + res.Wrh * (res.hRh - res.hCrh)) / 1000;
  res.tchr = (res.Qcycle * 3600) / res.MW; // kJ/kWh
  return res;
}

function solveTLiq(P, h) {
  let lo = 1;
  let hi = st.tsat(P) - 0.01;
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2;
    if (st.water(P, m).h < h) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** HEI condenser at the design CW flow: area for the design TTD (only before the area is known), else pressure. */
let condNv = null;
function condenserNv(qMW, Wcw, Tcw) {
  const gpm = (Wcw / 997) * 15850.32;
  const trise = CD.cwTempRise(qMW * 3.412142, gpm);
  const consts = CD.condenserConstants({ ...COND_SPEC, area: 1, tubes: 1 });
  const tubes = Math.round((gpm * COND_SPEC.passes) / (consts.gpmPerTube * COND_SPEC.velocity));
  // TTD = rise / (1 - e^-HF) - rise  ->  HF = -ln(1 - rise / (rise + TTD))
  const ttdF = COND_SPEC.ttdC * 1.8;
  const hf = -Math.log(1 - trise / (trise + ttdF));
  const nv0 = { ...COND_SPEC, tubes, area: 1 };
  const u1 = CD.heiU(nv0, gpm, toF(Tcw), COND_SPEC.cleanDesign);
  const area = (hf * 500 * gpm) / u1;
  return { ...COND_SPEC, tubes, area: Math.round(area), desHeatLoad: qMW * 3.412142 };
}
function condenserDesignPressure(qMW, Wcw, Tcw) {
  if (!condNv) condNv = condenserNv(qMW, Wcw, Tcw);
  const gpm = (Wcw / 997) * 15850.32;
  const r = CD.condenserPressure(condNv, qMW * 3.412142, gpm, toF(Tcw), condNv.cleanDesign);
  return { P: st.psat(toC(r.tsat)), tsat: toC(r.tsat), riseC: r.rise / 1.8, ttdC: r.ttd / 1.8 };
}

/** Throttle flow [kg/s] for 700 MW at an efficiency level (secant). */
function cycleFor700(etaScale) {
  let w0 = DES.MS_FLOW;
  let c0 = turbineCycle(w0, etaScale);
  let w1 = w0 * (DES.MW / c0.MW);
  let c1 = turbineCycle(w1, etaScale);
  for (let i = 0; i < 12 && Math.abs(c1.MW - DES.MW) > 1e-4; i++) {
    const w2 = w1 + ((DES.MW - c1.MW) * (w1 - w0)) / (c1.MW - c0.MW);
    w0 = w1;
    c0 = c1;
    w1 = w2;
    c1 = turbineCycle(w1, etaScale);
  }
  return c1;
}

/** Boiler at MCR: heat absorbed [MW] by the steam / water for the fuel and air of 100 % boiler demand. */
function boilerAvailable() {
  const ult = fuelAnalysis(DES.GAS_LHV);
  const fuel = DES.GAS_FLOW_FULL;
  const air = DES.AIR_FULL;
  const EA = CB.excessAirFromAirFuel(ult, air / fuel, { specHum: SPEC_HUM });
  const fg = CB.flueGasFromExcessAir(ult, EA, { specHum: SPEC_HUM });
  const Wg = fuel * fg.WetGasPerlbFuel;
  const heatInHHV = (fuel * LB_PER_KG * 3600 * ult.MassHHVLb) / 1e6; // MMBtu/h
  const radLoss = BLR.radiationLoss(heatInHHV, heatInHHV, NV_BOILER.cooledWalls); // radiation loss at MCR
  const tAirIn = T_AMB_DES + 2; // FD fan temperature rise
  const fl = flame(ult, fg, tAirIn, radLoss);
  const qAbs = (Wg * (fl.avail - gasH(fg, NV_BOILER.tGonlC))) / 1000; // MW
  return { ult, fuel, air, EA, fg, Wg, heatInHHV, radLoss, qAbs, tAirIn };
}

// ------------------------------------------------------------------ design solve
let DESIGN = null;
/** The solved design heat balance (computed once). */
export function design() {
  if (DESIGN) return DESIGN;
  const blr = boilerAvailable();
  // efficiency level so that the cycle heat input at 700 MW equals the boiler's absorption at 100 % demand
  let e0 = 1.0;
  let c0 = cycleFor700(e0);
  let e1 = 0.97;
  let c1 = cycleFor700(e1);
  for (let i = 0; i < 15 && Math.abs(c1.Qcycle - blr.qAbs) > 1e-3; i++) {
    const e2 = e1 + ((blr.qAbs - c1.Qcycle) * (e1 - e0)) / (c1.Qcycle - c0.Qcycle);
    e0 = e1;
    c0 = c1;
    e1 = Math.min(1.08, Math.max(0.8, e2));
    c1 = cycleFor700(e1);
  }
  const cyc = c1;
  DESIGN = { etaScale: e1, cycle: cyc, boiler: blr };
  DESIGN.turbine = turbineConstants(cyc);
  DESIGN.heaters = heaterConstants(cyc);
  DESIGN.condenser = { nv: condNv, ...cyc.cond, qCond: cyc.qCond, cwFlow: CW_FLOW_DES, cwIn: CW_IN_DES };
  DESIGN.gas = gasPathConstants(cyc, blr);
  return DESIGN;
}

/** Stodola coefficients of the stage groups and valve calibration. */
function turbineConstants(c) {
  const P = P_DES;
  const pv = (Pr, h) => Pr * st.vPH(Pr, h);
  const W1 = c.W; // first stage -> E7
  const W2 = c.W - c.Wn2 - c.W7; // E7 -> CRH
  const lpW = [c.Wlp, c.Wlp - c.lp.LPH4.We, c.Wlp - c.lp.LPH4.We - c.lp.LPH3.We, c.Wlp - c.lp.LPH4.We - c.lp.LPH3.We - c.lp.LPH2.We, c.Wexh];
  const lpP = [P.cross, P.e4, P.e3, P.e2, P.e1, c.Pc];
  const lpH = [c.hX, c.lp.LPH4.hE, c.lp.LPH3.hE, c.lp.LPH2.hE, c.lp.LPH1.hE];
  const phi = (r) => (r <= 0.55 ? 1 : Math.sqrt(Math.max(0, 1 - ((r - 0.55) / 0.45) ** 2)));
  const gvDes = 90;
  const tf = 1; // Tms = design
  return {
    P: P_DES,
    Wdes: c.W,
    kGv: c.W / ((gvDes / 100) * P.thr * tf * phi(P.first / P.thr)),
    gvDes,
    kHp1: stodolaK(W1, P.first, P.e7, pv(P.first, c.h1)),
    kHp2: stodolaK(W2, P.e7, P.crh, pv(P.e7, c.hE7)),
    kIp: stodolaK(c.Wbowl, 0.98 * P.rh, P.cross, pv(0.98 * P.rh, c.hBowl)),
    kLp: lpW.map((w, i) => stodolaK(w, lpP[i], lpP[i + 1], pv(lpP[i], lpH[i]))),
    pvDes: { hp1: pv(P.first, c.h1), hp2: pv(P.e7, c.hE7), ip: pv(0.98 * P.rh, c.hBowl), lp: lpP.slice(0, 5).map((p, i) => pv(p, lpH[i])) },
    dpRh: P.crh - P.rh,
    Wrh: c.Wrh,
    etaHp: c.etaHp,
    etaIp: c.etaIp,
    etaLp: c.etaLp,
    n2Frac: NV_TURBINE.n2Frac,
    nvHp: { ...NV_TURBINE, vwoFlow: toKpph(c.W), vwoMW: DES.MW, hpExhP: toPsia(P.crh) },
    nvLp: c.nvLp,
    nvIp: c.nvIp,
    hpEffDes: TB.designHpEff(toKpph(c.W), toPsia(P.thr), toF(538), { ...NV_TURBINE, vwoFlow: toKpph(c.W), vwoMW: DES.MW, hpExhP: toPsia(P.crh) }),
    Pc: c.Pc,
  };
}

/** Feedwater heater design data from the design heat balance; zone areas for the Tsou model. */
function heaterConstants(c) {
  const out = {};
  const spec = HEATER_SPEC;
  const fwP = { LPH1: c.Pcep, LPH2: c.Pcep, LPH3: c.Pcep, LPH4: c.Pcep, HPH6: c.Pfw, HPH7: c.Pfw - 0.1 };
  const rows = {
    LPH1: { ...c.lp.LPH1, fw: c.Wc },
    LPH2: { ...c.lp.LPH2, fw: c.Wc },
    LPH3: { ...c.lp.LPH3, fw: c.Wc },
    LPH4: { ...c.lp.LPH4, fw: c.Wc },
    HPH6: { Pe: P_DES.crh, hE: c.hCrh, tIn: c.tBfp, tOut: c.t6, We: c.W6, tD: c.tBfp + spec.HPH6.dca, drainIn: c.W7, hDrainIn: c.hD7, fw: c.W },
    HPH7: { Pe: P_DES.e7, hE: c.hE7, tIn: c.t6, tOut: c.t7, We: c.W7, tD: c.t6 + spec.HPH7.dca, drainIn: 0, hDrainIn: 0, fw: c.W },
  };
  for (const name of HEATERS) {
    const r = rows[name];
    const s = spec[name];
    const Psh = (1 - EXT_LINE_LOSS) * r.Pe;
    const tsat = st.tsat(Psh);
    const tExt = tPH(r.Pe, r.hE);
    const hfSh = st.hf(Psh);
    const fwW = r.fw;
    const pFw = fwP[name];
    const hTin = hLiqPT(pFw, r.tIn);
    const hTout = hLiqPT(pFw, r.tOut);
    // zone duties [MW]: drain cooler, desuperheater (steam down to Tsat + 30 % of superheat), condensing
    const hDo = hLiqPT(Psh, r.tD);
    const qSub = s.zones[0] ? ((r.We + r.drainIn) * (hfSh - hDo)) / 1000 : 0;
    const superheated = tExt > tsat + 5;
    const hDshOut = superheated ? hPT(Psh, tsat + 0.3 * (tExt - tsat)) : r.hE;
    const qDsh = s.zones[2] && superheated ? (r.We * (r.hE - hDshOut)) / 1000 : 0;
    const qTot = (fwW * (hTout - hTin)) / 1000;
    const qCond = qTot - qSub - qDsh;
    const toMM = (mw) => mw * 3.412142;
    const nv = {
      tubes: s.tubes, plugged: 0, tubeOD: 0.625, tubeID: 0.527, kTube: s.kTube,
      area: [0, 0, 0], U: [s.U[0], 0, s.U[2]], duty: [toMM(qSub), toMM(qCond), toMM(qDsh)],
      fwFlow: toKpph(fwW), fwInP: toPsia(pFw), fwInT: toF(r.tIn), tubeDP: name.startsWith('HPH') ? 12 : 8,
      stmInP: toPsia(Psh), stmInT: toF(Math.max(tExt, tsat + 0.01)), stmInFlow: toKpph(r.We), drainInFlow: toKpph(r.drainIn), drainOutT: toF(r.tD),
      dshShellDP: qDsh > 0 ? 1.0 : 0, subShellDP: 0.5, condLMTD: 0,
    };
    // zone FW temperatures and LMTDs -> areas (the condensing zone U from the Tsou correlation)
    const hz = [hTin];
    for (const q of [qSub, qCond, qDsh]) hz.push(hz[hz.length - 1] + (q * 1000) / fwW);
    const tz = hz.map((h) => solveTLiq(pFw + 2, h));
    tz[0] = r.tIn;
    const lmtdF = (dt1, dt2) => (Math.abs(dt1 - dt2) < 1e-6 ? dt1 : (dt1 - dt2) / Math.log(dt1 / dt2)) * 1.8;
    nv.condLMTD = lmtdF(tsat - tz[1], tsat - tz[2]);
    // condensing zone U from the design resistances
    const pre = FW.heaterDesign({ ...nv, area: [1, 1, nv.duty[2] > 0 ? 1 : 0] });
    const U2 = 1 / (pre.rsd[1] + 0 + pre.rmd + (0.0002 + pre.rtd[1]) * pre.ratio);
    const aSub = qSub > 0 ? (toMM(qSub) * 1e6) / (s.U[0] * lmtdF(tsat - tz[1], r.tD - tz[0])) : 0;
    const aCond = (toMM(qCond) * 1e6) / (U2 * nv.condLMTD);
    const tDshOut = superheated ? tsat + 0.3 * (tExt - tsat) : tExt;
    const aDsh = qDsh > 0 ? (toMM(qDsh) * 1e6) / (s.U[2] * lmtdF(tExt - tz[3], tDshOut - tz[2])) : 0;
    nv.area = [aSub, aCond, aDsh];
    out[name] = { nv, Pext: r.Pe, Psh, tsat, tOut: r.tOut, We: r.We };
  }
  return out;
}

/** Furnace wall area, convective section UAs and the air heater from the design gas and steam states. */
function gasPathConstants(c, b) {
  const W = c.W;
  const spray = SH_SPRAY_DES;
  const Wgen = W - spray;
  const Pd = DRUM_P_DES;
  const Pms = P_DES.thr;
  const Psh1 = (Pd + Pms) / 2;
  const hFw = c.hFw7;
  const hEco = hFw + ECO_RISE_DES;
  const hg = st.hg(Pd);
  const qWW = (Wgen * (hg - hEco)) / 1000;
  const qEco = (Wgen * (hEco - hFw)) / 1000;
  const h1 = hPT(Psh1, TSH1_DES);
  const qSh1 = (Wgen * (h1 - hg)) / 1000;
  const hDsh = (Wgen * h1 + spray * hFw) / W;
  const tDsh = tPH(Pms, hDsh);
  const qSh2 = (W * (hPT(Pms, 538) - hDsh)) / 1000;
  const tCrh = tPH(P_DES.crh, c.hCrh);
  const qRh = (c.Wrh * (c.hRh - c.hCrh)) / 1000;
  // Furnace. With the air heater and flame balances on the same air enthalpy basis the hot air
  // temperature is a free design choice (any value closes the energy balance): it is set by
  // T_AIR_HOT_DES and the air heater UA follows from it.
  const ult = b.ult;
  const fg = b.fg;
  const Wg = b.Wg;
  const fuelLbs = b.fuel * LB_PER_KG;
  const tAirIn = b.tAirIn;
  const Wa = b.air;
  const tAirOut = T_AIR_HOT_DES;
  let res;
  let platenFrac = 0;
  {
    const fl = flame(ult, fg, tAirOut, b.radLoss);
    // radiant absorption for the design FEGT: waterwalls (evaporation) + platen superheater
    const qFurn = (Wg * (fl.avail - gasH(fg, FEGT_DES))) / 1000;
    const qPl = qFurn - qWW;
    // effective radiant surface for that absorption (bisection on area)
    let lo = 5000;
    let hi = 400000;
    let fe;
    for (let i = 0; i < 50; i++) {
      const A = (lo + hi) / 2;
      fe = FN.furnaceExitTemp(ult, fg, fl.raw, fuelLbs, { wallAreaFt2: A, beamLengthFt: NV_BOILER.beamLengthFt, burnerHeight: NV_BOILER.burnerHeight }, { psi: NV_BOILER.psiClean });
      if (fe.furnaceAbsorption * MW_PER_MMBTUH < qFurn) lo = A;
      else hi = A;
    }
    const area = (lo + hi) / 2;
    const fegt = toC(fe.fegt);
    platenFrac = qPl / qFurn;
    // convective pass: final SH bank -> RH -> primary SH -> ECO, gas enthalpy drops by the section duties
    const tg = [fegt];
    const duties = [qSh2 - qPl, qRh, qSh1, qEco];
    for (const q of duties) tg.push(gasT(fg, gasH(fg, tg[tg.length - 1]) - (q * 1000) / Wg));
    const tsMean = [(tDsh + 538) / 2, (tCrh + 538) / 2, (st.tsat(Psh1) + TSH1_DES) / 2, (solveTLiq(Pd + 1.5, hFw) + solveTLiq(Pd + 1.5, hEco)) / 2];
    const UA = duties.map((q, i) => {
      // invert gasSection: q = UA dT / (1 + UA / (2 Wg cp))
      const cp = (gasH(fg, tg[i]) - gasH(fg, tg[i] - 100)) / 100;
      const dT = tg[i] - tsMean[i];
      return (q * 1000) / (dT - (q * 1000) / (2 * Wg * cp));
    });
    // air heater: gas from economizer outlet to the design no-leak gas outlet
    const tGi = tg[4];
    const tGonl = NV_BOILER.tGonlC;
    const qAh = (Wg * (gasH(fg, tGi) - gasH(fg, tGonl))) / 1000;
    const tAo = solveAirOut(tAirIn, (qAh * 1000) / Wa);
    // UA for that duty (counter flow)
    const cpg = (gasH(fg, tGi) - gasH(fg, tAirIn)) / (tGi - tAirIn);
    const cpa = (airH(tGi) - airH(tAirIn)) / (tGi - tAirIn);
    const Cg = Wg * cpg;
    const Ca = Wa * cpa;
    const Cmin = Math.min(Cg, Ca);
    const Cr = Cmin / Math.max(Cg, Ca);
    const eps = (qAh * 1000) / (Cmin * (tGi - tAirIn));
    const ntu = Math.log((1 - eps * Cr) / (1 - eps)) / (1 - Cr);
    const uaAh = ntu * Cmin;
    res = { area, fegt, aft: fl.aft, tg, tsMean, UA, uaAh, tAo, qAh, tGi, duties: { qWW, qEco, qSh1, qSh2, qRh }, hEco, tDsh, tCrh };
  }
  const ahCheck = airHeaterHX(fg, Wg, res.tGi, Wa, tAirIn, res.uaAh);
  return {
    Wg, Wa, fuel: b.fuel, EA: b.EA, fg, radLoss: b.radLoss, heatInHHV: b.heatInHHV, tAirIn,
    wallAreaFt2: res.area, platenFrac, fegt: res.fegt, aft: res.aft, tg: res.tg, tsMean: res.tsMean,
    UA: { sh2: res.UA[0], rh: res.UA[1], sh1: res.UA[2], eco: res.UA[3] },
    uaAh: res.uaAh, tAirOut: res.tAo, tGonl: NV_BOILER.tGonlC, ahX: ahCheck.x, ahEff: ahCheck.eff,
    duties: res.duties, hEco: res.hEco, tDsh: res.tDsh, tCrh: res.tCrh, spray: SH_SPRAY_DES, tsh1: TSH1_DES, Pd: DRUM_P_DES, Psh1,
  };
}
function solveAirOut(tIn, dh) {
  const h0 = airH(tIn) + dh;
  let lo = tIn;
  let hi = 900;
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2;
    if (airH(m) < h0) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
