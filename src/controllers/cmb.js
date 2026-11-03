import { Controller } from './runtime/Controller.js';
import { PID_MODE } from '../common/tags.js';
import { median3, clamp, fgen } from '../common/blocks.js';

const GAS_LHV = 49; // MJ/kg design value used by the controls
const Q_MCR = 1620; // MW fuel heat (LHV) at 100 % boiler demand - EtaPRO design heat balance
const GAS_MCR = (Q_MCR / GAS_LHV) * 3.6; // t/h at 100 % boiler demand (~119 t/h)
const AIR_MCR = 2247; // t/h at 100 % boiler demand
const STOICH = 17.15; // kg air / kg gas
const ELEV_CAP = 0.3 * GAS_MCR; // t/h per elevation in service
const MCR_STEAM = 2149;

const airCurve = fgen([
  [0, 30],
  [30, 38],
  [60, 64],
  [100, 100],
  [110, 110],
]);
const o2Program = fgen([
  [0, 5.0],
  [30, 4.0],
  [60, 2.6],
  [100, 2.0],
]);

/** Combustion control: gas fuel master, air flow with O2 trim, cross-limiting, furnace draft, fans. */
export class CmbController extends Controller {
  constructor() {
    super('CMB');
    for (const f of ['APH_A', 'APH_B', 'ID_A', 'ID_B', 'FD_A', 'FD_B']) this.motor(f);
    this.loop('FIC_GAS', { action: 'reverse' });
    this.loop('FIC_AIR', { action: 'reverse' });
    this.loop('AIC_O2', { action: 'reverse', spTrack: false });
    this.loop('PIC_FURN', { action: 'direct', spTrack: false });
    for (const s of ['SC_FDA', 'SC_FDB', 'SC_IDA', 'SC_IDB']) this.station(s);
  }

  logic() {
    const d = this.devices;
    const L = this.loops;
    const S = this.stations;
    const bmsOk = this.peerOk('BMS');
    const mft = bmsOk ? this.peer('BMS', 'MFT') : true;
    const elevIn = bmsOk ? this.peer('BMS', 'ELEV_INSERV') : 0;
    const trainOpen = bmsOk && this.peer('BMS', 'GAS_TRAIN.OPENED');

    // ---- fans (start sequence ID -> FD, protective interlocks)
    const aph = this.p('APH_A_RUN') || this.p('APH_B_RUN');
    d.APH_A.run({});
    d.APH_B.run({});
    for (const x of ['A', 'B']) {
      d[`ID_${x}`].run({ permit: aph && S[`SC_ID${x}`].get('OUT') <= 5 });
    }
    const idAny = this.p('ID_A_RUN') || this.p('ID_B_RUN');
    const fdBoth = this.p('FD_A_RUN') && this.p('FD_B_RUN');
    for (const x of ['A', 'B']) {
      // Losing an ID fan stops its paired FD fan when both FD fans are running
      if (this.rise(`idTrip${x}`, this.p(`ID_${x}_TRIP`)) && fdBoth) d[`FD_${x}`].command(false);
      d[`FD_${x}`].run({ permit: idAny && S[`SC_FD${x}`].get('OUT') <= 5, ilk: !idAny });
    }

    // ---- boiler demand from CCS boiler master
    const ccsOk = this.writerOk('CCS');
    if (ccsOk) this.state.latch.blr = this.get('BLR_DMD_REM');
    const blr = clamp(this.state.latch.blr ?? 0, 0, 115);
    this.set('BLR_DMD', blr);

    // ---- fuel master with cross-limiting
    const gasFlow = this.p('GAS_FLOW');
    const air = this.p('AIR_FLOW');
    const capacity = elevIn * ELEV_CAP;
    const gasByAir = air / (STOICH * 1.07);
    const gasRaw = (blr / 100) * GAS_MCR;
    const gasDmd = Math.max(0, Math.min(gasRaw, gasByAir, capacity));
    this.set('GAS_DMD', gasDmd);
    this.set('GAS_CAPACITY', capacity);
    this.set('CROSS_LIMIT', elevIn > 0 && gasRaw > gasByAir + 2);
    this.set('FUEL_HEAT_EST', (gasFlow / 3.6) * GAS_LHV);
    const hdr = this.p('GAS_HDR_PRESS');
    const gfcv = this.p('GFCV_FB');
    let fuelTrack = null;
    if (mft || !trainOpen) fuelTrack = 0;
    else if (elevIn === 0) fuelTrack = this.get('LIGHTOFF_POS');
    // Fuel runback kicker: losing an FD or ID fan at load cuts the gas valve at once, before air falls.
    const fansNow = ['FD_A', 'FD_B', 'ID_A', 'ID_B'].filter((f) => this.p(`${f}_RUN`)).length;
    const fanLost = fansNow < (this.state.latch.fans ?? fansNow) && gasFlow > 0.55 * GAS_MCR;
    this.state.latch.fans = fansNow;
    if (fanLost && fuelTrack === null) {
      fuelTrack = this.get('FIC_GAS.OUT') * 0.6;
      this.log.warn('Fan trip at load - fuel runback kicker');
    }
    const fic = L.FIC_GAS;
    const gasOut = fic.run({
      pv: gasFlow,
      csp: gasDmd,
      track: fuelTrack,
      outLo: elevIn > 0 ? this.get('MIN_FIRE_POS') : 0,
      outHi: hdr > 3600 ? gfcv : 100,
    });
    this.pset('GFCV_DMD', gasOut);
    this.set('FM_AUTO', fic.mode === PID_MODE.CAS && elevIn > 0);

    // ---- air flow with O2 trim
    const steamPct = (this.p('STEAM_FLOW') / MCR_STEAM) * 100;
    const o2 = L.AIC_O2;
    if (o2.get('MODE') !== PID_MODE.MAN) o2.setSP(o2Program(steamPct) + this.get('O2_BIAS'));
    this.set('O2_SP_PROG', o2Program(steamPct));
    const airCas = L.FIC_AIR.get('MODE') === PID_MODE.CAS;
    const trim = o2.run({ pv: this.p('O2'), track: mft || elevIn === 0 || blr < 20 || !airCas ? 100 : null });
    const airMinFuel = gasFlow * STOICH * 1.1;
    const airDmd = Math.max((airCurve(blr) / 100) * AIR_MCR * (trim / 100), airMinFuel, this.get('PURGE_AIR'));
    this.set('AIR_DMD', airDmd);
    const fdRun = ['A', 'B'].filter((x) => this.p(`FD_${x}_RUN`));
    const fdAuto = fdRun.filter((x) => S[`SC_FD${x}`].get('MODE') === PID_MODE.AUTO);
    const fdAvg = fdRun.length ? fdRun.reduce((a, x) => a + S[`SC_FD${x}`].get('OUT'), 0) / fdRun.length : 0;
    const fdMaster = L.FIC_AIR.run({ pv: air, csp: airDmd, track: fdAuto.length ? null : fdAvg });
    for (const x of ['A', 'B']) {
      const run = this.p(`FD_${x}_RUN`);
      this.pset(`FD_${x}_PITCH_DMD`, S[`SC_FD${x}`].run({ auto: fdMaster, fb: this.p(`FD_${x}_PITCH_FB`), forceMan: !run, track: run ? null : 0, rate: 4 }));
    }
    this.set('AIR_AUTO', airCas && fdAuto.length > 0);

    // ---- furnace pressure (ID master) with FD feed-forward and MFT kicker
    const fp = median3(this.p('FURN_PRESS_A'), this.p('FURN_PRESS_B'), this.p('FURN_PRESS_C'));
    this.set('FURN_PRESS_SEL', fp);
    if (this.rise('mftKick', mft)) this.state.timers.kick = 0;
    const kicking = mft && this.timerValue('kick') < 10;
    this.ton('kick', mft, 10);
    const idRun = ['A', 'B'].filter((x) => this.p(`ID_${x}_RUN`));
    const idAuto = idRun.filter((x) => S[`SC_ID${x}`].get('MODE') === PID_MODE.AUTO);
    const idAvg = idRun.length ? idRun.reduce((a, x) => a + S[`SC_ID${x}`].get('OUT'), 0) / idRun.length : 0;
    const ff = 0.25 * (fdMaster - (this.state.latch.fdRef ?? fdMaster)) - (kicking ? 12 : 0);
    if (this.resync || !idAuto.length) this.state.latch.fdRef = fdMaster;
    this.state.latch.fdRef += (fdMaster - this.state.latch.fdRef) * Math.min(1, this.dt / 60);
    const idMaster = L.PIC_FURN.run({ pv: fp, ff, track: idAuto.length ? null : idAvg });
    for (const x of ['A', 'B']) {
      const run = this.p(`ID_${x}_RUN`);
      this.pset(`ID_${x}_VANE_DMD`, S[`SC_ID${x}`].run({ auto: idMaster, fb: this.p(`ID_${x}_VANE_FB`), forceMan: !run, track: run ? null : 0, rate: 6 }));
    }
    this.set('FURN_AUTO', L.PIC_FURN.auto && idAuto.length > 0);

    this.set('RB_FAN', (idRun.length < 2 || fdRun.length < 2) && steamPct > 55 && this.p('GCB_CLOSED'));
  }

  onBuiltInIC(id) {
    const L = this.loops;
    const S = this.stations;
    this.state.latch.blr = (this.p('FUEL_HEAT') / Q_MCR) * 100;
    for (const x of ['A', 'B']) {
      S[`SC_FD${x}`].setOut(this.p(`FD_${x}_PITCH_FB`));
      S[`SC_ID${x}`].setOut(this.p(`ID_${x}_VANE_FB`));
      const fdAuto = this.p(`FD_${x}_RUN`) ? PID_MODE.AUTO : PID_MODE.MAN;
      const idAuto = this.p(`ID_${x}_RUN`) ? PID_MODE.AUTO : PID_MODE.MAN;
      S[`SC_FD${x}`].setMode(fdAuto);
      S[`SC_ID${x}`].setMode(idAuto);
      this.state.stMode[`SC_FD${x}`] = fdAuto;
      this.state.stMode[`SC_ID${x}`] = idAuto;
    }
    L.FIC_GAS.setOut(this.p('GFCV_FB'));
    L.FIC_AIR.setOut((this.p('FD_A_PITCH_FB') + this.p('FD_B_PITCH_FB')) / 2);
    L.PIC_FURN.setOut((this.p('ID_A_VANE_FB') + this.p('ID_B_VANE_FB')) / 2);
    L.AIC_O2.setOut(100);
    const onLoad = id >= 4;
    const fired = id >= 2;
    L.FIC_GAS.setMode(onLoad ? PID_MODE.CAS : PID_MODE.MAN);
    L.FIC_AIR.setMode(fired ? PID_MODE.CAS : PID_MODE.MAN);
    L.AIC_O2.setMode(onLoad ? PID_MODE.AUTO : PID_MODE.MAN);
    L.PIC_FURN.setMode(fired ? PID_MODE.AUTO : PID_MODE.MAN);
    this.state.latch.fdRef = L.FIC_AIR.get('OUT');
  }
}
