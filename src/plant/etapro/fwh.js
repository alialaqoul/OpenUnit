/**
 * Feedwater heaters - EtaPRO templates 2900 (closed heater extraction flow), 2910 (deaerator
 * extraction flow), 2930 (TTD) and 2990 - 2999 (expected TTD, DCA, extraction flow, temperature
 * rise and outlet temperature by the Tsou method, ASME PTC 12.1). Flows in kPPH, pressures in
 * psia, temperatures in F, duties in MMBtu/h, areas in ft2.
 *
 * Heater non-volatile data (nv):
 *   tubes, plugged, tubeOD, tubeID [in], kTube [Btu/h ft F], area: [sub, cond, dsh],
 *   U: [sub, cond, dsh] [Btu/h ft2 F], duty: [sub, cond, dsh],
 *   fwFlow, fwInP, fwInT, tubeDP, stmInP, stmInT, stmInFlow, drainInFlow, drainOutT,
 *   dshShellDP, subShellDP, condLMTD
 * Zones with no area are absent (type 1 / 2 heaters); the template itself covers type 3.
 */
import { StmEnth, StmPT, StmTP, StmVisc, StmCond, StmSpecHeat, StmSpecHeatVap, LiquidWaterEnthalpy } from './gpsteam.js';

export { terminalTempDiff } from './condenser.js';

/** Liquid enthalpy: StmEnth with the pressure raised above saturation (2900 step 2, "LiqEnth"). */
function liqEnth(P, T) {
  return LiquidWaterEnthalpy(P, T);
}
function drainEnth(Pext, T) {
  const Psat = StmTP(T);
  return LiquidWaterEnthalpy(Pext < Psat + 0.01 ? Psat + 10 : Pext, T);
}

/** Template 2900: closed feedwater heater extraction flow [kPPH]. */
export function closedHeaterExtraction(a) {
  const fwInH = liqEnth(a.fwInP, a.fwInT);
  const fwOutH = liqEnth(a.fwOutP || a.fwInP, a.fwOutT);
  const drainOutH = drainEnth(a.stmP, a.drainOutT || a.fwInT + 10);
  const drainInH = a.drainInFlow ? drainEnth(a.stmP, a.drainInT || a.fwOutT + 10) : 0;
  const stmH = StmEnth(a.stmP, a.stmT);
  const stm2H = a.stm2Flow ? StmEnth(a.stm2P, a.stm2T) : 0;
  const fwDuty = a.fwFlow * (fwOutH - fwInH);
  const drainDuty = (a.drainInFlow ?? 0) * (drainInH - drainOutH);
  const stm2Duty = (a.stm2Flow ?? 0) * (stm2H - drainOutH);
  if (stmH === drainOutH) return 0;
  return Math.max(0, (fwDuty - drainDuty - stm2Duty) / (stmH - drainOutH));
}

/** Template 2910: deaerator extraction flow [kPPH] when the condensate flow into the DA is known. */
export function daExtraction(a) {
  const fwInH = liqEnth(a.fwInP, a.fwInT);
  const fwOutH = liqEnth(a.fwOutP || a.fwInP, a.fwOutT);
  const drainInH = a.drainInFlow ? drainEnth(a.stmP, a.drainInT || a.fwOutT + 10) : 0;
  const stmH = StmEnth(a.stmP, a.stmT);
  const stm2H = a.stm2Flow ? StmEnth(a.stm2P, a.stm2T) : 0;
  const fwDuty = a.fwFlow * (fwInH - fwOutH);
  const stm2Duty = (a.stm2Flow ?? 0) * (stm2H - fwOutH);
  const drainDuty = (a.drainInFlow ?? 0) * (drainInH - fwOutH);
  if (stmH === fwOutH) return 0;
  return Math.max(0, (fwDuty + stm2Duty + drainDuty) / (fwOutH - stmH));
}

/** Counter-flow effectiveness (Tsou eq. 21 / 29), NTU on the tube side, R = Ctube / Cshell. */
function effectiveness(ntu, R) {
  if (!(ntu > 0)) return 0;
  if (Math.abs(R - 1) < 1e-6) return ntu / (1 + ntu);
  const e = Math.exp(ntu * (R - 1));
  return (1 - e) / (1 - R * e);
}
/** Tube side film resistance [h ft2 F / Btu] (Tsou eq. 4, Dittus-Boelter). */
function tubeResistance(P, Tb, tubeID, massFlux) {
  const visc = StmVisc(P, Tb);
  const k = StmCond(P, Tb);
  const c = StmSpecHeat(P, Tb);
  const d = tubeID / 12;
  return ((43.5 * d) / k) * (visc / (d * massFlux)) ** 0.8 * (k / (c * visc)) ** 0.4;
}
const RFS = [0.0003, 0, 0.0003];
const RFT = [0.0002, 0.0002, 0.0002];

/**
 * Template 2990 Part I: design zone resistances and heat capacity data (computed once per
 * heater). plugged = true applies the plugged tubes of 2995 - 2999.
 */
export function heaterDesign(nv, plugged = false) {
  const tubes = plugged ? nv.tubes - (nv.plugged ?? 0) : nv.tubes;
  const area = nv.area.map((a) => (a * tubes) / nv.tubes);
  const flowArea = (Math.PI * nv.tubeID ** 2) / 4;
  const massFlux = (1000 * nv.fwFlow * 144) / (tubes * flowArea);
  const rmd = (nv.tubeOD / (24 * nv.kTube)) * Math.log(nv.tubeOD / nv.tubeID);
  const ratio = nv.tubeOD / nv.tubeID;
  const has = area.map((a) => a > 0);
  // step 8 zone temperatures (iterated on specific heat)
  let t = [nv.fwInT, nv.fwInT, nv.fwInT, nv.fwInT];
  const C = [1, 1, 1];
  for (let it = 0; it < 30; it++) {
    for (let z = 0; z < 3; z++) C[z] = StmSpecHeat(nv.fwInP, has[z] ? (t[z] + t[z + 1]) / 2 || nv.fwInT : nv.fwInT);
    const tn = [nv.fwInT];
    for (let z = 0; z < 3; z++) tn.push(tn[z] + (has[z] ? (1000 * nv.duty[z]) / (nv.fwFlow * C[z]) : 0));
    const done = Math.abs(tn[3] - t[3]) < 0.01;
    t = tn;
    if (done) break;
  }
  const rtd = [0, 1, 2].map((z) => tubeResistance(nv.fwInP, (t[z] + t[z + 1]) / 2, nv.tubeID, massFlux));
  const rsd = [0, 0, 0];
  for (const z of [0, 2]) if (has[z]) rsd[z] = 1 / nv.U[z] - (RFS[z] + rmd + (RFT[z] + rtd[z]) * ratio);
  const dshOutP = nv.stmInP - (has[2] ? nv.dshShellDP ?? 0 : 0);
  const tsat = StmPT(dshOutP);
  const tfilm = nv.condLMTD ? StmPT(nv.stmInP) - 0.2 * nv.condLMTD : StmPT(nv.stmInP) - 5;
  rsd[1] = tfilm > 320 ? 0.0004 : 0.06834 * tfilm ** -0.8912;
  // design shell side temperatures
  const cpStm = StmSpecHeatVap((nv.stmInP + dshOutP) / 2, Math.max(nv.stmInT - 10, tsat + 1));
  const dshStmOutT = has[2] ? nv.stmInT - (1000 * nv.duty[2]) / (nv.stmInFlow * cpStm) : tsat;
  const subStmInFlow = nv.stmInFlow + (nv.drainInFlow ?? 0);
  // zone heat capacity rates per unit design flow [Btu/h F per kPPH]
  const cTube = [0, 1, 2].map((z) => (has[z] && t[z + 1] > t[z] ? (1e6 * nv.duty[z]) / (nv.fwFlow * (t[z + 1] - t[z])) : 0));
  const cShellSub = has[0] && tsat > nv.drainOutT ? (1e6 * nv.duty[0]) / (subStmInFlow * (tsat - nv.drainOutT)) : 0;
  const cShellDsh = has[2] && nv.stmInT > dshStmOutT ? (1e6 * nv.duty[2]) / (nv.stmInFlow * (nv.stmInT - dshStmOutT)) : 0;
  return { nv, tubes, area, has, flowArea, rmd, ratio, rtd, rsd, cTube, cShellSub, cShellDsh, subStmInFlow, zoneT: t, dshStmOutT, tsat };
}

/**
 * Template 2990 Part II: predicted heater performance at off-design conditions.
 * a: { fwFlow, fwInP, fwInT, stmP, stmT, drainInFlow, drainInP, drainInT }
 * Returns { fwOutT, ttd, dca, extrFlow, tempRise, drainOutT, U: [..], fwOutP }.
 */
export function heaterPredict(des, a, guess = null) {
  const nv = des.nv;
  const { has, area, rmd, ratio, rsd, rtd } = des;
  const fwFlow = Math.max(1e-3, a.fwFlow);
  const massFlux = (1000 * fwFlow * 144) / (des.tubes * des.flowArea);
  const drainFlow = a.drainInFlow ?? 0;
  const tsatIn = StmPT(a.stmP);
  const stmT = Math.max(a.stmT, tsatIn + 0.01);
  let subFwOut = guess?.subFwOut ?? a.fwInT + 10;
  let condFwOut = guess?.condFwOut ?? subFwOut + 50;
  let dshFwOut = guess?.fwOutT ?? condFwOut + 10;
  let condSat = guess?.condSat ?? tsatIn;
  let subStmOut = guess?.drainOutT ?? a.fwInT + 10;
  let stmFlow = guess?.extrFlow ?? nv.stmInFlow;
  let shellOutP = a.stmP;
  const U = [0, 0, 0];
  const fwInH = liqEnth(a.fwInP, a.fwInT);
  const stmH = StmEnth(a.stmP, stmT);
  const drainH = drainFlow > 0 ? liqEnth(a.drainInP ?? a.stmP, a.drainInT) : 0;
  const first = !guess;
  for (let it = 0; it < 60; it++) {
    const prevOut = dshFwOut;
    // steps 4 - 6: steam flow from the total duty
    const totalDuty = 1000 * fwFlow * (liqEnth(a.fwInP, dshFwOut) - fwInH);
    const subOutH = liqEnth(shellOutP, subStmOut);
    stmFlow = stmH > subOutH ? Math.max(0, (totalDuty - 1000 * drainFlow * (drainH - subOutH)) / (stmH - subOutH) / 1000) : 0;
    const subStmInFlow = Math.max(1e-3, stmFlow + drainFlow);
    const stmFlowG = Math.max(1e-3, stmFlow);
    // step 18 - 19: desuperheating zone shell pressure drop and condensing temperature
    const dshDP = has[2] ? (nv.dshShellDP ?? 0) * (stmFlowG / nv.stmInFlow) ** 1.8 : 0;
    shellOutP = Math.max(0.089, a.stmP - dshDP);
    condSat = StmPT(shellOutP);
    // steps 9 - 17: subcooling (drain cooler) zone
    if (has[0]) {
      const RS = rsd[0] * (des.subStmInFlow / subStmInFlow) ** 0.6;
      const rt = first && it === 0 ? rtd[0] * (nv.fwFlow / fwFlow) ** 0.8 : tubeResistance(a.fwInP, (subFwOut + a.fwInT) / 2, nv.tubeID, massFlux);
      U[0] = 1 / (RS + RFS[0] + rmd + (RFT[0] + rt) * ratio);
      const cShell = subStmInFlow * des.cShellSub;
      const cTube = fwFlow * des.cTube[0];
      const R = cTube / cShell;
      const eff = effectiveness((U[0] * area[0]) / cTube, R);
      subFwOut = eff * (condSat - a.fwInT) + a.fwInT;
      subStmOut = condSat - R * (subFwOut - a.fwInT);
    } else {
      subFwOut = a.fwInT;
      subStmOut = condSat;
    }
    // steps 20 - 24: condensing zone
    if (has[1]) {
      const rt = first && it === 0 ? rtd[1] * (nv.fwFlow / fwFlow) ** 0.8 : tubeResistance(a.fwInP, (condFwOut + subFwOut) / 2, nv.tubeID, massFlux);
      U[1] = 1 / (rsd[1] + RFS[1] + rmd + (RFT[1] + rt) * ratio);
      const cTube = fwFlow * des.cTube[1];
      const eff = 1 - Math.exp(-(U[1] * area[1]) / cTube);
      condFwOut = eff * (condSat - subFwOut) + subFwOut;
    } else condFwOut = subFwOut;
    // steps 25 - 33: desuperheating zone
    if (has[2]) {
      const RS = rsd[2] * (nv.stmInFlow / stmFlowG) ** 0.6;
      const rt = rtd[2] * (nv.fwFlow / fwFlow) ** 0.8;
      U[2] = 1 / (RS + RFS[2] + rmd + (RFT[2] + rt) * ratio);
      const cShell = stmFlowG * des.cShellDsh;
      const cTube = fwFlow * des.cTube[2];
      const R = cTube / cShell;
      const eff = effectiveness((U[2] * area[2]) / cTube, R);
      dshFwOut = eff * (stmT - condFwOut) + condFwOut;
    } else dshFwOut = condFwOut;
    if (Math.abs(dshFwOut - prevOut) < 0.01) break;
  }
  const dPfw = (nv.tubeDP ?? 0) * (fwFlow / nv.fwFlow) ** 1.8;
  return {
    fwOutT: dshFwOut,
    fwOutP: a.fwInP - dPfw,
    ttd: tsatIn - dshFwOut,
    dca: subStmOut - a.fwInT,
    drainOutT: subStmOut,
    extrFlow: stmFlow,
    tempRise: dshFwOut - a.fwInT,
    shellP: shellOutP,
    U,
    subFwOut,
    condFwOut,
    condSat,
  };
}
