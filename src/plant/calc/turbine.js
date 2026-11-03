/**
 * Steam turbine performance. Flows in kPPH, pressures in psia,
 * temperatures in F, enthalpies in Btu/lbm, specific volumes in ft3/lbm, power in MW.
 * nv: turbine design data (design heat balance at VWO).
 *
 * Methods: K. C. Cotton, Evaluating and Improving Steam Turbine Performance (1993); Spencer,
 * Cotton & Cannon, A Method for Predicting the Performance of Steam Turbine Generators (1962/74).
 */
import { StmEnth, StmEntropy, StmEntropyPH, StmEnthPS, StmTempPH, StmSpVol, StmSpVolPH, StmQuality, StmVolSatVap, StmPT } from './steamus.js';
import { inhgToPsia } from './units.js';

const KW_PER_KPPH_BTU = 0.293071; // kW per (kPPH x Btu/lbm)
const MW_PER_KPPH_BTU = 0.000293071;

/** Throttle flow. */
export const throttleFlow = (Wfw, Wshs, Wbd) => Wfw + Wshs - Wbd;
/** Throttle flow corrected to design conditions. */
export const correctedThrottleFlow = (W, P, T, nv) => W * Math.sqrt((nv.throttleP / P) * (StmSpVol(P, T) / StmSpVol(nv.throttleP, nv.throttleT)));
/** Throttle flow ratio and % of VWO. */
export const throttleFlowRatio = (W, nv) => W / nv.vwoFlow;
export const throttleFlowPctVwo = (W, nv) => (100 * W) / nv.vwoFlow;
/** Gross generation as % of rated; load as % of VWO / rated. */
export const pctOfRated = (mw, rated) => (100 * mw) / rated;
export const pctOfVwoLoad = (mw, nv) => (100 * mw) / nv.vwoMW;
export const pctOfRatedLoad = (mw, nv) => (100 * mw) / (0.96 * nv.vwoMW);
/** Deviations from design. */
export const throttlePressureDeviation = (P, Pdes) => (100 * (P - Pdes)) / Pdes;
export const tempDeviation = (T, Tdes) => T - Tdes;

/** Hot reheat flow to the IP turbine by mass balance. */
export const hotReheatFlow = (f) => f.Wthr - f.Wextr - f.Wn1 - f.Wn2 - f.Wvslo1 - f.Wvslo2 + f.Wrhs - (f.Wcraux ?? 0);
/** Reheat bowl flow by mass balance. */
export const reheatBowlFlow = (f) => f.Wthr - f.Wextr - f.Wn1 - f.Wvslo1 - f.Wvslo2 + f.Wrhs;

/** First stage pressure corrected for throttle P and T. */
export const firstStagePressureCorr = (P1, P, T, nv) => P1 * Math.sqrt((nv.throttleP / P) * (StmSpVol(P, T) / StmSpVol(nv.throttleP, nv.throttleT)));
/** Stage pressure corrected for throttle and reheat conditions. */
export function stagePressureCorr(Po, Pthr, Tthr, Prh, Trh, nv) {
  return Po * Math.sqrt((nv.throttleP / Pthr) * (StmSpVol(Pthr, Tthr) / StmSpVol(nv.throttleP, nv.throttleT))) * Math.sqrt(StmSpVol(Prh, nv.reheatT) / StmSpVol(Prh, Trh));
}
/** Stage pressure ratio. */
export const stagePressureRatio = (P1, P2) => (P1 !== 0 ? P2 / P1 : 0);

/** Stage flow factor Cff = W / sqrt(P / v) (simplified St. Venant, constant pressure ratio). */
export function stageFlowFactor(W, P, T, H = 0) {
  const v = H > 0 ? StmSpVolPH(P, H) : StmSpVol(P, Math.max(T, StmPT(P) + 0.01));
  return v > 0 && P / v > 0 ? W / Math.sqrt(P / v) : 0;
}
/** Inverse of the stage flow factor: flow [kPPH] through a stage group with flow factor Cff at inlet P, v. */
export const flowFromFlowFactor = (Cff, P, v) => (v > 0 ? Cff * Math.sqrt(P / v) : 0);
/**
 * Inverse of the stage flow factor: inlet pressure [psia] that passes flow W with inlet enthalpy H
 * (v depends on P, solved by fixed-point iteration).
 */
export function pressureFromFlowFactor(Cff, W, H, Pguess = 500) {
  let P = Pguess;
  for (let i = 0; i < 30; i++) {
    const v = StmSpVolPH(P, H);
    const Pn = (W / Cff) ** 2 * v;
    if (Math.abs(Pn - P) < 1e-6 * P) return Pn;
    P = 0.5 * P + 0.5 * Pn;
  }
  return P;
}
/** Design stage pressure from a pressure factor and the corrected following-stage flow. */
export function designStagePressure(Wfs, Pthr, Tthr, Prh, Trh, presFact, nv) {
  const Wc = Wfs * Math.sqrt((nv.throttleP / Pthr) * (StmSpVol(Pthr, Tthr) / StmSpVol(nv.throttleP, nv.throttleT))) * Math.sqrt(StmSpVol(Prh, nv.reheatT) / StmSpVol(Prh, Trh));
  return (presFact * Wc) / 1000;
}

/** Enthalpy drop efficiency [%] from inlet / outlet P, T. */
export function enthalpyDropEff(Pin, Tin, Pout, Tout) {
  const Hin = StmEnth(Pin, Tin);
  const Hout = StmEnth(Pout, Tout);
  const Hid = StmEnthPS(Pout, StmEntropy(Pin, Tin));
  return (100 * (Hin - Hout)) / (Hin - Hid);
}
/** Enthalpy drop efficiency with known enthalpies (0 = calculate). */
export function enthalpyDropEffH(Pin, Tin, Pout, Tout, Hin = 0, Hout = 0) {
  const hin = Hin || StmEnth(Pin, Tin);
  const hout = Hout || StmEnth(Pout, Tout);
  const Hid = StmEnthPS(Pout, StmEntropyPH(Pin, hin));
  return (100 * (hin - hout)) / (hin - Hid);
}
/** Available energy (isentropic drop) [Btu/lbm]. */
export const availableEnergy = (Pin, Tin, Pout) => StmEnth(Pin, Tin) - StmEnthPS(Pout, StmEntropy(Pin, Tin));
/** Used energy [Btu/lbm]. */
export const usedEnergy = (Pin, Tin, Pout, Tout) => StmEnth(Pin, Tin) - StmEnth(Pout, Tout);
/** Exhaust enthalpy from the enthalpy drop efficiency [%]. */
export function exhEnthFromEff(Pin, Tin, Pout, eff, Hin = 0) {
  const hin = Hin || StmEnth(Pin, Tin);
  const sin = Hin ? StmEntropyPH(Pin, hin) : StmEntropy(Pin, Tin);
  return hin - (eff / 100) * (hin - StmEnthPS(Pout, sin));
}
/** Exhaust temperature from the enthalpy drop efficiency. */
export const exhTempFromEff = (Pin, Tin, Pout, eff) => StmTempPH(Pout, exhEnthFromEff(Pin, Tin, Pout, eff));
/** Estimated stage (wet) enthalpy. */
export const stageWetEnthalpy = (Pin, Tin, Pout, eff, Hin = 0) => exhEnthFromEff(Pin, Tin, Pout, eff, Hin);
/** IP efficiency corrected for N2 leakage into the bowl (2 % IV pressure drop). */
export function ipEffCorrN2(Pin, Tin, Pout, Tout, Hn2, Wn2, Wbowl) {
  const Hin = StmEnth(Pin, Tin);
  const Hbowl = Wbowl > 0 ? (Wn2 * Hn2 + (Wbowl - Wn2) * Hin) / Wbowl : Hin;
  const Sbowl = StmEntropyPH(0.98 * Pin, Hbowl);
  return (100 * (Hbowl - StmEnth(Pout, Tout))) / (Hbowl - StmEnthPS(Pout, Sbowl));
}
/** Expected LP efficiency from the used energy end point. */
export function expectedLpEff(Pin, Tin, Pout, ueep) {
  const Hin = StmEnth(Pin, Tin);
  return (100 * (Hin - ueep)) / (Hin - StmEnthPS(Pout, StmEntropy(Pin, Tin)));
}

/**
 * Exhaust loss [Btu/lbm dry flow] versus last stage annulus velocity [ft/s], ('62 GL
 * Table III / Fig. 17). The table itself is not published:
 * this is a representative 3600 rpm curve (minimum near 600 ft/s, turn-up loss at low velocity,
 * rising towards the 1400 ft/s choking limit).
 */
const EXH_LOSS = [
  [100, 80], [200, 45], [300, 25], [400, 15], [500, 10.2], [600, 8.6], [700, 9.2], [800, 11.5],
  [900, 15], [1000, 19.5], [1100, 24.5], [1200, 30], [1300, 35.5], [1400, 41],
];
export function exhaustLoss(vel) {
  const v = Math.max(EXH_LOSS[0][0], vel);
  if (v >= 1400) return 41 + 0.02 * (v - 1400);
  let i = 1;
  while (EXH_LOSS[i][0] < v) i++;
  const [v0, l0] = EXH_LOSS[i - 1];
  const [v1, l1] = EXH_LOSS[i];
  return l0 + ((v - v0) / (v1 - v0)) * (l1 - l0);
}

/**
 * Expansion line end point and used energy end point of the reheat section
 * ('62 GL method). The 25-coefficient pressure /
 * temperature correction (Fig. 14) is not published and is taken as zero,
 * and above 1400 ft/s the loss is extrapolated instead of iterating to the sonic pressure (step 8).
 * nv: reheatBaseEff [%], reheatDesFlow [kPPH], reheatP [psia], reheatT [F], annulusArea [ft2]
 */
export function ueepReheat(Piv, Tiv, Wbowl, Wn2, Hn2, Pexh, Wexh, nv) {
  const Vdes = StmSpVol(nv.reheatP, nv.reheatT);
  const etaC = nv.reheatBaseEff - (1270000 / (nv.reheatDesFlow * 1000 * Vdes) / 100) * nv.reheatBaseEff;
  const Hiv = StmEnth(Piv, Tiv);
  const Hm = Wbowl > 0 ? ((Wbowl - Wn2) * Hiv + Wn2 * Hn2) / Wbowl : Hiv;
  const Sm = StmEntropyPH(0.98 * Piv, Hm);
  const P15 = inhgToPsia(1.5);
  const elep15 = Hm - (etaC / 100) * (Hm - StmEnthPS(P15, Sm));
  const Y = 100 * (1 - StmQuality(P15, elep15));
  const pexhInHg = (Pexh * 6.894757) / 3.386389;
  const lnP = Math.log(pexhInHg);
  const dELEP0 = -23.984811 + 57.86244 * lnP + 3.1849404 * lnP * lnP;
  const elep = elep15 + dELEP0 * 0.87 * (1 - 0.01 * Y) * (1 - 0.0065 * Y);
  const Mexh = 100 * (1 - StmQuality(Pexh, elep));
  const vel = (1000 * Wexh * StmVolSatVap(Pexh) * (1 - Mexh / 100)) / (3600 * nv.annulusArea);
  const Lexh = exhaustLoss(vel);
  const ueep = elep + Lexh * 0.87 * (1 - 0.01 * Mexh) * (1 - 0.0065 * Mexh);
  return { elep, ueep, annulusVelocity: vel, exhaustLoss: Lexh, moisture: Mexh, eta: etaC };
}

/** Used energy end point from the LP section energy balance. */
export function ueepEnergyBalance(MWlp, Wbowl, Pxo, Txo, ext, genEff) {
  const H = [StmEnth(Pxo, Txo), ...ext.map((e) => StmEnth(e.P, e.T))];
  let W = Wbowl;
  let kw = 0;
  for (let i = 0; i < ext.length; i++) {
    kw += KW_PER_KPPH_BTU * W * (H[i] - H[i + 1]);
    W -= ext[i].W;
  }
  const last = (1000 * MWlp) / (genEff / 100) - kw;
  const ueep = H[H.length - 1] - (last * 3.412142) / W;
  return ueep > H[H.length - 1] || ueep < 0 ? 0 : ueep;
}

/** Heat rate effect [Btu/kWh] of the actual HP efficiency deviating from design. */
export const hrEffectHpEff = (etaDes, etaAct, Hdes, Wrh, HRdes, HRact, nv) =>
  -((etaAct - etaDes) / etaDes) * ((Hdes * nv.vwoFlow) / (3412.14 * nv.vwoMW) - (Hdes * Wrh) / (HRdes * nv.vwoMW)) * HRact;

/** HP section power [MW] (optional one extraction). */
export function hpSectionPower(f, genEff) {
  const Wbowl = f.Wthr - f.Wvslo1 - f.Wvslo2;
  const Hthr = StmEnth(f.Pthr, f.Tthr);
  const Hcrh = StmEnth(f.Pcrh, f.Tcrh);
  let p = Wbowl * (Hthr - f.Hn2) * MW_PER_KPPH_BTU;
  if (f.Wextr) {
    const Hext = StmEnth(f.Pext, f.Text);
    p += (Wbowl - f.Wn2) * (f.Hn2 - Hext) * MW_PER_KPPH_BTU + (Wbowl - f.Wn2 - f.Wextr) * (Hext - Hcrh) * MW_PER_KPPH_BTU;
  } else p += (Wbowl - f.Wn2) * (f.Hn2 - Hcrh) * MW_PER_KPPH_BTU;
  return p * (genEff / 100);
}
/** Single stage power [MW]. */
export const stagePower = (W, Hin, Hout) => W * (Hin - Hout) * MW_PER_KPPH_BTU;
/** IP section power [MW] with 1 - 3 extractions (ext: [{W, P, T}]). */
export function ipSectionPower(f, ext, genEff) {
  const Hrh = StmEnth(f.Prh, f.Trh);
  const Hxo = StmEnth(f.Pxo, f.Txo);
  const H = ext.map((e) => StmEnth(e.P, e.T));
  let p = (f.Wbowl - f.Wn2) * (Hrh - H[0]) * MW_PER_KPPH_BTU + f.Wn2 * (f.Hn2 - H[0]) * MW_PER_KPPH_BTU;
  let W = f.Wbowl;
  for (let i = 0; i < ext.length; i++) {
    W -= ext[i].W;
    p += W * (H[i] - (i + 1 < ext.length ? H[i + 1] : Hxo)) * MW_PER_KPPH_BTU;
  }
  return p * (genEff / 100);
}
/** LP section power [MW] by difference. */
export const lpSectionPower = (MWgr, MWhp, MWip) => MWgr - MWhp - MWip;

/** Valve stem leak-offs [kPPH] (above seat, below seat). */
export function valveStemLeakoffs(P1, T1, P2, nv) {
  const V1 = StmSpVol(P1, T1);
  const V2 = StmSpVolPH(P2, StmEnth(P1, T1));
  const total = V1 > 0 ? nv.vslo12 * Math.sqrt(P1 / V1) : 0;
  const below = V2 > 0 ? nv.vslo2 * Math.sqrt(P2 / V2) : 0;
  return { above: (total - below) / 1000, below: below / 1000 };
}
/** N1 inner / outer gland leak-off [kPPH]. */
export function n1Leakoffs(P1, T1, P2, nv) {
  const V1 = StmSpVol(P1, T1);
  const V2 = StmSpVolPH(P2, StmEnth(P1, T1));
  const total = V1 > 0 ? nv.n1Total * Math.sqrt(P1 / V1) : 0;
  const outer = V2 > 0 ? nv.n1Outer * Math.sqrt(P2 / V2) : 0;
  return { inner: (total - outer) / 1000, outer: outer / 1000 };
}
/** N2 packing leak-off [kPPH] from first stage pressure and enthalpy. */
export function n2Leakoff(P1, H1, nv) {
  const V1 = StmSpVolPH(P1, H1);
  return V1 > 0 ? (nv.n2Total * Math.sqrt(P1 / V1)) / 1000 : 0;
}
/** N3 packing leak-off [kPPH]. */
export function n3Leakoff(P1, T1, nv) {
  const V1 = StmSpVol(P1, T1);
  return V1 > 0 ? (nv.n3Total * Math.sqrt(P1 / V1)) / 1000 : 0;
}
/** Generic packing leak-off [kPPH]. */
export function packingLeakoff(Hs, Ps, PC) {
  const Vs = StmSpVolPH(Ps, Hs);
  return Vs > 0 ? (PC * Math.sqrt(Ps / Vs)) / 1000 : 0;
}

/**
 * Design HP efficiency [%], 3600 rpm, 1-row governing stage ('62 GL), from
 * the volume flow, governing stage pitch diameter, pressure ratio and governing stage at partial
 * load; the 8-coefficient partial load surface (Fig. 9) is not given in
 * the documents and is represented by a quadratic loss below the first admission point.
 * nv: hpBaseEff, hpSections, vwoFlow, throttleP, throttleT, hpExhP, pitchDia, fapFlowRatio
 */
export function designHpEff(Qthr, Pthr, Tthr, nv) {
  const Vdes = StmSpVol(nv.throttleP, nv.throttleT);
  let eta = nv.hpBaseEff - ((1005.2 * nv.hpSections) / (nv.vwoFlow * Vdes) / 100) * nv.hpBaseEff;
  eta -= ((4.37 - 0.115 * nv.pitchDia) / 100) * eta;
  const X = nv.hpExhP / nv.throttleP;
  const Y = Math.log(1000 * nv.vwoFlow * Vdes);
  eta += ((11.151 - 63.0 * X - 0.50091 * Y + 2.83 * X * Y) / 100) * eta;
  const tfr = Math.max(nv.fapFlowRatio, correctedThrottleFlow(Qthr, Pthr, Tthr, nv) / nv.vwoFlow);
  eta += ((-21.8085 + 21.8085 * tfr + 0.573908 * nv.pitchDia - 0.573908 * tfr * nv.pitchDia) / 100) * eta;
  const below = Math.max(0, nv.fapFlowRatio - correctedThrottleFlow(Qthr, Pthr, Tthr, nv) / nv.vwoFlow);
  return eta * (1 - 0.35 * below * below);
}

/** Design IP efficiency [%] ('62 GL, 3600 rpm). nv: reheatP, reheatT, reheatDesFlow, n2DesFlow, n2DesEnth, ipExhP, ipExhDp */
export function designIpEff(nv) {
  const Hiv = StmEnth(nv.reheatP, nv.reheatT);
  const Hbowl = ((nv.reheatDesFlow - nv.n2DesFlow) * Hiv + nv.n2DesFlow * nv.n2DesEnth) / nv.reheatDesFlow;
  const Pbowl = 0.98 * nv.reheatP;
  const Qbowl = 1000 * nv.reheatDesFlow * StmSpVolPH(Pbowl, Hbowl);
  if (!(Qbowl > 0)) return 0;
  const Pr = Pbowl / nv.ipExhP;
  const etaIn = 90.799 + 0.7474 * Math.log(Pr - 0.3) - 0.5454 / Math.log(Pr - 0.3) + (-50500 + 77568 * Math.log(Pr + 0.8) - 1262500 / Math.log(Pr + 0.8)) / Qbowl;
  const Sbowl = StmEntropyPH(Pbowl, Hbowl);
  const AE = Hbowl - StmEnthPS(nv.ipExhP, Sbowl);
  const Hexh = Hbowl - (etaIn / 100) * AE;
  const Hid2 = StmEnthPS(nv.ipExhP * (1 - (nv.ipExhDp ?? 0) / 100), Sbowl);
  return (100 * (Hbowl - Hexh)) / (Hbowl - Hid2);
}

/** With gauge inputs: turbine cycle heat input [MMBtu/h] (absolute = gauge + Pbar). */
export { boilerHeatAbsorption as turbineCycleHeatInputAbs } from './boiler.js';
/** Turbine cycle heat rate [Btu/kWh]. */
export const turbineCycleHeatRate = (Qtc, MWgr) => (MWgr > 0 ? (Qtc * 1000) / MWgr : 0);
/** Turbine cycle heat input [MMBtu/h] from load and heat rate. */
export const tchiFromHeatRate = (MWgr, TCHR) => (MWgr * 1000 * TCHR) / 1e6;
/** Fuel based net plant heat rate [Btu/kWh] (fuel lb/s). */
export const netPlantHeatRate = (Wfuel, HHV, MWnet) => (MWnet > 0 ? (Wfuel * HHV * 3600) / (MWnet * 1000) : 0);
