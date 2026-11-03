/**
 * Unit conversions between the simulator (SI: MPa, degC, kJ/kg, kg/s, MW) and the US customary
 * units the calculation library is written in (psia, degF, Btu/lbm, kPPH, MMBtu/h).
 */
export const PSI_PER_MPA = 145.0377;
export const BTU_PER_KJ = 1 / 1.05505585;
export const KJKG_PER_BTULB = 2.326;
export const LB_PER_KG = 2.20462262;
export const KPPH_PER_KGS = 3600 * LB_PER_KG / 1000; // 7.9366
export const MMBTUH_PER_MW = 3.412142;
export const KPA_PER_INHG = 3.386389;
export const GPM_PER_M3S = 15850.32;
export const FT_PER_M = 3.2808399;
export const HP_PER_KW = 1.341022;
export const P_BAR_PSIA = 14.696;

export const fToC = (f) => (f - 32) / 1.8;
export const cToF = (c) => c * 1.8 + 32;
export const dFtoK = (df) => df / 1.8;
export const dKtoF = (dk) => dk * 1.8;
export const psiaToMpa = (p) => p / PSI_PER_MPA;
export const mpaToPsia = (p) => p * PSI_PER_MPA;
export const btulbToKjkg = (h) => h * KJKG_PER_BTULB;
export const kjkgToBtulb = (h) => h / KJKG_PER_BTULB;
export const kpphToKgs = (w) => w / KPPH_PER_KGS;
export const kgsToKpph = (w) => w * KPPH_PER_KGS;
export const mmbtuhToMw = (q) => q / MMBTUH_PER_MW;
export const mwToMmbtuh = (q) => q * MMBTUH_PER_MW;
export const inhgToKpa = (p) => p * KPA_PER_INHG;
export const kpaToInhg = (p) => p / KPA_PER_INHG;
export const inhgToPsia = (p) => (p * KPA_PER_INHG) / 6.894757;
export const psiaToInhg = (p) => (p * 6.894757) / KPA_PER_INHG;
/** Specific volume ft3/lbm <-> m3/kg. */
export const ft3lbToM3kg = (v) => v * 0.06242796;
export const m3kgToFt3lb = (v) => v / 0.06242796;
/** Heat rate kJ/kWh <-> Btu/kWh. */
export const btukwhToKjkwh = (hr) => hr * 1.05505585;
export const kjkwhToBtukwh = (hr) => hr / 1.05505585;
