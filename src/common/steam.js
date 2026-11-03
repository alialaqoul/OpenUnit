/**
 * Water / steam properties of the process model: IAPWS-IF97 (if97.js), the formulation EtaPRO's
 * "GP Steam" uses, so the plant obeys the same thermodynamics as the performance calculations.
 *
 *   region 1 (compressed liquid) and region 2 (superheated steam) exactly; saturation from
 *   region 4 with the saturated phases from regions 1 / 2 up to 16.53 MPa (350 degC). Above it
 *   (region 3: the drum at full load) the saturated states come from an IF97-derived table, and
 *   steam between saturation and the region 2 boundary (a few degrees) is interpolated.
 *
 * Units: P [MPa abs], T [degC], h [kJ/kg], s [kJ/kg K], v [m3/kg], rho [kg/m3]
 */
import { region1, region2, psatK, tsatK, tB23 } from './if97.js';

export const P_ATM = 0.101325;
const K = 273.15;
const P13 = 16.5291643; // MPa: saturation pressure at 623.15 K, the region 1 / 3 boundary
const P_CRIT = 22.064;

// IF97-derived saturated states above P13 (region 3): [P, hf, hg, rho_f, rho_g]
const SAT3 = [
  [16.5291643, 1670.86, 2563.59, 574.69, 113.62],
  [17.0, 1690.0, 2547.4, 564.9, 119.5],
  [18.0, 1732.0, 2509.5, 543.5, 133.3],
  [19.0, 1776.8, 2466.0, 520.0, 149.8],
  [20.0, 1826.6, 2412.1, 490.4, 170.6],
  [21.0, 1888.0, 2338.8, 452.0, 200.5],
  [22.064, 2087.5, 2087.5, 322.0, 322.0],
];
function sat3(P, col) {
  const p = Math.min(P_CRIT, Math.max(P13, P));
  let i = 1;
  while (i < SAT3.length - 1 && SAT3[i][0] < p) i++;
  const f = (p - SAT3[i - 1][0]) / (SAT3[i][0] - SAT3[i - 1][0]);
  return SAT3[i - 1][col] + f * (SAT3[i][col] - SAT3[i - 1][col]);
}

const clampP = (P) => Math.min(P_CRIT, Math.max(0.000612, P));

/** Saturation temperature [degC] at P [MPa abs]. */
export const tsat = (P) => tsatK(clampP(P)) - K;
/** Saturation pressure [MPa abs] at T [degC]. Below 0.01 degC it extrapolates on ln(P). */
export function psat(T) {
  if (T < 0.01) return 0.000611657 * Math.exp(0.08 * (T - 0.01));
  return psatK(Math.min(647.09, T + K));
}

// ------------------------------------------------------------------ saturated phases
// The process model asks for the same saturation states many times per step (drum, SH, DA):
// a small cache keyed by the exact pressure avoids re-evaluating region 4 + region 1 / 2.
const satCache = { liq: new Map(), vap: new Map() };
function cached(map, p, fn) {
  let v = map.get(p);
  if (v === undefined) {
    if (map.size > 256) map.clear();
    v = fn(p);
    map.set(p, v);
  }
  return v;
}
/** Saturated liquid: { h, s, v } at P. */
function satLiq(P) {
  return cached(satCache.liq, clampP(P), satLiqCalc);
}
function satVap(P) {
  return cached(satCache.vap, clampP(P), satVapCalc);
}
function satLiqCalc(p) {
  if (p <= P13) return region1(p, tsatK(p));
  const top = region1(P13, 623.15);
  const h = sat3(p, 1);
  return { h, s: top.s + (h - top.h) / ((tsatK(p) + 623.15) / 2), v: 1 / sat3(p, 3), cp: top.cp };
}
/** Saturated vapour: { h, s, v } at P. */
function satVapCalc(p) {
  if (p <= P13) return region2(p, tsatK(p));
  const l = satLiq(p);
  const h = sat3(p, 2);
  return { h, s: l.s + (h - l.h) / tsatK(p), v: 1 / sat3(p, 4), cp: region2(P13, 623.15).cp };
}

export const hf = (P) => satLiq(P).h;
export const hg = (P) => satVap(P).h;
export const hfg = (P) => satVap(P).h - satLiq(P).h;
export const sf = (P) => satLiq(P).s;
export const sg = (P) => satVap(P).s;
export const rhof = (P) => 1 / satLiq(P).v;
export const rhog = (P) => 1 / satVap(P).v;

// ------------------------------------------------------------------ liquid water
/** Compressed liquid { h, s, v, cp } at P, T (region 1; at or above saturation: saturated liquid). */
export function water(P, T) {
  const p = clampP(Math.max(P, psat(T) + 1e-6));
  const t = Math.min(T, tsat(p) - 1e-6);
  if (t + K <= 623.15) return region1(Math.max(p, P), t + K);
  return satLiq(p);
}
export const hWater = (P, T) => water(P, T).h;

// Saturated liquid along temperature, tabulated from IF97 every 0.25 K (interpolation error < 0.01 kJ/kg).
const LIQ_DT = 0.25;
const LIQ_T0 = 0.01;
const LIQ_N = Math.floor((373.9 - LIQ_T0) / LIQ_DT) + 1;
const LIQ_H = new Float64Array(LIQ_N);
const LIQ_V = new Float64Array(LIQ_N);
for (let i = 0; i < LIQ_N; i++) {
  const T = LIQ_T0 + i * LIQ_DT;
  const st = T + K <= 623.15 ? region1(psatK(T + K), T + K) : satLiqCalc(psatK(T + K));
  LIQ_H[i] = st.h;
  LIQ_V[i] = st.v;
}
function liqAt(arr, T) {
  const x = (Math.min(373.9, T) - LIQ_T0) / LIQ_DT;
  const i = Math.min(LIQ_N - 2, Math.max(0, Math.floor(x)));
  return arr[i] + (x - i) * (arr[i + 1] - arr[i]);
}

/** Enthalpy of saturated liquid at temperature T [degC]. */
export function hLiq(T) {
  if (T <= 0.01) return 4.217 * T;
  return liqAt(LIQ_H, T);
}

/** Inverse of hLiq: liquid temperature from enthalpy (saturated liquid). */
export function tLiq(h) {
  if (h <= 0.0) return h / 4.217;
  let lo = 0;
  let hi = LIQ_N - 1;
  if (h >= LIQ_H[hi]) return 373.9;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (LIQ_H[mid] < h) lo = mid;
    else hi = mid;
  }
  return LIQ_T0 + (lo + (h - LIQ_H[lo]) / (LIQ_H[hi] - LIQ_H[lo])) * LIQ_DT;
}

/** Saturated liquid density at T [degC]. */
export const rhoLiq = (T) => (T <= 0.01 ? 999.8 : 1 / liqAt(LIQ_V, T));

/** d(hf)/dT along saturation [kJ/kg K]. */
export function dhfdT(T) {
  const t = Math.min(372, Math.max(1, T));
  return (hLiq(t + 0.5) - hLiq(t - 0.5)) / 1;
}

// ------------------------------------------------------------------ superheated steam
/** Superheated steam { h, s, v, cp } at P, T (at or below saturation: saturated vapour). */
export function steam(P, T) {
  const p = clampP(P);
  const ts = tsat(p);
  if (T <= ts) return satVap(p);
  if (p <= P13) return region2(p, T + K);
  // region 3 vapour side: interpolate between saturation and the region 2 boundary
  const tb = tB23(p) - K;
  if (T >= tb) return region2(p, T + K);
  const a = satVap(p);
  const b = region2(p, tb + K);
  const f = (T - ts) / (tb - ts);
  return { h: a.h + f * (b.h - a.h), s: a.s + f * (b.s - a.s), v: a.v + f * (b.v - a.v), cp: (b.h - a.h) / (tb - ts) };
}
export const hSteam = (P, T) => steam(P, T).h;
export const sSteam = (P, T) => steam(P, T).s;
export const vSteam = (P, T) => steam(P, T).v;
/** Isobaric specific heat of superheated steam [kJ/kg K] at P, T. */
export const cpSteam = (P, T = tsat(P) + 50) => steam(P, T).cp;

/** Steam temperature [degC] from P, h. Wet steam returns the saturation temperature. */
export function tSteam(P, h, guess) {
  const ts = tsat(P);
  const g = hg(P);
  if (h <= g) return ts;
  let T = guess > ts ? guess : ts + Math.max(1, (h - g) / 2.2);
  for (let i = 0; i < 30; i++) {
    const st = steam(P, T);
    const dT = (h - st.h) / Math.max(1, st.cp);
    T = Math.max(ts + 1e-6, T + dT);
    if (Math.abs(dT) < 1e-6) break;
  }
  return T;
}

/** Steam temperature [degC] from P, s (superheated). */
function tFromS(P, s) {
  const ts = tsat(P);
  let T = ts + 50;
  for (let i = 0; i < 40; i++) {
    const st = steam(P, T);
    // ds/dT = cp / T
    const dT = ((s - st.s) * (T + K)) / Math.max(0.5, st.cp);
    T = Math.max(ts + 1e-6, T + dT);
    if (Math.abs(dT) < 1e-6) break;
  }
  return T;
}

// ------------------------------------------------------------------ two-phase and (p, h) / (p, s) states
/** Steam quality (0..1) for wet steam, 1 when superheated, 0 when subcooled. */
export function quality(P, h) {
  const f = hf(P);
  const g = hg(P);
  return Math.max(0, Math.min(1, (h - f) / (g - f)));
}

/** Entropy [kJ/kg K] at P, h (liquid, wet or superheated). */
export function sPH(P, h) {
  const l = satLiq(P);
  const g = satVap(P);
  if (h >= g.h) return steam(P, tSteam(P, h)).s;
  if (h <= l.h) return water(P, tLiq(h)).s;
  const x = (h - l.h) / (g.h - l.h);
  return l.s + x * (g.s - l.s);
}

/** Specific volume [m3/kg] at P, h. */
export function vPH(P, h) {
  const l = satLiq(P);
  const g = satVap(P);
  if (h >= g.h) return steam(P, tSteam(P, h)).v;
  if (h <= l.h) return l.v;
  const x = (h - l.h) / (g.h - l.h);
  return l.v + x * (g.v - l.v);
}

/** Enthalpy [kJ/kg] at P, s: the end point of an isentropic expansion ("StmEnth(Pout, Sin)"). */
export function hPS(P, s) {
  const l = satLiq(P);
  const g = satVap(P);
  if (s >= g.s) return steam(P, tFromS(P, s)).h;
  if (s <= l.s) return l.h;
  const x = (s - l.s) / (g.s - l.s);
  return l.h + x * (g.h - l.h);
}

/** Enthalpy drop [kJ/kg] of an expansion from Pin, Tin to Pout with enthalpy-drop efficiency eta (template 2140). */
export function expansionDrop(Pin, Tin, Pout, eta) {
  if (Pin <= 0 || Pout >= Pin) return 0;
  const a = steam(Pin, Tin);
  return eta * (a.h - hPS(Pout, a.s));
}
