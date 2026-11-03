/**
 * Furnace radiation: clean furnace exit gas temperature with a flame emissivity model (gas / oil
 * flame: non-luminous tri-atomic gas emissivity plus a luminous soot fraction, m = 0.1 for gas,
 * 0.55 for oil).
 *
 * The absorption coefficients and the exit temperature follow the normative furnace method:
 *   k_g  = [(7.8 + 16 rH2O) / sqrt(10 pn s) - 1] (1 - 0.37 T''/1000)        [1/(m MPa)]
 *   k_c  = 0.3 (2 - alpha) (1.6 T''/1000 - 0.5) C/H                          [1/(m MPa)]
 *   T''  = Ta / (1 + M Bo^-0.6 a_f^0.6)         Bo = phi B Vc / (sigma psi F Ta^3)
 * SI inside (m, MPa, K, kW), F / psia / ft at the interface.
 */
import { flueGasEnthalpy, flueGasTemperature } from './fluegas.js';
import { fToC } from './units.js';

const SIGMA = 5.67e-11; // kW / m2 K4
const PSI_TO_MPA = 0.00689476;
const FT_TO_M = 0.3048;

/** Tri-atomic (CO2 + H2O) absorption coefficient [1/(m MPa)]. */
export function triAtomGasesCoeff(rH2O, rn, pMPa, sM, tK) {
  const pns = Math.max(1e-4, rn * pMPa * sM);
  return Math.max(0, ((7.8 + 16 * rH2O) / Math.sqrt(10 * pns) - 1) * (1 - 0.37 * (tK / 1000)));
}
/** Soot particle absorption coefficient [1/(m MPa)] ("SootPartCoeff"). */
export function sootPartCoeff(excessAir, H, C, tK) {
  const alpha = 1 + excessAir / 100;
  return Math.max(0, 0.3 * (2 - alpha) * (1.6 * (tK / 1000) - 0.5) * (C / H));
}

/**
 * FlameEmissivity (calculation details) for gas and / or oil: rH2O, rn (CO2 + H2O) volume fractions,
 * furnace pressure [psia], beam length [ft], exit temperature estimate [F].
 */
export function flameEmissivity(ult, fg, { gasFrac = 1, oilFrac = 0, beamLengthFt, furnacePsia = 14.7, fegtF }) {
  const tK = fToC(fegtF) + 273.15;
  const rH2O = fg.WetH2OPctVol / 100;
  const rn = (fg.WetCO2PctVol + fg.WetH2OPctVol + fg.WetSO2PctVol) / 100;
  const p = furnacePsia * PSI_TO_MPA;
  const s = beamLengthFt * FT_TO_M;
  const kg = triAtomGasesCoeff(rH2O, rn, p, s, tK);
  const Ag = 1 - Math.exp(-kg * rn * p * s);
  const M = (0.1 * gasFrac + 0.55 * oilFrac) / Math.max(1e-9, gasFrac + oilFrac);
  const Klum = kg * rn + sootPartCoeff(fg.ExcessAir, ult.Hydrogen, ult.Carbon, tK);
  const Alum = 1 - Math.exp(-Klum * p * s);
  return M * Alum + (1 - M) * Ag;
}

/**
 * Furnace exit gas temperature [F] for a cleanliness (thermal efficiency psi of the
 * walls, 1 = clean reference). fuel flow in lb/s, available heat per lbm flue gas (avail),
 * nv: { wallAreaFt2, beamLengthFt, burnerHeight (relative, 0..1) }.
 * Returns { fegt, furnaceAbsorption [MMBtu/h], emissivity }.
 */
export function furnaceExitTemp(ult, fg, aft, fuelLbs, nv, { psi = 0.65, gasFrac = 1, oilFrac = 0, furnacePsia = 14.7, phi = 0.995 } = {}) {
  const Ta = fToC(aft.tF) + 273.15;
  const gasKgS = (fuelLbs * fg.WetGasPerlbFuel) / 2.20462262;
  const F = nv.wallAreaFt2 * FT_TO_M * FT_TO_M;
  const M = 0.54 - 0.2 * (nv.burnerHeight ?? 0.3);
  const hA = aft.availEnergy * 2.326; // kJ/kg gas
  let fegt = aft.tF - 900;
  let af = 0.5;
  for (let i = 0; i < 40; i++) {
    const hF = flueGasEnthalpy(fg, fegt) * 2.326;
    const T = fToC(fegt) + 273.15;
    const Vc = Ta > T + 1 ? (hA - hF) / (Ta - T) : 1.4; // mean heat capacity, kJ/kg K
    const aFlame = flameEmissivity(ult, fg, { gasFrac, oilFrac, beamLengthFt: nv.beamLengthFt, furnacePsia, fegtF: fegt });
    af = aFlame / (aFlame + (1 - aFlame) * psi);
    const Bo = (phi * gasKgS * Vc) / (SIGMA * psi * F * Ta ** 3);
    const Tn = Ta / (1 + M * Bo ** -0.6 * af ** 0.6);
    const fn = (Tn - 273.15) * 1.8 + 32;
    if (Math.abs(fn - fegt) < 0.05) {
      fegt = fn;
      break;
    }
    fegt = 0.5 * fegt + 0.5 * fn;
  }
  const absorbed = (fuelLbs * 3600 * fg.WetGasPerlbFuel * (aft.availEnergy - flueGasEnthalpy(fg, fegt))) / 1e6;
  return { fegt, furnaceAbsorption: absorbed, emissivity: af };
}

/** Gas temperature [F] after a heat transfer section removing duty [MMBtu/h] from gas flow [lb/h]. */
export function gasOutAfterDuty(fg, tInF, dutyMMBtu, gasLbh) {
  return flueGasTemperature(fg, flueGasEnthalpy(fg, tInF) - (dutyMMBtu * 1e6) / gasLbh);
}
