/**
 * Generator and auxiliaries: MVA, power factor, generator and mechanical losses ('62 GL),
 * generator efficiency and auxiliary power. Power in MW / MVAR, hydrogen pressure in psig.
 */

/** Generator output [MVA]. */
export const generatorMva = (MWgr, Var) => Math.sqrt(MWgr * MWgr + Var * Var);
/** Power factor. */
export const powerFactor = (MWgr, Var) => {
  const mva = generatorMva(MWgr, Var);
  return mva > 0 ? MWgr / mva : 1;
};

/**
 * Generator losses [MW] for a conventionally (H2) cooled 3600 rpm generator.
 * The polynomial coefficients of Figures 20, 22 and 23
 * ('62 GL Appendix IV) are not published; they are represented by:
 *  K1 (rated loss, % of kVA) falling from 1.4 % at 100 MVA by 0.195 % per e-fold of size,
 *  Pmin = 15 + 100 (max(0.7, X2) - 0.7) psig, Loss15 = 2.5e-4 kVA / (1 + 5.63e-6 kVA) kW.
 */
export function generatorLosses(MWgr, Var, H2Pres, kvaDes) {
  const KVA = 1000 * generatorMva(MWgr, Var);
  if (!(KVA > 0)) return 0;
  const K1 = Math.max(0.6, 1.4 - 0.195 * (Math.log(KVA) - Math.log(1e5)));
  const X2 = KVA / kvaDes;
  const K2 = -68.65583 / (1 - 194.05137 * X2 + 124.39554 * X2 * X2);
  const lossMinH2 = KVA * (K1 / 100) * K2;
  const Pmin = 15 + 100 * (Math.max(0.7, X2) - 0.7);
  const loss15 = (2.5e-4 * KVA) / (1 + 5.6299996e-6 * KVA);
  return (lossMinH2 + ((H2Pres - Pmin) * loss15) / 15) / 1000;
}

/** Turbine mechanical losses [MW], single casing 3600 rpm (Z2 above 123 MVA; Z1 approximated below). */
export function mechanicalLosses(kvaDes) {
  if (kvaDes > 123000) return (220.0 + 0.00183 * kvaDes) / 1000;
  return (40 + 0.00329 * kvaDes) / 1000;
}

/** Generator efficiency [%]. */
export const generatorEfficiency = (MWgr, mechLoss, genLoss) => (MWgr > 0 ? (100 * MWgr) / (MWgr + mechLoss + genLoss) : 0);

/** Auxiliary power [MW]. */
export function auxiliaryPower(xfmr, excit, stationXfmr = 0, unit1MW = 0, unit2MW = 0) {
  const total = unit1MW + unit2MW;
  return total === 0 ? xfmr + excit : xfmr + excit + (stationXfmr * unit1MW) / total;
}
