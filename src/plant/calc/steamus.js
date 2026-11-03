/**
 * Steam property calls in US customary units (psia, degF, Btu/lbm, ft3/lbm), with input
 * guards (superheated inputs at least
 * Tsat + 0.01 F, liquid inputs at least Psat + 0.1 psi). Built on the IAPWS-IF97 properties.
 */
import * as st from '../../common/steam.js';
import { fToC, cToF, psiaToMpa, mpaToPsia, kjkgToBtulb, btulbToKjkg, m3kgToFt3lb } from './units.js';

const KJKGK_PER_BTULBF = 4.1868;

/** Saturation temperature [F] at p [psia] ("StmPT"). */
export const StmPT = (p) => cToF(st.tsat(psiaToMpa(p)));
/** Saturation pressure [psia] at T [F] ("StmTP"). */
export const StmTP = (t) => mpaToPsia(st.psat(fToC(t)));

/** Band [F] below saturation still treated as (saturated) vapour - a steam line measured at Tsat. */
const VAP_BAND = 2;
/**
 * Enthalpy [Btu/lbm] at p, T: compressed liquid more than 2 F below saturation, otherwise steam
 * with the temperature raised to at least Tsat + 0.01 F.
 */
export function StmEnth(p, t) {
  const ts = StmPT(p);
  if (t < ts - VAP_BAND) return kjkgToBtulb(st.hWater(psiaToMpa(p), fToC(t)));
  return kjkgToBtulb(st.hSteam(psiaToMpa(p), fToC(Math.max(t, ts + 0.01))));
}
/** Entropy [Btu/lbm F] at p, T (phases as StmEnth). */
export function StmEntropy(p, t) {
  const ts = StmPT(p);
  if (t < ts - VAP_BAND) return st.sPH(psiaToMpa(p), st.hWater(psiaToMpa(p), fToC(t))) / KJKGK_PER_BTULBF;
  return st.sSteam(psiaToMpa(p), fToC(Math.max(t, ts + 0.01))) / KJKGK_PER_BTULBF;
}
/** Entropy [Btu/lbm F] at p, h (any phase). */
export const StmEntropyPH = (p, h) => st.sPH(psiaToMpa(p), btulbToKjkg(h)) / KJKGK_PER_BTULBF;
/** Enthalpy [Btu/lbm] at p, s ("StmEnth(Pout, Sin)" of an isentropic expansion). */
export const StmEnthPS = (p, s) => kjkgToBtulb(st.hPS(psiaToMpa(p), s * KJKGK_PER_BTULBF));
/** Temperature [F] at p, h (wet steam: saturation temperature) ("StmPH"). */
export const StmTempPH = (p, h) => cToF(st.tSteam(psiaToMpa(p), btulbToKjkg(h)));
/** Quality (0..1) at p, h. */
export const StmQuality = (p, h) => st.quality(psiaToMpa(p), btulbToKjkg(h));
/** Specific volume [ft3/lbm] at p, T: superheated steam, or liquid when T is below saturation. */
export function StmSpVol(p, t) {
  const P = psiaToMpa(p);
  const T = fToC(t);
  const ts = st.tsat(P);
  return m3kgToFt3lb(T < ts - VAP_BAND / 1.8 ? st.water(P, T).v : st.vSteam(P, Math.max(T, ts + 0.005)));
}
/** Specific volume [ft3/lbm] at p, h. */
export const StmSpVolPH = (p, h) => m3kgToFt3lb(st.vPH(psiaToMpa(p), btulbToKjkg(h)));
/** Saturated (dry) vapour specific volume [ft3/lbm] at p. */
export const StmVolSatVap = (p) => m3kgToFt3lb(1 / st.rhog(psiaToMpa(p)));
/** Saturated liquid / vapour enthalpy [Btu/lbm] at p. */
export const StmHf = (p) => kjkgToBtulb(st.hf(psiaToMpa(p)));
export const StmHg = (p) => kjkgToBtulb(st.hg(psiaToMpa(p)));

/** "LiquidWaterEnthalpy": liquid at p, T; if p is below saturation at T, p = Psat + 0.1. */
export function LiquidWaterEnthalpy(p, t) {
  const ps = StmTP(t);
  return kjkgToBtulb(st.hWater(psiaToMpa(Math.max(p, ps + 0.1)), fToC(t)));
}
/** "SteamEnthalpy": vapour at p, T; if p is above saturation at T, p = Psat - 0.1. */
export function SteamEnthalpy(p, t) {
  const ps = StmTP(t);
  const pp = p > ps ? Math.max(0.01, ps - 0.1) : p;
  return kjkgToBtulb(st.hSteam(psiaToMpa(pp), fToC(t)));
}
/** Liquid specific heat [Btu/lbm F] at p, T. */
export const StmSpecHeat = (p, t) => st.water(psiaToMpa(p), fToC(t)).cp / KJKGK_PER_BTULBF;
/** Superheated steam specific heat [Btu/lbm F] at p, T. */
export const StmSpecHeatVap = (p, t) => st.cpSteam(psiaToMpa(p), fToC(t)) / KJKGK_PER_BTULBF;

/** Liquid water viscosity [lbm/ft h] at T [F] (Vogel equation, 0 - 370 C, about 2 %). */
export function StmVisc(_p, t) {
  const tk = fToC(t) + 273.15;
  const muPas = 2.414e-5 * 10 ** (247.8 / (tk - 140));
  return muPas * 2419.088; // Pa s -> lbm/(ft h)
}
/** Liquid water thermal conductivity [Btu/h ft F] at T [F] (fit for 275 - 620 K, about 2 %). */
export function StmCond(_p, t) {
  const tk = Math.min(620, Math.max(275, fToC(t) + 273.15));
  const k = -0.5752 + 6.397e-3 * tk - 8.151e-6 * tk * tk; // W/m K
  return k * 0.5778;
}
