/**
 * Fans: total pressure, net total pressure and fan power output. Pressures in inH2O gauge, flow in ft3/min (acfm), area in ft2, density in lbm/ft3.
 */

/** Velocity pressure [inH2O] at a velocity [ft/min] and density (V / 1097)^2 rho. */
const velPress = (flow, area, density) => (area > 0 ? ((flow / area / 1097) ** 2) * density : 0);
/** Fan total pressure at the inlet or outlet [inH2Og]. */
export const fanTotalPressure = (staticPress, flow, area, density) => staticPress + velPress(flow, area, density);
/** Fan net total pressure [inH2Og]. */
export const fanTotalPressureNet = (pIn, pOut, areaIn, areaOut, flow, density) =>
  pOut + velPress(flow, areaOut, density) - (pIn + velPress(flow, areaIn, density));
/** Fan power output [air HP]. */
export const fanPowerOutput = (totPressNet, flow) => (totPressNet * flow) / 6356;
