/**
 * Air heater performance: X-ratio, gas and air side efficiencies, no-leakage gas outlet
 * temperature and cold end protection, corrected gas outlet temperatures, air outlet from
 * efficiency and X-ratio, and leakage. Temperatures in F, leakage in %. (ASME PTC 4.3)
 */

/** Gas outlet temperature corrected to no leakage, Tgonl (Cp air / Cp gas = 1). */
export const gasOutNoLeak = (tAirIn, tGasOut, leakage) => (leakage / 100) * (tGasOut - tAirIn) + tGasOut;
/** Inverse: measured gas outlet temperature (with leakage) from Tgonl. */
export const gasOutWithLeak = (tGonl, tAirIn, leakage) => (tGonl + (tAirIn * leakage) / 100) / (1 + leakage / 100);

/** X-ratio (gas temperature drop / air temperature rise). */
export function xRatio(tAirIn, tAirOut, tGasIn, tGasOut, leakage) {
  const rise = tAirOut - tAirIn;
  return rise !== 0 ? (tGasIn - gasOutNoLeak(tAirIn, tGasOut, leakage)) / rise : 0;
}
/** Gas side efficiency [%]. */
export function gasSideEfficiency(tAirIn, tGasIn, tGasOut, leakage) {
  const head = tGasIn - tAirIn;
  return head !== 0 ? ((tGasIn - gasOutNoLeak(tAirIn, tGasOut, leakage)) / head) * 100 : 0;
}
/** Air side efficiency [%]. */
export function airSideEfficiency(tAirIn, tGasIn, tAirOut) {
  const head = tGasIn - tAirIn;
  return head !== 0 ? ((tAirOut - tAirIn) / head) * 100 : 0;
}
/** No-leakage gas outlet and the cold end safety alarm (ACET / dew point). */
export function coldEnd(tAirIn, tGasOut, leakage, { minAcet = 150, dewPoint = 130, acetBias = 0, dewBias = 0 } = {}) {
  const tGonl = gasOutNoLeak(tAirIn, tGasOut, leakage);
  const acet = (tGonl + tAirIn) / 2;
  const egt = gasOutWithLeak(tGonl, tAirIn, leakage);
  return { tGonl, acet, alarm: acet < minAcet + acetBias || egt < dewPoint + dewBias };
}
/** Gas outlet corrected to a reference air inlet temperature. */
export function gasOutCorrAirIn(tGasIn, tGasOut, tAirIn, refAir, leakage) {
  const eff = (tGasIn - gasOutNoLeak(tAirIn, tGasOut, leakage)) / (tGasIn - tAirIn);
  return tGasIn - eff * (tGasIn - refAir);
}
/** Gas outlet corrected to the design gas inlet temperature. */
export function gasOutCorrGasIn(tGasIn, tGasOut, tAirIn, tGasInDes, leakage) {
  const tGonl = gasOutNoLeak(tAirIn, tGasOut, leakage);
  const head = tGasIn - tAirIn;
  return head !== 0 ? (tGasInDes * (tGonl - tAirIn) + tAirIn * (tGasIn - tGonl)) / head : 0;
}
/** Gas outlet corrected for air inlet, gas inlet and leakage. */
export function gasOutCorrToDesign(tGasIn, tGasOut, tAirIn, refAir, leakage, tGasInDes) {
  const tGonl = gasOutNoLeak(tAirIn, tGasOut, leakage);
  return gasOutCorrAirIn(tGasIn, tGasOut, tAirIn, refAir, leakage) + gasOutCorrGasIn(tGasIn, tGasOut, tAirIn, tGasInDes, leakage) - tGonl;
}
/** Air outlet temperature from the gas side efficiency [%] and X-ratio. */
export const airOutFromEffX = (tAirIn, tGasIn, gasSideEff, x) => ((tGasIn - tAirIn) * gasSideEff) / 100 / x + tAirIn;
/** Air in-leakage [%] from the oxygen rise across the air heater (B&W eq. 19.8). */
export const leakageFromO2 = (o2In, o2Out) => (o2Out > 21 ? 100 : (90 * (o2Out - o2In)) / (21 - o2Out));
/** Air in-leakage [%] after the air heater from the temperature drop. */
export const leakageFromTemps = (tOut, tStack, tAmb) => (tAmb > tStack ? 100 : ((100 / 0.9) * (tOut - tStack)) / (tStack - tAmb));
