/**
 * Flue gas and air properties: flue gas enthalpy (reference 77 F), densities, adiabatic flame
 * temperature, cleanliness and section overall heat transfer coefficient.
 *
 * Each component's
 * enthalpy comes from the NIST Shomate fits of the same JANAF tables (H - H298.15).
 */
import { fToC } from './units.js';

// Shomate coefficients [A, B, C, D, E, F, H] per range, t = T/1000 K, H in kJ/mol (NIST / JANAF)
const SHOMATE = {
  N2: { M: 28.161, ranges: [[500, [28.98641, 1.853978, -9.647459, 16.63537, 0.000117, -8.671914, 0]], [2000, [19.50583, 19.88705, -8.598535, 1.369784, 0.527601, -4.935202, 0]], [6000, [35.51872, 1.128728, -0.196103, 0.014662, -4.55376, -18.97091, 0]]] },
  O2: { M: 31.9988, ranges: [[700, [31.32234, -20.23531, 57.86644, -36.50624, -0.007374, -8.903471, 0]], [2000, [30.03235, 8.772972, -3.988133, 0.788313, -0.741599, -11.32468, 0]], [6000, [20.91111, 10.72071, -2.020498, 0.146449, 9.245722, 5.337651, 0]]] },
  CO2: { M: 44.0095, ranges: [[1200, [24.99735, 55.18696, -33.69137, 7.948387, -0.136638, -403.6075, -393.5224]], [6000, [58.16639, 2.720074, -0.492289, 0.038844, -6.447293, -425.9186, -393.5224]]] },
  H2O: { M: 18.0153, ranges: [[1700, [30.092, 6.832514, 6.793435, -2.53448, 0.082139, -250.881, -241.8264]], [6000, [41.96426, 8.622053, -1.49978, 0.098119, -11.15764, -272.1797, -241.8264]]] },
  SO2: { M: 64.064, ranges: [[1200, [21.43049, 74.35094, -57.75217, 16.35534, 0.086731, -305.7688, -296.8422]], [6000, [57.48188, 1.009328, -0.07629, 0.005174, -4.045401, -324.414, -296.8422]]] },
  CO: { M: 28.0101, ranges: [[1300, [25.56759, 6.09613, 4.054656, -2.671301, 0.131021, -118.0089, -110.5271]], [6000, [35.1507, 1.300095, -0.205921, 0.01355, -3.28278, -127.8375, -110.5271]]] },
};

/** Sensible enthalpy of a component above 77 F (298.15 K) [Btu/lbm] at T [F]. */
export function componentEnthalpy(name, tF) {
  const c = SHOMATE[name];
  const T = Math.max(200, fToC(tF) + 273.15);
  const r = c.ranges.find(([tmax]) => T <= tmax) ?? c.ranges[c.ranges.length - 1];
  const [A, B, C, D, E, F, H] = r[1];
  const t = T / 1000;
  const kjmol = A * t + (B * t * t) / 2 + (C * t ** 3) / 3 + (D * t ** 4) / 4 - E / t + F - H;
  return ((kjmol * 1000) / c.M) / 2.326;
}

/** Wet flue gas enthalpy [Btu/lbm] at T [F] (zero at 77 F). */
export function flueGasEnthalpy(fg, tF) {
  return (
    (fg.WetCO2PctWt * componentEnthalpy('CO2', tF) +
      fg.WetN2PctWt * componentEnthalpy('N2', tF) +
      fg.WetO2PctWt * componentEnthalpy('O2', tF) +
      fg.WetSO2PctWt * componentEnthalpy('SO2', tF) +
      fg.WetCOPctWt * componentEnthalpy('CO', tF) +
      fg.WetH2OPctWt * componentEnthalpy('H2O', tF)) /
    100
  );
}

/** Specific heat of a component [Btu/lbm F] at T [F] (derivative of the Shomate enthalpy). */
export function componentCp(name, tF) {
  const c = SHOMATE[name];
  const T = Math.max(200, fToC(tF) + 273.15);
  const r = c.ranges.find(([tmax]) => T <= tmax) ?? c.ranges[c.ranges.length - 1];
  const [A, B, C, D, E] = r[1];
  const t = T / 1000;
  const jmolK = A + B * t + C * t * t + D * t ** 3 + E / (t * t);
  return jmolK / c.M / 4.1868;
}
/** Wet flue gas specific heat [Btu/lbm F] at T [F]. */
export function flueGasCp(fg, tF) {
  return (
    (fg.WetCO2PctWt * componentCp('CO2', tF) +
      fg.WetN2PctWt * componentCp('N2', tF) +
      fg.WetO2PctWt * componentCp('O2', tF) +
      fg.WetSO2PctWt * componentCp('SO2', tF) +
      fg.WetCOPctWt * componentCp('CO', tF) +
      fg.WetH2OPctWt * componentCp('H2O', tF)) /
    100
  );
}

/** Flue gas temperature [F] for an enthalpy [Btu/lbm] (inverse, Newton on the Shomate cp). */
export function flueGasTemperature(fg, h) {
  let T = 77 + h / 0.28;
  for (let i = 0; i < 12; i++) {
    const dT = (h - flueGasEnthalpy(fg, T)) / Math.max(0.15, flueGasCp(fg, T));
    T = Math.min(5000, Math.max(-100, T + dT));
    if (Math.abs(dT) < 1e-4) break;
  }
  return T;
}

/** Moist air enthalpy above 77 F [Btu/lbm wet air] at T [F]. */
export function airEnthalpy(tF, specHum = 0.013) {
  const dry = 0.2314 * componentEnthalpy('O2', tF) + 0.7686 * componentEnthalpy('N2', tF);
  return (dry + specHum * componentEnthalpy('H2O', tF)) / (1 + specHum);
}

/** Air density [lbm/ft3] at pressure [inHga] and temperature [F]. */
export const airDensity = (pInHg, tF) => (1.325 * pInHg) / (tF + 459.67);
/** Flue gas density [lbm/ft3] at T [F] and p [psia] (ideal gas). */
export const flueGasDensity = (fg, tF, pPsia) => (pPsia * fg.WetMolWt) / (10.73 * (459.67 + tF));

/**
 * Adiabatic flame temperature [F]. The energy available in the furnace per lbm of
 * wet flue gas, with heat in the combustion air above 77 F, set equal to the flue gas enthalpy.
 * (The temperature is solved exactly rather than with one mean specific heat.)
 */
export function adiabaticFlameTemp(ult, fg, { radLoss = 0, tAirOut = 77, carbonInAsh = 0 } = {}) {
  const avail =
    (ult.MassHHVLb * (1 - radLoss / 100) +
      0.24 * fg.WetAirPerlbFuel * (tAirOut - 77) -
      1030 * ((8.936 * ult.Hydrogen) / 100 + ult.Moisture / 100) -
      (14500 * carbonInAsh * ult.Ash) / 10000) /
    fg.WetGasPerlbFuel;
  return { tF: flueGasTemperature(fg, avail), availEnergy: avail };
}

/** Furnace water wall cleanliness factor (decimal). */
export function waterWallCleanliness(fg, flameTemp, actualFegt, cleanFegt) {
  const hf = flueGasEnthalpy(fg, flameTemp);
  const d = hf - flueGasEnthalpy(fg, cleanFegt);
  return d > 0 ? (hf - flueGasEnthalpy(fg, actualFegt)) / d : 0;
}

/** Boiler section cleanliness factor. */
export function sectionCleanliness(htcAct, gitAct, htcBase, gitBase) {
  const htcClean = htcBase * ((gitAct + 459.67) / (gitBase + 459.67)) ** 0.6;
  return htcClean > 0 ? htcAct / htcClean : 0;
}

/** Log mean temperature difference, counter or parallel flow. */
export function lmtd(tc1, tc2, th1, th2, arrangement = 'counter') {
  const [a, b] = arrangement === 'counter' ? [th2 - tc1, th1 - tc2] : [th1 - tc1, th2 - tc2];
  if (a === b) return a;
  if ((a > 0 && b > 0) || (a < 0 && b < 0)) return (a - b) / Math.log(a / b);
  return 0;
}

/** Overall heat transfer coefficient [Btu/h ft2 F] from duty [MMBtu/h], area [ft2], LMTD [F]. */
export const overallU = (dutyMMBtu, areaFt2, lmtdF) => (areaFt2 > 0 && lmtdF > 0 ? (1e6 * dutyMMBtu) / (areaFt2 * lmtdF) : 0);
