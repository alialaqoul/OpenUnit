/**
 * Compact steam table for the controllers - the saturation function a DCS carries in its function
 * block library (the PLC function TSAT is generated from it, so both runtimes compute the same).
 * The process model uses the full IAPWS-IF97 properties in steam.js.
 *
 * Saturation properties come from an IAPWS-IF97 derived table interpolated on ln(P).
 * Superheated steam uses an effective specific heat that depends on pressure, which is
 * accurate to a few percent over the 0.005 - 20 MPa / 100 - 560 degC operating envelope.
 *
 * Units: P [MPa abs], T [degC], h [kJ/kg], rho [kg/m3]
 */

// [P MPa, Tsat C, hf, hg, rho_f, rho_g]
const SAT = [
  [0.001, 6.97, 29.3, 2513.7, 999.9, 0.00774],
  [0.002, 17.5, 73.4, 2532.9, 998.7, 0.01493],
  [0.003, 24.08, 101.0, 2544.9, 997.3, 0.02179],
  [0.004, 28.96, 121.4, 2553.7, 996.0, 0.02866],
  [0.005, 32.88, 137.8, 2560.7, 994.7, 0.03548],
  [0.006, 36.16, 151.5, 2566.6, 993.6, 0.0423],
  [0.008, 41.51, 173.9, 2576.2, 991.6, 0.0557],
  [0.01, 45.81, 191.8, 2583.9, 989.8, 0.0682],
  [0.015, 53.97, 225.9, 2598.3, 986.0, 0.0998],
  [0.02, 60.06, 251.4, 2608.9, 983.2, 0.1307],
  [0.03, 69.1, 289.2, 2624.6, 978.3, 0.1912],
  [0.05, 81.32, 340.5, 2645.2, 970.9, 0.3086],
  [0.07, 89.95, 376.7, 2659.4, 965.3, 0.4235],
  [0.101325, 99.97, 419.1, 2675.6, 958.4, 0.5977],
  [0.15, 111.35, 467.1, 2693.1, 949.9, 0.8628],
  [0.2, 120.21, 504.7, 2706.2, 942.9, 1.129],
  [0.3, 133.52, 561.4, 2724.9, 931.8, 1.651],
  [0.5, 151.83, 640.1, 2748.1, 915.3, 2.668],
  [0.7, 164.95, 697.0, 2762.8, 902.7, 3.666],
  [1.0, 179.88, 762.5, 2777.1, 887.1, 5.145],
  [1.5, 198.29, 844.6, 2791.0, 866.0, 7.594],
  [2.0, 212.38, 908.5, 2798.4, 849.3, 10.04],
  [3.0, 233.86, 1008.3, 2803.3, 822.0, 15.0],
  [4.0, 250.36, 1087.4, 2800.8, 798.4, 20.09],
  [5.0, 263.94, 1154.5, 2794.2, 777.4, 25.35],
  [6.0, 275.59, 1213.7, 2784.6, 758.0, 30.82],
  [7.0, 285.83, 1267.4, 2772.6, 739.7, 36.53],
  [8.0, 295.01, 1317.1, 2758.7, 722.2, 42.51],
  [9.0, 303.35, 1363.7, 2742.9, 705.0, 48.79],
  [10.0, 311.0, 1407.9, 2725.5, 688.4, 55.46],
  [11.0, 318.08, 1450.3, 2706.3, 671.8, 62.54],
  [12.0, 324.68, 1491.3, 2685.4, 654.8, 70.1],
  [13.0, 330.86, 1531.4, 2662.4, 638.1, 78.15],
  [14.0, 336.67, 1570.9, 2637.9, 620.7, 87.03],
  [15.0, 342.16, 1610.2, 2610.9, 603.0, 96.65],
  [16.0, 347.36, 1649.7, 2580.8, 584.5, 107.4],
  [17.0, 352.29, 1690.0, 2547.4, 564.9, 119.5],
  [18.0, 356.99, 1732.0, 2509.5, 543.5, 133.3],
  [19.0, 361.47, 1776.8, 2466.0, 520.0, 149.8],
  [20.0, 365.75, 1826.6, 2412.1, 490.4, 170.6],
  [21.0, 369.83, 1888.0, 2338.8, 452.0, 200.5],
  [21.8, 373.0, 1961.0, 2250.0, 410.0, 240.0],
];

const LNP = SAT.map((r) => Math.log(r[0]));
const P_MIN = SAT[0][0];
const P_MAX = SAT[SAT.length - 1][0];
const T_MIN = SAT[0][1];
const T_MAX = SAT[SAT.length - 1][1];

export const P_ATM = 0.101325;

function interpByP(P, col) {
  const p = Math.min(P_MAX, Math.max(P_MIN, P));
  const x = Math.log(p);
  let i = 1;
  while (i < LNP.length - 1 && LNP[i] < x) i++;
  const f = (x - LNP[i - 1]) / (LNP[i] - LNP[i - 1]);
  return SAT[i - 1][col] + f * (SAT[i][col] - SAT[i - 1][col]);
}

function indexByT(T) {
  const t = Math.min(T_MAX, Math.max(T_MIN, T));
  let i = 1;
  while (i < SAT.length - 1 && SAT[i][1] < t) i++;
  const f = (t - SAT[i - 1][1]) / (SAT[i][1] - SAT[i - 1][1]);
  return { i, f };
}

function interpByT(T, col) {
  const { i, f } = indexByT(T);
  return SAT[i - 1][col] + f * (SAT[i][col] - SAT[i - 1][col]);
}

/** Saturation temperature [C] at pressure P [MPa abs]. */
export const tsat = (P) => interpByP(P, 1);
export const hf = (P) => interpByP(P, 2);
export const hg = (P) => interpByP(P, 3);
export const hfg = (P) => interpByP(P, 3) - interpByP(P, 2);
export const rhof = (P) => interpByP(P, 4);
export const rhog = (P) => interpByP(P, 5);

/** Saturation pressure [MPa abs] at temperature T [C]. Below the table it extrapolates on ln(P). */
export function psat(T) {
  if (T <= T_MIN) return P_MIN * Math.exp(0.06 * (T - T_MIN));
  const { i, f } = indexByT(T);
  return Math.exp(LNP[i - 1] + f * (LNP[i] - LNP[i - 1]));
}

/** Enthalpy of (compressed) liquid water at T, approximated by saturated liquid enthalpy. */
export function hLiq(T) {
  if (T <= T_MIN) return 4.19 * T;
  return interpByT(T, 2);
}

/** Inverse of hLiq: liquid temperature from enthalpy. */
export function tLiq(h) {
  if (h <= SAT[0][2]) return h / 4.19;
  let i = 1;
  while (i < SAT.length - 1 && SAT[i][2] < h) i++;
  const f = (h - SAT[i - 1][2]) / (SAT[i][2] - SAT[i - 1][2]);
  return SAT[i - 1][1] + Math.min(1, f) * (SAT[i][1] - SAT[i - 1][1]);
}

/** Liquid density at temperature T (saturated). */
export const rhoLiq = (T) => (T <= T_MIN ? 1000 : interpByT(T, 4));

/** d(hf)/dT along saturation [kJ/kg/K]. */
export function dhfdT(T) {
  const t = Math.min(T_MAX - 1, Math.max(T_MIN + 1, T));
  return (hLiq(t + 1) - hLiq(t - 1)) / 2;
}

/** Effective specific heat of superheated steam [kJ/kg/K] as a function of pressure. */
export const cpSteam = (P) => 2.0 + 0.145 * Math.max(0, Math.min(20, P));

/** Steam enthalpy at P, T. At or below saturation returns saturated vapour enthalpy. */
export function hSteam(P, T) {
  const ts = tsat(P);
  return hg(P) + cpSteam(P) * Math.max(0, T - ts);
}

/** Steam temperature from P, h. Wet steam returns the saturation temperature. */
export function tSteam(P, h) {
  const ts = tsat(P);
  const g = hg(P);
  if (h <= g) return ts;
  return ts + (h - g) / cpSteam(P);
}

/** Steam quality (0..1) for wet steam, 1 when superheated, 0 when subcooled. */
export function quality(P, h) {
  const f = hf(P);
  const g = hg(P);
  return Math.max(0, Math.min(1, (h - f) / (g - f)));
}

/** Approximate isentropic-efficiency based expansion enthalpy drop [kJ/kg]. */
export function expansionDrop(Pin, Tin, Pout, eta) {
  if (Pin <= 0 || Pout >= Pin) return 0;
  const r = Math.max(1e-4, Pout / Pin);
  return eta * 2.03 * (Tin + 273.15) * (1 - Math.pow(r, 0.23));
}
