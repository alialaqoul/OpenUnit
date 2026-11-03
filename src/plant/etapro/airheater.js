/**
 * Air heater performance - EtaPRO templates 3800 (X-ratio), 3810 (gas side efficiency), 3820
 * (air side efficiency), 3830 (no-leakage gas outlet temperature, cold end protection), 3840 /
 * 3850 / 3860 (corrected gas outlet temperatures), 3880 (air outlet from efficiency and X-ratio),
 * 3903 / 3904 (leakage). Temperatures in F, leakage in %. (ASME PTC 4.3)
 */

/** Gas outlet temperature corrected to no leakage, Tgonl (step 1 of 3800 - 3860; Cp air / Cp gas = 1). */
export const gasOutNoLeak = (tAirIn, tGasOut, leakage) => (leakage / 100) * (tGasOut - tAirIn) + tGasOut;
/** Inverse: measured gas outlet temperature (with leakage) from Tgonl (template 3830 step 5). */
export const gasOutWithLeak = (tGonl, tAirIn, leakage) => (tGonl + (tAirIn * leakage) / 100) / (1 + leakage / 100);

/** Template 3800: X-ratio (gas temperature drop / air temperature rise). */
export function xRatio(tAirIn, tAirOut, tGasIn, tGasOut, leakage) {
  const rise = tAirOut - tAirIn;
  return rise !== 0 ? (tGasIn - gasOutNoLeak(tAirIn, tGasOut, leakage)) / rise : 0;
}
/** Template 3810: gas side efficiency [%]. */
export function gasSideEfficiency(tAirIn, tGasIn, tGasOut, leakage) {
  const head = tGasIn - tAirIn;
  return head !== 0 ? ((tGasIn - gasOutNoLeak(tAirIn, tGasOut, leakage)) / head) * 100 : 0;
}
/** Template 3820: air side efficiency [%]. */
export function airSideEfficiency(tAirIn, tGasIn, tAirOut) {
  const head = tGasIn - tAirIn;
  return head !== 0 ? ((tAirOut - tAirIn) / head) * 100 : 0;
}
/** Template 3830: no-leakage gas outlet and the cold end safety alarm (ACET / dew point). */
export function coldEnd(tAirIn, tGasOut, leakage, { minAcet = 150, dewPoint = 130, acetBias = 0, dewBias = 0 } = {}) {
  const tGonl = gasOutNoLeak(tAirIn, tGasOut, leakage);
  const acet = (tGonl + tAirIn) / 2;
  const egt = gasOutWithLeak(tGonl, tAirIn, leakage);
  return { tGonl, acet, alarm: acet < minAcet + acetBias || egt < dewPoint + dewBias };
}
/** Template 3840: gas outlet corrected to a reference air inlet temperature. */
export function gasOutCorrAirIn(tGasIn, tGasOut, tAirIn, refAir, leakage) {
  const eff = (tGasIn - gasOutNoLeak(tAirIn, tGasOut, leakage)) / (tGasIn - tAirIn);
  return tGasIn - eff * (tGasIn - refAir);
}
/** Template 3850: gas outlet corrected to the design gas inlet temperature. */
export function gasOutCorrGasIn(tGasIn, tGasOut, tAirIn, tGasInDes, leakage) {
  const tGonl = gasOutNoLeak(tAirIn, tGasOut, leakage);
  const head = tGasIn - tAirIn;
  return head !== 0 ? (tGasInDes * (tGonl - tAirIn) + tAirIn * (tGasIn - tGonl)) / head : 0;
}
/** Template 3860: gas outlet corrected for air inlet, gas inlet and leakage. */
export function gasOutCorrToDesign(tGasIn, tGasOut, tAirIn, refAir, leakage, tGasInDes) {
  const tGonl = gasOutNoLeak(tAirIn, tGasOut, leakage);
  return gasOutCorrAirIn(tGasIn, tGasOut, tAirIn, refAir, leakage) + gasOutCorrGasIn(tGasIn, tGasOut, tAirIn, tGasInDes, leakage) - tGonl;
}
/** Template 3880: air outlet temperature from the gas side efficiency [%] and X-ratio. */
export const airOutFromEffX = (tAirIn, tGasIn, gasSideEff, x) => ((tGasIn - tAirIn) * gasSideEff) / 100 / x + tAirIn;
/** Template 3903: air in-leakage [%] from the oxygen rise across the air heater (B&W eq. 19.8). */
export const leakageFromO2 = (o2In, o2Out) => (o2Out > 21 ? 100 : (90 * (o2Out - o2In)) / (21 - o2Out));
/** Template 3904: air in-leakage [%] after the air heater from the temperature drop. */
export const leakageFromTemps = (tOut, tStack, tAmb) => (tAmb > tStack ? 100 : ((100 / 0.9) * (tOut - tStack)) / (tStack - tAmb));
