/**
 * Unit heat rate and controllable parameter corrections. Heat rates in Btu/kWh,
 * corrections in %, temperatures in F.
 */
import { boilerEfficiency } from './boiler.js';
import { StmHg, LiquidWaterEnthalpy } from './steamus.js';
import { gasOutWithLeak, gasOutNoLeak } from './airheater.js';

/** Actual net unit heat rate. */
export const netUnitHeatRate = (heatIn, net) => (net ? (heatIn * 1000) / net : 0);
/** Design net unit heat rate. */
export const netUnitHeatRateDesign = (GTCHR, BEdes, gross, aux) => (100 * GTCHR * gross) / (BEdes * (gross - aux));
/** Target net unit heat rate. */
export const targetNetHeatRate = (HRact, corr) => (corr === -100 ? 0 : HRact / (1 + corr / 100));
/** Reference gross TCHR corrected to design. */
export const refTchrCorrToDesign = (corrBPdes, GTCHRref) => GTCHRref * (1 + corrBPdes / 100);
/** Feedwater temperature heat rate correction [%] (corr is % per 5 F). */
export const fwTempHrCorr = (corr, Tact, Tdes) => (corr * (Tdes - Tact)) / 5;
/** Unit service heat rate correction [%]. */
export const unitServiceHrCorr = (MWexp, MWact, MWgross, MWdes) => (100 * (MWact - MWexp)) / (MWgross - MWdes);
/** Minimum achievable (Carnot) heat rate. */
export const carnotHeatRate = (Tsh, Tcw) => 3413 / (1 - (Tcw + 459.67) / (Tsh + 459.67));

/**
 * Excess oxygen heat rate correction [%]. m: the measured / design inputs of
 * boilerEfficiency; O2exp the design / target O2; o2Multiplier the safety multiplier.
 */
export function excessO2HrCorr(ult, nv, m, O2exp, o2Multiplier = 1) {
  const act = boilerEfficiency(ult, nv, m).efficiency;
  const oxy = m.excessO2 < O2exp * o2Multiplier ? O2exp * o2Multiplier : m.excessO2;
  const exp = boilerEfficiency(ult, nv, { ...m, excessO2: oxy }).efficiency;
  return (exp / act - 1) * 100;
}

/**
 * AH exit gas temperature heat rate correction [%]. m.tGonl is the actual no-leak
 * gas outlet; Tnlexp the design / target one. limits: { minAcet, dewPoint, acetBias, dewBias, weight }.
 */
export function egtHrCorr(ult, nv, m, Tnlexp, leakage, limits = {}) {
  const { minAcet = 150, dewPoint = 130, acetBias = 0, dewBias = 0, weight = 100 } = limits;
  const act = boilerEfficiency(ult, nv, m).efficiency;
  let egt1 = Tnlexp;
  if ((m.tGonl + m.tAirIn) / 2 < minAcet + acetBias) egt1 = 2 * (minAcet + acetBias) - m.tAirIn;
  let egt = gasOutWithLeak(egt1, m.tAirIn, leakage);
  if (egt < dewPoint + dewBias) egt = dewPoint + dewBias;
  egt = gasOutNoLeak(m.tAirIn, egt1, leakage);
  const exp = boilerEfficiency(ult, nv, { ...m, tGonl: egt }).efficiency;
  return exp ? ((act / exp - 1) * 100 * weight) / 100 : 0;
}

/** Incomplete combustion heat rate correction [%] (CO and carbon in ash at design). */
export function incCombustionHrCorr(ult, nv, m, expected) {
  const act = boilerEfficiency(ult, nv, m).efficiency;
  const exp = boilerEfficiency(ult, nv, { ...m, ...expected }).efficiency;
  return (exp / act - 1) * 100;
}

/** Boiler blowdown heat rate correction [%] (pressures in psia here). */
export function blowdownHrCorr(Wbd, Pbd, Wdes, Pfw, Tfw, BE, heatIn) {
  const Hbd = StmHg(Pbd);
  const energy = (Wbd - Wdes) * Hbd;
  const net = energy - (Wbd - Wdes) * LiquidWaterEnthalpy(Pfw, Tfw);
  const fuel = BE ? net / (BE / 100) : 0;
  return heatIn ? (100 * (fuel / 1000)) / heatIn : 0;
}

/** Target air preheat temperature (air into the air heater) [F]. */
export function targetAirPreheat(Tamb, Tgonl, Tgasin, leakage, Tairin, { minAcet = 150, dewPoint = 130 } = {}) {
  const eff = (Tgasin - Tgonl) / (Tgasin - Tairin);
  const corrOut = Tgasin - eff * (Tgasin - Tamb);
  const dAcet = minAcet - (Tamb + corrOut) / 2;
  const minOut = corrOut + (2 * dAcet) / ((eff + 1) / eff);
  let airIn = 2 * minAcet - minOut;
  const minOutLeak = (minOut + (airIn * leakage) / 100) / (1 + leakage / 100);
  if (minOutLeak < dewPoint) airIn = (dewPoint * (Tgasin - airIn) - Tgasin * (minOutLeak - airIn)) / (Tgasin - minOutLeak);
  return Math.max(Tamb, airIn);
}

/**
 * Design / target AH exit gas temperature corrected to actual air inlet, X-ratio and
 * leakage [F]. ref / online: { airFuel, wetGas, cp } for the reference and on-line fuel; Tref the
 * reference air temperature.
 */
export function targetEgtCorrected(Tgonl, Tgasin, Tairin, leakage, Tref, ref, online, { minAcet = 150, dewPoint = 130 } = {}) {
  let eff = (Tgasin - Tgonl) / (Tgasin - Tref);
  eff = (eff * online.airFuel * ref.wetGas * ref.cp) / (ref.airFuel * online.wetGas * online.cp);
  let egtNl = Tgasin - eff * (Tgasin - Tairin);
  if ((egtNl + Tairin) / 2 < minAcet) egtNl = 2 * minAcet - Tairin;
  return Math.max(dewPoint, gasOutWithLeak(egtNl, Tairin, leakage));
}
