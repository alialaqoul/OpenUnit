/**
 * Boiler losses and efficiency by the loss method - EtaPRO templates 3040, 3050, 3060, 3070,
 * 3080, 3085, 3090, 3120 and 3130 (ASME PTC 4.1 / PTC 4), and the boiler heat absorption 3180.
 * Temperatures in F, pressures in psia, losses in % of fuel HHV.
 */
import { combustionAnalysis } from './combustion.js';
import { SteamEnthalpy, LiquidWaterEnthalpy, StmEnth, StmHf, StmHg, StmTempPH } from './gpsteam.js';

/** Template 3040: dry gas loss. */
export function dryGasLoss(ult, fg, tGonl, tAirIn) {
  const CHRatio = ult.Carbon / ult.Hydrogen;
  const ACPVT = -2.09556 + 0.366905 * CHRatio + 0.000380948 * CHRatio ** 2;
  const ACPVX = 0.245 - 0.002 * CHRatio;
  const CPX = ACPVT + 0.006872 * tAirIn;
  const GasSpecHeat = ACPVX + 0.005 * CPX;
  return ((fg.DryGasPerlbFuel * GasSpecHeat * (tGonl - tAirIn)) / ult.MassHHVLb) * 100;
}
/** Template 3050: loss from moisture formed by burning hydrogen. */
export const hydrogenLoss = (ult, tGonl, tAirIn, pBar = 14.696) =>
  (8.936 * ult.Hydrogen * (SteamEnthalpy(pBar, tGonl) - LiquidWaterEnthalpy(pBar, tAirIn))) / ult.MassHHVLb;
/** Template 3060: loss from moisture in the air. */
export const airMoistureLoss = (ult, fg, specHum, tGonl, tAirIn) =>
  ((specHum * fg.DryAirPerlbFuel * ((1061 + 0.444 * tGonl) - (1061 + 0.444 * tAirIn))) / ult.MassHHVLb) * 100;
/** Template 3070: loss from moisture in the fuel. */
export const fuelMoistureLoss = (ult, tGonl, tAirIn, pBar = 14.696) =>
  (ult.Moisture * (SteamEnthalpy(pBar, tGonl) - LiquidWaterEnthalpy(pBar, tAirIn))) / ult.MassHHVLb;
/** Template 3080: loss from unburned carbon in the residue. */
export function carbonAshLoss(ult, fg) {
  const unburned = fg.PctCarbonInFuelResidue;
  if (!(ult.Ash > 0)) return 0;
  const refuse = ult.Ash / (100 - unburned);
  return ((refuse * ((14500 * unburned) / 100)) / ult.MassHHVLb) * 100;
}
/** Template 3085: NOx loss. */
export const noxLoss = (ult, fg, NOxppm) => ((NOxppm / 10000) * (fg.DryAirPerlbFuel / fg.DryMolWt) * 38600) / ult.MassHHVLb;
/** Template 3090: loss from carbon monoxide. */
export function coLoss(ult, fg, COppm, carbonInAsh = 0) {
  const carbonBurned = (ult.Carbon * (1 - (carbonInAsh * ult.Ash) / 10000)) / 100;
  const CO = COppm / 10000;
  return CO > 0 ? (CO / (CO + fg.DryCO2PctVol)) * 10160 * carbonBurned * (100 / ult.MassHHVLb) : 0;
}
/** Template 3120: radiation loss [%] at a heat input [MMBtu/h], from the MCR heat input and cooled walls. */
export function radiationLoss(heatInput, heatInputAtMCR, cooledWalls = 4) {
  if (!(heatInput > 0) || !(heatInputAtMCR > 0)) return 0;
  const X = Math.log10(heatInputAtMCR);
  const Y = 1.290977565 - 1.356135164 * X + 0.505207873 * X ** 2 - 0.119895748 * X ** 3 + 0.01192849 * X ** 4;
  const wall = { 1: 0.94, 2: 0.88, 3: 0.81, 4: 0.75 }[cooledWalls] ?? 1;
  const lossAtMCR = wall * 10 ** Y;
  return 10 ** (-Math.log10(heatInput) + Math.log10(lossAtMCR) + Math.log10(heatInputAtMCR));
}

/**
 * Template 3130: boiler efficiency by the loss method. Iterates the radiation loss on the heat
 * input implied by the heat absorption. Returns the efficiency and every loss.
 */
export function boilerEfficiency(ult, nv, m) {
  const opts = { COppm: m.COppm ?? 0, carbonInAsh: m.carbonInAsh ?? 0, specHum: m.specHum ?? 0.013, o2Basis: nv.o2Basis ?? 1 };
  const fg = combustionAnalysis(ult, m.excessO2, opts);
  const Ldg = dryGasLoss(ult, fg, m.tGonl, m.tAirIn);
  const Lfm = fuelMoistureLoss(ult, m.tGonl, m.tAirIn, m.pBar);
  const Lam = airMoistureLoss(ult, fg, opts.specHum, m.tGonl, m.tAirIn);
  const Lh2 = hydrogenLoss(ult, m.tGonl, m.tAirIn, m.pBar);
  const Luc = carbonAshLoss(ult, fg);
  const LCO = coLoss(ult, fg, opts.COppm, opts.carbonInAsh);
  const NOxLs = noxLoss(ult, fg, m.NOxppm ?? 0);
  const Luac = m.unaccounted ?? nv.unaccountedLoss ?? 0.5;
  const misc = (m.miscLoss ?? 0) - (m.miscGain ?? 0);
  const others = Ldg + Lfm + Lam + Lh2 + Luc + LCO + NOxLs + Luac + misc;
  let eff = 100 - others - 0.2;
  let Lrad = 0;
  for (let i = 0; i < 6; i++) {
    const heatInput = (100 * m.heatAbsorption) / Math.max(1, eff);
    Lrad = radiationLoss(heatInput, nv.heatInputAtMCR, nv.cooledWalls);
    eff = 100 - others - Lrad;
  }
  return { efficiency: eff, losses: { Ldg, Lfm, Lam, Lh2, Luc, LCO, NOxLs, Lrad, Luac }, totalLoss: 100 - eff, fg };
}

/** Template 3501: desuperheater outlet temperature [F] from steam and spray flows [kPPH]. */
export function dshOutletTemp(Wstm, P, Tin, Tspray, Wspray) {
  const H1 = SteamEnthalpy(P, Tin);
  const h3 = LiquidWaterEnthalpy(P, Tspray);
  return StmTempPH(P, (Wstm * H1 + Wspray * h3) / (Wstm + Wspray));
}
/** Template 3505: desuperheater spray flow [kPPH] for an outlet temperature. */
export function dshSprayFlow(Wstm, P, Tin, Tspray, Tout) {
  const H1 = SteamEnthalpy(P, Tin);
  const H2 = SteamEnthalpy(P, Tout);
  const h3 = LiquidWaterEnthalpy(P, Tspray);
  return Math.max(0, (H2 * Wstm - H1 * Wstm) / (h3 - H2));
}

/**
 * Template 3180 (= 2090 with absolute pressures): boiler heat absorption [MMBtu/h] from the
 * water / steam flows [kPPH], pressures [psia] and temperatures [F] around the boiler.
 */
export function boilerHeatAbsorption(w) {
  const Hms = StmEnth(w.Pthr, w.Tthr);
  const Hfw = LiquidWaterEnthalpy(w.Pfw, w.Tfw);
  const Hsw = LiquidWaterEnthalpy(w.Pfw, w.Tshs ?? w.Tfw);
  const Hbd = StmHf(w.Pdr);
  const Hdr = StmHg(w.Pdr);
  const Hhrh = StmEnth(w.Prh, w.Trh);
  const Hcrh = StmEnth(w.Pcrh, w.Tcrh);
  return (
    ((w.Wfw ?? 0) * (Hms - Hfw) +
      (w.Wshs ?? 0) * (Hms - Hsw) -
      (w.Wbd ?? 0) * (Hms - Hbd) -
      (w.Wdraux ?? 0) * (Hms - Hdr) +
      (w.Wrh ?? 0) * (Hhrh - Hcrh) +
      (w.Wrhs ?? 0) * (Hhrh - Hsw)) /
    1000
  );
}
