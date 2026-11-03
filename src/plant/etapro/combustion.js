/**
 * Combustion analysis - EtaPRO template 3 "Subroutine CombustionAnalysis" and the templates that
 * return its results (3000 excess air, 3010 air/fuel ratio, 3015, 3020 / 3030 flue gas per lbm
 * fuel, 3170 air flow, 3260 flue gas flow). No sorbent.
 *
 * ult: ultimate analysis of the fuel (wt %, fuel.js); excess air in %; specific humidity in
 * lbm water / lbm dry air.
 */

/** Flue gas for a given excess air [%] (template 3 steps 2 - 5 and 7 - 11). */
export function flueGasFromExcessAir(ult, excessAir, { COppm = 0, carbonInAsh = 0, specHum = 0.013 } = {}) {
  const H2OmolHF = ult.Hydrogen / 201.6;
  const H2OmolMF = ult.Moisture / 1801.6;
  const SO2mol = ult.Sulfur / 3206.4;
  const O2mol = ult.Oxygen / 3199.9;
  const N2mol = ult.Nitrogen / 2801.6;
  const FlueGasH2Omol = H2OmolHF + H2OmolMF;
  const AirMoist = specHum * 1.608;
  const TotalResidue = ult.Ash / 100 / (1 - carbonInAsh / 100);
  const CarbonBurned = (ult.Carbon - carbonInAsh * TotalResidue) / 100;
  const CO2molCB = CarbonBurned / 12.011;
  const TheorDryAirMol = (1 / 0.2095) * (CO2molCB + 0.5 * H2OmolHF + SO2mol - O2mol);
  const DryProd = CO2molCB + SO2mol + N2mol;
  const TheorDryAirMolCor = TheorDryAirMol + 2.387 * SO2mol;
  const DryFGMolAct = DryProd + 0.7905 * TheorDryAirMolCor;
  const WetFGMolAct = DryProd + FlueGasH2Omol + (0.7905 + AirMoist) * TheorDryAirMolCor;
  const EA = excessAir;
  const fg = { ExcessAir: EA, TotalResidue, DryFGMolAct, WetFGMolAct, TheorDryAirMolCor, AirMoist };
  fg.DryTheorAir = TheorDryAirMolCor * 28.966;
  fg.WetTheorAir = fg.DryTheorAir * (specHum + 1);
  fg.DryAirPerlbFuel = fg.DryTheorAir * (1 + EA / 100);
  fg.WetAirPerlbFuel = fg.WetTheorAir * (1 + EA / 100);
  fg.PctCarbonInFuelResidue = TotalResidue === 0 ? 1 : carbonInAsh;
  const TotalMolsDryFG = DryProd + TheorDryAirMolCor * (0.7905 + EA / 100);
  const TotalMolsWetFG = DryProd + FlueGasH2Omol + TheorDryAirMolCor * (0.7905 + AirMoist + (EA / 100) * (1 + AirMoist));
  fg.TotalMolsDryFG = TotalMolsDryFG;
  fg.TotalMolsWetFG = TotalMolsWetFG;
  // composition, volume %
  fg.DryO2PctVol = (EA * TheorDryAirMolCor * 0.2095) / TotalMolsDryFG;
  fg.DryCOPctVol = ((COppm / 10000) * TotalMolsWetFG) / TotalMolsDryFG;
  fg.DryCO2PctVol = (100 * (CO2molCB - (COppm / 1e6) * TotalMolsWetFG)) / TotalMolsDryFG;
  fg.DrySO2PctVol = (100 * SO2mol) / TotalMolsDryFG;
  fg.DryN2PctVol = (100 * (N2mol + (1 + EA / 100) * 0.7905 * TheorDryAirMolCor)) / TotalMolsDryFG;
  fg.WetO2PctVol = (EA * TheorDryAirMolCor * 0.2095) / TotalMolsWetFG;
  fg.WetCOPctVol = COppm / 10000;
  fg.WetCO2PctVol = (100 * (CO2molCB - (COppm / 1e6) * TotalMolsWetFG)) / TotalMolsWetFG;
  fg.WetSO2PctVol = (100 * SO2mol) / TotalMolsWetFG;
  fg.WetN2PctVol = (100 * (N2mol + (1 + EA / 100) * 0.7905 * TheorDryAirMolCor)) / TotalMolsWetFG;
  fg.WetH2OPctVol = (100 * (FlueGasH2Omol + (1 + EA / 100) * TheorDryAirMolCor * AirMoist)) / TotalMolsWetFG;
  // molecular weights and mass composition
  fg.DryMolWt = (fg.DryO2PctVol * 31.9998 + fg.DryCOPctVol * 28.01 + fg.DryCO2PctVol * 44.01 + fg.DrySO2PctVol * 64.064 + fg.DryN2PctVol * 28.161) / 100;
  fg.WetMolWt =
    (fg.WetO2PctVol * 31.9998 + fg.WetCOPctVol * 28.01 + fg.WetCO2PctVol * 44.01 + fg.WetSO2PctVol * 64.064 + fg.WetN2PctVol * 28.161 + fg.WetH2OPctVol * 18.016) /
    100;
  for (const [k, mw] of [['O2', 31.9998], ['CO', 28.01], ['CO2', 44.01], ['SO2', 64.064], ['N2', 28.161]]) {
    fg[`Dry${k}PctWt`] = (fg[`Dry${k}PctVol`] * mw) / fg.DryMolWt;
    fg[`Wet${k}PctWt`] = (fg[`Wet${k}PctVol`] * mw) / fg.WetMolWt;
  }
  fg.WetH2OPctWt = (fg.WetH2OPctVol * 18.016) / fg.WetMolWt;
  fg.DryGasPerlbFuel = fg.DryMolWt * TotalMolsDryFG;
  fg.WetGasPerlbFuel = fg.WetMolWt * TotalMolsWetFG;
  return fg;
}

/**
 * Template 3: combustion analysis from the measured excess oxygen [vol %] on a wet (o2Basis = 1)
 * or dry (0) basis.
 */
export function combustionAnalysis(ult, excessO2, { COppm = 0, carbonInAsh = 0, specHum = 0.013, o2Basis = 1 } = {}) {
  const base = flueGasFromExcessAir(ult, 0, { COppm, carbonInAsh, specHum });
  let EA;
  if (excessO2 > 20.95) EA = 100;
  else if (o2Basis === 1) EA = (100 * excessO2 * base.WetFGMolAct) / (base.TheorDryAirMolCor * (20.95 - excessO2 * (1 + base.AirMoist)));
  else EA = (100 * excessO2 * base.DryFGMolAct) / (base.TheorDryAirMolCor * (20.95 - excessO2));
  return flueGasFromExcessAir(ult, EA, { COppm, carbonInAsh, specHum });
}

/** Excess air [%] from the wet air / fuel mass ratio (inverse of template 3010). */
export function excessAirFromAirFuel(ult, wetAirPerLbFuel, opts = {}) {
  const theor = flueGasFromExcessAir(ult, 0, opts).WetTheorAir;
  return 100 * (wetAirPerLbFuel / theor - 1);
}

/** Template 3000: excess air [%]. */
export const excessAir = (ult, o2, opts) => combustionAnalysis(ult, o2, opts).ExcessAir;
/** Template 3010: air / fuel ratio, wet air [lbm/lbm fuel]. */
export const airFuelRatio = (ult, o2, opts) => combustionAnalysis(ult, o2, opts).WetAirPerlbFuel;
/** Template 3020: dry flue gas [lbm/lbm fuel]. */
export const dryGasPerLbFuel = (ult, o2, opts) => combustionAnalysis(ult, o2, opts).DryGasPerlbFuel;
/** Template 3030: wet flue gas [lbm/lbm fuel]. */
export const wetGasPerLbFuel = (ult, o2, opts) => combustionAnalysis(ult, o2, opts).WetGasPerlbFuel;
/** Template 3015: estimated flue gas flow [kPPH] from air flow [kPPH] and fuel mass flow [lb/h]. */
export const estimatedFlueGasFlow = (ult, airFlowKpph, fuelLbh) => airFlowKpph + (fuelLbh * (100 - ult.Ash)) / 100000;
/** Template 3170: total air flow [kPPH] from fuel flow [kPPH]. */
export const totalAirFlow = (ult, fuelKpph, o2, opts) => airFuelRatio(ult, o2, opts) * fuelKpph;
/** Template 3260: total flue gas flow [kPPH] from fuel flow [kPPH]. */
export const totalFlueGasFlow = (ult, fuelKpph, o2, opts) => wetGasPerLbFuel(ult, o2, opts) * fuelKpph;
/** Template 3161 / 3250: fuel flow [kPPH] from boiler heat input [MMBtu/h]. */
export const fuelFlowFromHeatInput = (ult, heatInput) => (1000 * heatInput) / ult.MassHHVLb;
