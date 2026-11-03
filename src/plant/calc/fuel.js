/**
 * Fuel gas analysis: converts the volumetric fuel gas composition into the mass based ultimate
 * analysis (ULT) that the combustion calculations use, with density, HHV and LHV.
 */

// component: molar mass, atoms C/H/O/N/S, HHV / LHV [Btu/lbm], density at 68 F / 29.92 inHga [lbm/ft3]
const GAS = {
  Methane: { M: 16.043, C: 1, H: 4, O: 0, N: 0, S: 0, hhv: 23891, lhv: 21511, rho: 0.041712 },
  Ethane: { M: 30.069, C: 2, H: 6, O: 0, N: 0, S: 0, hhv: 22333, lhv: 20429, rho: 0.07867 },
  Propane: { M: 44.096, C: 3, H: 8, O: 0, N: 0, S: 0, hhv: 21653, lhv: 19922, rho: 0.11643 },
  Butane: { M: 58.122, C: 4, H: 10, O: 0, N: 0, S: 0, hhv: 21232, lhv: 19590, rho: 0.15585 },
  Pentane: { M: 72.149, C: 5, H: 12, O: 0, N: 0, S: 0, hhv: 21085, lhv: 19494, rho: 0.187203 },
  Hexane: { M: 86.175, C: 6, H: 14, O: 0, N: 0, S: 0, hhv: 20940, lhv: 19403, rho: 0.2236056 },
  Nitrogen: { M: 28.013, C: 0, H: 0, O: 0, N: 2, S: 0, hhv: 0, lhv: 0, rho: 0.07272 },
  Oxygen: { M: 31.999, C: 0, H: 0, O: 2, N: 0, S: 0, hhv: 0, lhv: 0, rho: 0.083103 },
  CarbonDioxide: { M: 44.01, C: 1, H: 0, O: 2, N: 0, S: 0, hhv: 0, lhv: 0, rho: 0.11483 },
  HydrogenSulfide: { M: 34.081, C: 0, H: 2, O: 0, N: 0, S: 1, hhv: 7094, lhv: 6537, rho: 0.088425 },
};
const AW = { C: 12.011, H: 1.008, O: 15.999, N: 14.007, S: 32.06 };

/**
 * Ultimate analysis of a fuel gas from its volume % composition.
 * @param {Record<string, number>} comp  volume % by component name (keys of GAS)
 * @returns {{Carbon:number, Hydrogen:number, Oxygen:number, Nitrogen:number, Sulfur:number, Moisture:number, Ash:number,
 *           MassHHVLb:number, MassLHVLb:number, Density:number, VolHHVFt3:number, MolWt:number}}
 *          element wt %, HHV / LHV [Btu/lbm], density [lbm/ft3 at 68 F], HHV [Btu/ft3]
 */
export function fuelGasVolumeToMass(comp) {
  const total = Object.values(comp).reduce((a, b) => a + b, 0);
  let mass = 0;
  const el = { C: 0, H: 0, O: 0, N: 0, S: 0 };
  let hhv = 0;
  let lhv = 0;
  let rho = 0;
  for (const [name, pct] of Object.entries(comp)) {
    const g = GAS[name];
    if (!g) throw new Error(`unknown fuel gas component ${name}`);
    const x = pct / total; // mole fraction
    const m = x * g.M;
    mass += m;
    for (const e of Object.keys(el)) el[e] += x * g[e] * AW[e];
    hhv += m * g.hhv;
    lhv += m * g.lhv;
    rho += x * g.rho; // sum of partial densities
  }
  return {
    Carbon: (100 * el.C) / mass,
    Hydrogen: (100 * el.H) / mass,
    Oxygen: (100 * el.O) / mass,
    Nitrogen: (100 * el.N) / mass,
    Sulfur: (100 * el.S) / mass,
    Moisture: 0,
    Ash: 0,
    MassHHVLb: hhv / mass,
    MassLHVLb: lhv / mass,
    Density: rho,
    VolHHVFt3: (hhv / mass) * rho,
    MolWt: mass,
  };
}
