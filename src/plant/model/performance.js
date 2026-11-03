import * as st from '../../common/steam.js';
import { clamp } from '../../common/blocks.js';
import { design, HEATERS, NV_BOILER, SPEC_HUM, toF, toC, toPsia, toKpph } from './design.js';
import { combustion as CB, fluegas as FG, boiler as BL, airheater as AH, turbine as TB, generator as GN, condenser as CD, heatrate as HR, gpsteam as GP } from '../etapro/index.js';
import { DES } from './constants.js';
import { PERF_TAGS } from './performanceTags.js';

export { PERF_TAGS };

/**
 * EtaPRO-style performance monitor: the calculation templates evaluated on the published
 * measurements (with their noise and drift), as a plant performance system reads the DCS.
 * Results are in SI units: %, degC, K, MW, kJ/kWh, mbar.
 */
const D = design();
const TD = D.turbine;
const GD = D.gas;
const P_BAR = 14.696;
const PERIOD = 2; // s
const KJ_PER_BTU = 1.05505585;
const NOX_MG_PER_PPM = 2.054; // NO2 at 0 C, 1 atm
const FWT_CORR = 0.25; // % heat rate per 5 F final feedwater temperature (heat rate correction curve form)
const HTR_IN = { LPH1: 'LPH1_FW_IN_T', LPH2: 'LPH1_FW_OUT_T', LPH3: 'LPH2_FW_OUT_T', LPH4: 'LPH3_FW_OUT_T', HPH6: 'BFP_DISCH_T', HPH7: 'HPH6_FW_OUT_T' };



const zero = Object.fromEntries(PERF_TAGS.map(([t]) => [t, 0]));

export class PerformanceMonitor {
  constructor() {
    this.next = 0;
    this.last = { ...zero };
  }

  /** Recomputes the KPIs every PERIOD seconds of simulation time; returns the latest values. */
  update(t, m, model) {
    if (t < this.next && this.ready) return this.last;
    this.next = t + PERIOD;
    this.ready = true;
    try {
      this.last = { ...zero, ...compute(m, model) };
    } catch {
      this.last = { ...zero };
    }
    return this.last;
  }
}

const bar = (g) => g / 10 + st.P_ATM; // bar(g) -> MPa(a)
const psiaG = (g) => toPsia(bar(g));

function compute(m, model) {
  const r = {};
  const f = model.f;
  const ult = f.ult;
  const firing = m.FUEL_HEAT > 20 && m.GAS_FLOW > 1;
  const online = m.GEN_MW > 20;
  const tAirIn = toF(m.APH_AIR_IN_T);
  const tAirOut = toF(m.APH_AIR_OUT_T);
  const tGasIn = toF(m.ECO_GAS_OUT_T);
  const tGasOut = toF(m.APH_GAS_OUT_T);

  // ---- air heater (3903 leakage from the O2 rise, 3800 / 3810 / 3820 / 3830)
  const leak = firing ? clamp(AH.leakageFromO2(m.O2, m.APH_O2_OUT), 0, 50) : 0;
  const tGonl = AH.gasOutNoLeak(tAirIn, tGasOut, leak);
  if (firing) {
    r.PERF_AH_LEAK = leak;
    r.PERF_AH_X = AH.xRatio(tAirIn, tAirOut, tGasIn, tGasOut, leak);
    r.PERF_AH_GAS_EFF = AH.gasSideEfficiency(tAirIn, tGasIn, tGasOut, leak);
    r.PERF_AH_AIR_EFF = AH.airSideEfficiency(tAirIn, tGasIn, tAirOut);
    r.PERF_AH_TGONL = toC(tGonl);
    // expected no-leak gas outlet at the design gas side efficiency, corrected to the actual air and gas inlet (5182)
    r.PERF_AH_TGONL_EXP = toC(tGasIn - (GD.ahEff / 100) * (tGasIn - tAirIn));
  }

  // ---- combustion and boiler efficiency (3000, 3680, 3130 with 3180 absorption)
  const flows = {
    Wfw: toKpph(m.FW_FLOW / 3.6),
    Wshs: toKpph(m.SH_SPRAY_FLOW / 3.6),
    Wbd: toKpph(m.BLOWDOWN_FLOW / 3.6),
    Wrh: toKpph(Math.max(0, m.STEAM_FLOW - m.HPH7_EXT_FLOW - m.HPH6_EXT_FLOW) / 3.6) * (1 - TD.n2Frac),
    Wrhs: toKpph(m.RH_SPRAY_FLOW / 3.6),
    Pthr: psiaG(m.MS_PRESS), Tthr: toF(m.MS_TEMP), Pfw: psiaG(m.FW_HDR_PRESS), Tfw: toF(m.FW_TEMP), Tshs: toF(m.FW_TEMP),
    Pdr: psiaG(m.DRUM_PRESS), Prh: psiaG(m.HRH_PRESS), Trh: toF(m.HRH_TEMP), Pcrh: psiaG(m.CRH_PRESS), Tcrh: toF(m.CRH_TEMP),
  };
  const qAbs = firing ? BL.boilerHeatAbsorption(flows) : 0; // MMBtu/h
  const fuelHHV = ((m.GAS_FLOW / 3.6) * 2.20462262 * 3600 * ult.MassHHVLb) / 1e6; // MMBtu/h
  r.PERF_FUEL_HHV = fuelHHV / 3.412142;
  r.PERF_BLR_ABS = qAbs / 3.412142;
  if (firing) {
    const fg = CB.combustionAnalysis(ult, m.O2, { specHum: SPEC_HUM, COppm: m.CO, o2Basis: 1 });
    r.PERF_EXCESS_AIR = fg.ExcessAir;
    r.PERF_AFT = toC(FG.adiabaticFlameTemp(ult, fg, { radLoss: f.radLoss ?? 0.2, tAirOut }).tF);
    const nv = { heatInputAtMCR: GD.heatInHHV, cooledWalls: NV_BOILER.cooledWalls, o2Basis: 1, unaccountedLoss: NV_BOILER.unaccountedLoss };
    const meas = { excessO2: m.O2, COppm: m.CO, NOxppm: m.NOX / NOX_MG_PER_PPM, specHum: SPEC_HUM, tGonl, tAirIn, pBar: P_BAR, heatAbsorption: Math.max(qAbs, 1) };
    const be = BL.boilerEfficiency(ult, nv, meas);
    r.PERF_BLR_EFF = be.efficiency;
    r.PERF_L_DRYGAS = be.losses.Ldg;
    r.PERF_L_H2 = be.losses.Lh2;
    r.PERF_L_AIRMOIST = be.losses.Lam;
    r.PERF_L_CO = be.losses.LCO;
    r.PERF_L_RAD = be.losses.Lrad;
    r.PERF_L_UNACC = be.losses.Luac;
    // heat rate corrections for the controllable boiler parameters (5100 / 5110)
    const L = clamp(m.FUEL_HEAT / DES.Q_FUEL, 0.3, 1.1);
    const o2Exp = 2.0 + 2.5 * (1 - L);
    r.PERF_HRC_O2 = HR.excessO2HrCorr(ult, nv, meas, o2Exp, 1);
    if (r.PERF_AH_TGONL_EXP !== undefined) r.PERF_HRC_EGT = HR.egtHrCorr(ult, nv, meas, toF(r.PERF_AH_TGONL_EXP), leak, { minAcet: 140, dewPoint: 110 });
  }

  // ---- turbine (2110, 2340, 2350, 2021, 2400 - 2420)
  const Pthr = psiaG(m.MS_PRESS);
  const Tthr = toF(m.MS_TEMP);
  const Wthr = toKpph(m.STEAM_FLOW / 3.6);
  if (m.STEAM_FLOW > 200) {
    const Pcrh = psiaG(m.CRH_PRESS);
    r.PERF_HP_EFF = TB.enthalpyDropEff(Pthr, Tthr, Pcrh, toF(m.HP_EXH_TEMP));
    r.PERF_HP_EFF_EXP = (100 * TD.etaHp * TB.designHpEff(Wthr, Pthr, Tthr, TD.nvHp)) / TD.hpEffDes;
    r.PERF_IP_EFF = TB.enthalpyDropEff(psiaG(m.HRH_PRESS) * 0.98, toF(m.HRH_TEMP), psiaG(m.CROSS_PRESS), toF(m.CROSS_TEMP));
    r.PERF_IP_EFF_EXP = 100 * TD.etaIp;
    r.PERF_THR_FLOW = (100 * m.STEAM_FLOW) / (TD.Wdes * 3.6);
    r.PERF_THR_P_DEV = TB.throttlePressureDeviation(Pthr, TD.nvHp.throttleP);
    r.PERF_THR_T_DEV = (Tthr - TD.nvHp.throttleT) / 1.8;
    r.PERF_RH_T_DEV = (toF(m.HRH_TEMP) - TD.nvHp.reheatT) / 1.8;
  }

  // ---- heat rates (2100, 5010, 5030, 5200), generator (2520 / 2530 / 2540)
  const mw = m.GEN_MW;
  if (online && firing) {
    const tchr = TB.turbineCycleHeatRate(qAbs, mw); // Btu/kWh
    r.PERF_TCHR = tchr * KJ_PER_BTU;
    r.PERF_GUHR = ((fuelHHV * 1000) / mw) * KJ_PER_BTU;
    r.PERF_NUHR = HR.netUnitHeatRate(fuelHHV, m.NET_MW) * KJ_PER_BTU;
    const mech = GN.mechanicalLosses(DES.MVA * 1000);
    const gl = GN.generatorLosses(mw, m.GEN_MVAR, TD.nvHp.genH2Psig, DES.MVA * 1000);
    r.PERF_GEN_EFF = GN.generatorEfficiency(mw, mech, gl);
    // condenser (2600 duty from the cycle heat balance, 2680, 2690, 2930)
    const gpm = (m.CW_FLOW / 3.6 / 997) * 15850.32;
    const qCond = CD.condenserDuty(mw, tchr, r.PERF_GEN_EFF); // MMBtu/h
    r.PERF_COND_DUTY = qCond / 3.412142;
    const pInHg = (m.COND_PRESS / 10) / 3.386389;
    const nvC = D.condenser.nv;
    r.PERF_COND_CF = CD.condenserCleanliness(nvC, toF(m.CW_IN_T), gpm, toF(m.CW_OUT_T), pInHg, qCond);
    const exp = CD.condenserPressure(nvC, qCond, gpm, toF(m.CW_IN_T), nvC.cleanTarget).pInHg;
    r.PERF_COND_EXP = exp * 3.386389 * 10;
    r.PERF_COND_DEV = m.COND_PRESS - r.PERF_COND_EXP;
    r.PERF_COND_TTD = (CD.terminalTempDiff(toPsia(m.COND_PRESS / 10000), toF(m.CW_OUT_T))) / 1.8;
    // controllable losses: final FW temperature (2800), backpressure (UEEP sensitivity, ~0.9 %/kPa)
    r.PERF_HRC_FWT = HR.fwTempHrCorr(FWT_CORR, toF(m.FW_TEMP), toF(D.cycle.t7));
    r.PERF_HRC_COND = 0.9 * ((m.COND_PRESS - r.PERF_COND_EXP) / 10);
    r.PERF_HRC_TOTAL = (r.PERF_HRC_O2 ?? 0) + (r.PERF_HRC_EGT ?? 0) + r.PERF_HRC_FWT + r.PERF_HRC_COND;
    r.PERF_NUHR_TGT = HR.targetNetHeatRate(r.PERF_NUHR, r.PERF_HRC_TOTAL);
    r.PERF_CARNOT_HR = HR.carnotHeatRate(Tthr, toF(m.CW_IN_T)) * KJ_PER_BTU;
  }

  // ---- feedwater heaters (2930 TTD at the extraction flange, drain cooler approach)
  for (const h of HEATERS) {
    if (m[`${h}_EXT_FLOW`] < 1) continue;
    const pFl = toPsia(m[`${h}_EXT_P`] / 10);
    r[`PERF_${h}_TTD`] = (GP.StmPT(pFl) - toF(m[`${h}_FW_OUT_T`])) / 1.8;
    r[`PERF_${h}_DCA`] = m[`${h}_DRN_T`] - m[HTR_IN[h]];
  }
  for (const [k, v] of Object.entries(r)) if (!Number.isFinite(v)) r[k] = 0;

  return r;
}
