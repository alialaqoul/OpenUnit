/**
 * Steam surface condenser - EtaPRO templates 2600 / 2601 / 2642 (duty), 2610 / 2611 (target /
 * design TTD), 2620 (expected pressure), 2630, 2640 / 2641 (CW rise / flow), 2660 (expected
 * backpressure), 2680 (cleanliness), 2690 (target backpressure), 2700 / 2701 (hotwell), 2930 (TTD).
 * HEI Standards for Steam Surface Condensers, 8th ed. Temperatures in F, CW flow in GPM, duty in
 * MMBtu/h, pressures in psia unless stated (inHga).
 *
 * nv: { passes, area [ft2], tubes, od [in], wall [in or BWG], material (1 - 10, see TUBE_MATL),
 *       cleanDesign, cleanTarget (decimal), desHeatLoad [MMBtu/h], subcoolBias [F] }
 */
import { StmPT, StmTP } from './gpsteam.js';
import { psiaToInhg, inhgToPsia } from './units.js';

/** HEI empirical constant vs tube OD [in] (Ref 1 Fig 6-14, CondenserCleanliness calc details). */
const HEI_OD = [[0.625, 267], [0.75, 267], [0.875, 263], [1, 263], [1.125, 259], [1.25, 259], [1.375, 255], [1.5, 255], [1.625, 251], [1.75, 251], [1.875, 247], [2, 247]];
/** BWG gauge -> wall thickness [in]. */
const BWG = { 12: 0.109, 14: 0.083, 16: 0.065, 18: 0.049, 20: 0.035, 22: 0.028, 24: 0.022 };
const BWG_ORDER = [12, 14, 16, 18, 20, 22, 24];
/** HEI tube material and gauge correction factors, BWG 12 ... 24 (HEI Table 1). */
export const TUBE_MATL = {
  1: ['Admiralty Metal', [0.87, 0.92, 0.96, 1, 1.02, 1.04, 1.06]],
  2: ['Arsenical Copper', [0.87, 0.92, 0.96, 1, 1.02, 1.04, 1.06]],
  3: ['Copper Iron 194', [0.87, 0.92, 0.96, 1, 1.02, 1.04, 1.06]],
  4: ['Aluminum Brass', [0.84, 0.9, 0.94, 0.97, 1, 1.02, 1.03]],
  5: ['Aluminum Bronze', [0.84, 0.9, 0.94, 0.97, 1, 1.02, 1.03]],
  6: ['90-10 Cu-Ni', [0.74, 0.8, 0.85, 0.9, 0.94, 0.97, 0.99]],
  7: ['70-30 Cu-Ni', [0.64, 0.71, 0.77, 0.82, 0.87, 0.9, 0.93]],
  8: ['Cold Rolled Low Carbon Steel', [0.74, 0.8, 0.86, 0.91, 0.95, 0.98, 1]],
  9: ['304/316 Stainless Steel', [0.55, 0.63, 0.7, 0.76, 0.83, 0.87, 0.91]],
  10: ['Titanium', [0.55, 0.63, 0.7, 0.76, 0.83, 0.87, 0.91]],
};

function interp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return table[table.length - 1][1];
}

/** Wall thickness [in] from a BWG gauge number or a decimal thickness. */
export const wallThickness = (wall) => (wall >= 1 ? BWG[Math.round(wall)] ?? 0.049 : wall);
export const heiCoeff = (od) => interp(HEI_OD, od);
export function heiMaterialFactor(material, wall) {
  const t = wallThickness(wall);
  const f = (TUBE_MATL[material] ?? TUBE_MATL[1])[1];
  return interp(BWG_ORDER.map((g, i) => [BWG[g], f[i]]).reverse(), t);
}
/** HEI inlet water temperature correction (Ref 1 Fig 2). */
export const cwCorrFactor = (Tcw) =>
  Tcw < 65 ? 0.378286 + 0.00905714 * Tcw : -0.164446 + 0.0321184 * Tcw - 0.000283186 * Tcw ** 2 + 8.85624e-7 * Tcw ** 3;
/** Derived condenser constants (step 1 of the condenser templates). */
export function condenserConstants(nv) {
  const t = wallThickness(nv.wall);
  return {
    heiCoeff: heiCoeff(nv.od),
    matlCF: heiMaterialFactor(nv.material, nv.wall),
    gpmPerTube: 1410.04462 * ((nv.od - 2 * t) / 24) ** 2,
    tubeLength: (3.8197186 * nv.area) / (nv.tubes * nv.od),
  };
}
/** Tube velocity [ft/s]. */
export function tubeVelocity(nv, Wcw) {
  const c = condenserConstants(nv);
  return (Wcw * nv.passes) / (nv.tubes * c.gpmPerTube);
}
/** HEI overall heat transfer coefficient [Btu/h ft2 F] at a CW flow, inlet temperature and cleanliness (decimal). */
export function heiU(nv, Wcw, Tcw, clean, cwCorr = cwCorrFactor(Tcw)) {
  const c = condenserConstants(nv);
  return c.heiCoeff * Math.sqrt(Math.max(0, tubeVelocity(nv, Wcw))) * clean * c.matlCF * cwCorr;
}

/** Templates 2600 / 2601: condenser duty [MMBtu/h] from the turbine cycle heat balance. */
export const condenserDuty = (MWgr, TCHR, genEff = 98.5) => MWgr * (TCHR / 3412.142 - 100 / genEff) * 3.412142;
/** Template 2642: condenser duty [MMBtu/h] from the design heat rate (generator efficiency 100 %). */
export const condenserDutyDesign = (TCHR, MWgross) => (MWgross * 1000 * (TCHR - 3412.142)) / 1e6;
/** Template 2630: condenser duty [MMBtu/h] from the target heat rate. */
export function condenserDutyTarget(HCtar, HCact, HCtotal, NUHR, MWnet, MWgross, BEdes, genEff) {
  const net = ((1 + HCact / 100) / (1 + HCtar / 100) - 1) * 100;
  const total = HCtotal * (1 + net / 100);
  const nhrTarget = NUHR / (1 + total / 100);
  const tchi = (nhrTarget * MWnet * 1000 * BEdes) / 1e8;
  return tchi - (MWgross * (100 / genEff) * 3412.142) / 1000;
}
/** Template 2640: CW temperature rise [F]. */
export const cwTempRise = (Qcond, Wcw) => (Wcw ? (Qcond * 1e6) / (Wcw * 500) : 0);
/** Template 2641: CW flow [GPM]. */
export const cwFlow = (Qcond, Trise) => (Trise ? (Qcond * 1e6) / (Trise * 500) : 0);

/** HEI TTD [F] (2611 step 3, 2660 step 4, 2690 step 3), limited to 5 F. */
export function heiTTD(nv, Tcw, Wcw, Trise, clean, cwCorr = cwCorrFactor(Tcw)) {
  const vel = tubeVelocity(nv, Wcw);
  const heatFact = vel > 0 && Wcw > 0 ? (heiU(nv, Wcw, Tcw, clean, cwCorr) * nv.area) / (500 * Wcw) : 1;
  const e = Math.exp(heatFact);
  const itd = e !== 1 ? Trise / (1 - 1 / e) : 0;
  return Math.max(5.0, Tcw + itd - Trise - Tcw);
}
/** Template 2611: design condenser TTD [F]. */
export const designTTD = (nv, Tcw, Wcw, Trise) => heiTTD(nv, Tcw, Wcw, Trise, nv.cleanDesign);

// HEI Fig 4 - best achievable (cutoff) pressure and the pressure at zero heat load [inHga] vs CW
// inlet temperature. The 7-coefficient polynomials are not in the template documents; these are
// the HEI curve shapes: cutoff = saturation at (Tcw + 13 F) above 1.0 inHga, zero load = Tcw + 3 F.
const cutoffPress = (Tcw) => Math.max(1.0, psiaToInhg(StmTP(Tcw + 13)));
const zeroLoadPress = (Tcw) => psiaToInhg(StmTP(Tcw + 3));

/**
 * Template 2610: target condenser TTD [F] using the target cleanliness, including the HEI
 * low-load region below the cutoff pressure (steps 2 - 10). Returns also the predicted
 * condenser pressure [inHga] of step 9.
 */
export function targetTTD(nv, Tcw, Wcw, Ttar, clean = nv.cleanTarget) {
  const heatLoad = 500 * Wcw * Ttar;
  const cwRho = 62.4;
  const cwCp = 1.0;
  const mcp = Wcw * cwRho * cwCp * (60 / 7.481);
  const k = (nv.area * heiU(nv, Wcw, Tcw, clean)) / mcp;
  const R = (Math.exp(k) - 1) / Math.exp(k);
  const pAt = (load) => {
    const rise = load / mcp;
    let itd = rise / R;
    if (itd - rise < 5) itd = rise + 5;
    return psiaToInhg(StmTP(Tcw + itd));
  };
  const pCut = cutoffPress(Tcw);
  let lo = 0;
  let hi = 4 * (nv.desHeatLoad ?? 1000) * 1e6;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (pAt(mid) < pCut) lo = mid;
    else hi = mid;
  }
  const heatAtCutoff = (lo + hi) / 2;
  const condP = heatLoad > heatAtCutoff ? pAt(heatLoad) : ((pCut - zeroLoadPress(Tcw)) / heatAtCutoff) * heatLoad + zeroLoadPress(Tcw);
  return { ttd: heiTTD(nv, Tcw, Wcw, Ttar, clean), condP };
}

/** Template 2620: expected condenser pressure [inHga]. */
export const expectedCondPressure = (Tcw, Trise, TTD) => Math.round(psiaToInhg(StmTP(Tcw + Trise + TTD)) * 100) / 100;

/** Template 2660: expected condenser backpressure [inHga] at a CW flow and cleanliness [%]. */
export function expectedBackpressure(nv, TCHR, MWgr, Tcw, Wcw, cleanPct, cwCorr = cwCorrFactor(Tcw)) {
  const Q = condenserDutyDesign(TCHR, MWgr);
  const rise = cwTempRise(Q, Wcw);
  const ttd = heiTTD(nv, Tcw, Wcw, rise, cleanPct / 100, cwCorr);
  return psiaToInhg(StmTP(Tcw + rise + ttd));
}

/** Template 2690: target condenser backpressure [inHga] from a heat load [MMBtu/h]. */
export function targetBackpressure(nv, Qcond, Wcw, Tcw, clean = nv.cleanTarget) {
  const rise = Wcw ? cwTempRise(Qcond, Wcw) : 1;
  const ttd = heiTTD(nv, Tcw, Wcw, rise, clean);
  return Math.round(psiaToInhg(StmTP(Tcw + rise + ttd)) * 100) / 100;
}
/** Steady-state condenser pressure [inHga] from duty (unrounded 2690 - used by the process model). */
export function condenserPressure(nv, Qcond, Wcw, Tcw, clean) {
  const rise = cwTempRise(Qcond, Wcw);
  const ttd = heiTTD(nv, Tcw, Wcw, rise, clean);
  return { pInHg: psiaToInhg(StmTP(Tcw + rise + ttd)), rise, ttd, tsat: Tcw + rise + ttd };
}

/** Template 2680: actual condenser cleanliness factor [%]. */
export function condenserCleanliness(nv, Tin, Wcw, Tout, condPresInHg, Qcond, cwCorr = cwCorrFactor(Tin)) {
  const Tsat = StmPT(inhgToPsia(condPresInHg));
  const denom = (Tsat - Tin) / (Tsat - Tout);
  if (!(denom > 0)) return 0;
  const lmtd = Math.log(denom) !== 0 ? (Tout - Tin) / Math.log(denom) : 1;
  const Ut = (Qcond * 1e6) / (nv.area * lmtd);
  const Ud = heiU(nv, Wcw, Tin, 1, cwCorr);
  return Ud !== 0 ? (100 * Ut) / Ud : 0;
}

/** Template 2700: design hotwell temperature [F]; 2701: target hotwell temperature. */
export const designHotwellTemp = (pInHg) => StmPT(inhgToPsia(pInHg));
export const targetHotwellTemp = (Tdes, nv) => Tdes - (nv.subcoolBias ?? 0);
/** Template 2930: condenser / heater TTD [F]. */
export const terminalTempDiff = (Pflange, Tout) => StmPT(Pflange) - Tout;
