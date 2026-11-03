import { describe, it, expect } from 'vitest';
import { units, steamus as GP, fuel, combustion as CB, fluegas as FG, boiler as BL, airheater as AH, turbine as TB, generator as GN, condenser as CD, fwh as FW, pumps as PU, fans as FA, heatrate as HR } from '../src/plant/calc/index.js';
import { region1, region2 } from '../src/common/if97.js';
import { design, HEATERS } from '../src/plant/model/design.js';

const GAS = { Methane: 96, Ethane: 2.2, Propane: 0.4, Nitrogen: 0.9, CarbonDioxide: 0.5 };

describe('IAPWS-IF97 steam properties', () => {
  it('reproduces the IF97 verification values of regions 1 and 2', () => {
    const a = region1(3, 300);
    expect(a.v).toBeCloseTo(0.100215168e-2, 10);
    expect(a.h).toBeCloseTo(0.115331273e3, 5);
    const b = region2(0.0035, 300);
    expect(b.v).toBeCloseTo(0.394913866e2, 5);
    expect(b.h).toBeCloseTo(0.254991145e4, 4);
  });
  it('gives US-unit steam properties', () => {
    expect(GP.StmPT(14.696)).toBeCloseTo(212.0, 0);
    expect(GP.StmEnth(2400, 1000)).toBeCloseTo(1461.5, 0);
    expect(GP.LiquidWaterEnthalpy(2900, 400)).toBeCloseTo(378.1, 0);
  });
});

describe('combustion and boiler calculations', () => {
  const ult = fuel.fuelGasVolumeToMass(GAS);
  it('converts the gas analysis to an ultimate analysis (3165)', () => {
    expect(units.btulbToKjkg(ult.MassLHVLb) / 1000).toBeCloseTo(48.5, 1);
    expect(ult.Carbon + ult.Hydrogen + ult.Oxygen + ult.Nitrogen + ult.Sulfur).toBeCloseTo(100, 1);
  });
  it('relates excess oxygen and excess air', () => {
    const fg = CB.combustionAnalysis(ult, 2.0, { o2Basis: 1 });
    expect(fg.ExcessAir).toBeGreaterThan(10);
    expect(fg.ExcessAir).toBeLessThan(13);
    expect(CB.flueGasFromExcessAir(ult, fg.ExcessAir).WetO2PctVol).toBeCloseTo(2.0, 4);
  });
  it('inverts the flue gas enthalpy (3305)', () => {
    const fg = CB.combustionAnalysis(ult, 2.0);
    expect(FG.flueGasTemperature(fg, FG.flueGasEnthalpy(fg, 1500))).toBeCloseTo(1500, 3);
  });
  it('computes a gas boiler efficiency by the loss method (3130)', () => {
    const be = BL.boilerEfficiency(ult, { heatInputAtMCR: 6000, cooledWalls: 4 }, { excessO2: 2, tGonl: 270, tAirIn: 90, heatAbsorption: 5200 });
    expect(be.efficiency).toBeGreaterThan(83);
    expect(be.efficiency).toBeLessThan(88);
    expect(be.losses.Lh2).toBeGreaterThan(9);
  });
  it('applies the air heater leakage corrections (3800 - 3904)', () => {
    const tGonl = AH.gasOutNoLeak(90, 250, 7);
    expect(AH.gasOutWithLeak(tGonl, 90, 7)).toBeCloseTo(250, 6);
    expect(AH.leakageFromO2(2.0, 3.0)).toBeCloseTo(5.0, 6);
  });
});

describe('turbine, generator, condenser and heater calculations', () => {
  it('computes enthalpy-drop efficiency and its inverse (2110 / 2140)', () => {
    const h = TB.exhEnthFromEff(2400, 1000, 600, 86);
    const t = GP.StmTempPH(600, h);
    expect(TB.enthalpyDropEff(2400, 1000, 600, t)).toBeCloseTo(86, 1);
  });
  it('gives a used energy end point above the expansion line end point (2200)', () => {
    const u = TB.ueepReheat(138, 640, 3690, 0, 0, 1.0, 3070, { reheatBaseEff: 89, reheatDesFlow: 3690, reheatP: 138, reheatT: 640, annulusArea: 306 });
    expect(u.ueep).toBeGreaterThan(u.elep);
    expect(u.exhaustLoss).toBeGreaterThan(5);
  });
  it('generator losses near 1 % at rating (2520 / 2540)', () => {
    const loss = GN.generatorLosses(700, 434, 60, 823500);
    expect(loss).toBeGreaterThan(5);
    expect(loss).toBeLessThan(11);
    expect(GN.generatorEfficiency(700, GN.mechanicalLosses(823500), loss)).toBeGreaterThan(98.5);
  });
  it('HEI condenser: cleanliness of the predicted state equals the cleanliness used (2690 / 2680)', () => {
    const nv = design().condenser.nv;
    const gpm = 330000;
    const r = CD.condenserPressure(nv, 2900, gpm, 77, 0.85);
    const cf = CD.condenserCleanliness(nv, 77, gpm, 77 + r.rise, r.pInHg, 2900);
    expect(cf).toBeCloseTo(85, 0);
  });
  it('Tsou heater model reproduces its design point (2990)', () => {
    const D = design();
    for (const name of HEATERS) {
      const nv = D.heaters[name].nv;
      const des = FW.heaterDesign(nv);
      const p = FW.heaterPredict(des, { fwFlow: nv.fwFlow, fwInP: nv.fwInP, fwInT: nv.fwInT, stmP: nv.stmInP, stmT: nv.stmInT, drainInFlow: nv.drainInFlow, drainInP: nv.stmInP * 1.3, drainInT: nv.drainOutT + 20 });
      expect(Math.abs(p.fwOutT - units.cToF(D.heaters[name].tOut)), name).toBeLessThan(4);
      expect(Math.abs(p.extrFlow - nv.stmInFlow) / nv.stmInFlow, name).toBeLessThan(0.1);
    }
  });
  it('pump and fan power (4120 / 7402)', () => {
    expect(PU.hydraulicHp(10000, 2000, 56)).toBeCloseTo(10000 * 0.002228 * 2000 * 56 * 0.00181818, 6);
    expect(FA.fanPowerOutput(20, 500000)).toBeCloseTo((20 * 500000) / 6356, 6);
  });
  it('heat rate relations (5010 / 5030 / 5200)', () => {
    expect(HR.netUnitHeatRate(6000, 650)).toBeCloseTo(9230.8, 1);
    expect(HR.targetNetHeatRate(9500, 2)).toBeCloseTo(9313.7, 1);
    expect(HR.carnotHeatRate(1000, 77)).toBeGreaterThan(5000);
  });
});

describe('design heat balance (design.js)', () => {
  const D = design();
  it('closes at 700 MW with the fuel of 100 % boiler demand', () => {
    expect(D.cycle.MW).toBeCloseTo(700, 1);
    expect(D.cycle.Qcycle).toBeCloseTo(D.boiler.qAbs, 0);
    expect(D.etaScale).toBeGreaterThan(0.93);
    expect(D.etaScale).toBeLessThan(1.03);
  });
  it('has a realistic cycle', () => {
    expect(D.cycle.tchr / 1.055056).toBeGreaterThan(7300); // Btu/kWh
    expect(D.cycle.tchr / 1.055056).toBeLessThan(8100);
    expect(D.cycle.Pc * 1000).toBeGreaterThan(5);
    expect(D.cycle.Pc * 1000).toBeLessThan(9);
    expect(D.gas.fegt).toBeCloseTo(1180, 0);
    expect(D.gas.tAirOut).toBeCloseTo(315, 0);
  });
});
