import { Controller } from './runtime/Controller.js';
import { median3, vote2oo3 } from '../common/blocks.js';
import { ELEVS } from '../maps/plant.js';

const AIR_MCR = 2247; // t/h
const PURGE_TIME = 300; // s
const LIGHTOFF_TIME = 900; // s
const SEQ = { OFF: 0, STARTING: 1, IN_SERVICE: 2, STOPPING: 3, FAIL: 4 };
const TRAIN = { CLOSED: 0, OPENING: 1, OPEN: 2, TRIPPED: 3 };

/**
 * Burner management system (NFPA 85 style): master fuel trip with first-out, furnace purge,
 * gas fuel train (double block & bleed) and burner elevation light-off sequences.
 */
export class BmsController extends Controller {
  constructor() {
    super('BMS');
  }

  defaultState() {
    const s = super.defaultState();
    s.mft = true;
    s.cause = 15;
    s.purge = { active: false, t: 0, complete: false };
    s.lightoff = 0;
    s.fuelWas = false;
    s.train = { state: TRAIN.TRIPPED, t: 0 };
    s.elev = Object.fromEntries(ELEVS.map((x) => [x, { state: SEQ.OFF, t: 0, ign: false, brn: false }]));
    s.lastMw = 0;
    return s;
  }

  logic() {
    const s = this.state;
    const p = (t) => this.p(t);
    const dt = this.dt;
    const idRun = p('ID_A_RUN') || p('ID_B_RUN');
    const fdRun = p('FD_A_RUN') || p('FD_B_RUN');
    const airPct = (p('AIR_FLOW') / AIR_MCR) * 100;
    const fpA = p('FURN_PRESS_A');
    const fpB = p('FURN_PRESS_B');
    const fpC = p('FURN_PRESS_C');
    const fp = median3(fpA, fpB, fpC);
    const la = p('DRUM_LVL_A');
    const lb = p('DRUM_LVL_B');
    const lc = p('DRUM_LVL_C');
    const lvl = median3(la, lb, lc);
    const hdr = p('GAS_HDR_PRESS');
    const sup = p('GAS_SUPPLY_PRESS');
    const flames = ELEVS.map((x) => p(`FLAME_${x}`));
    const anyFlame = flames.some(Boolean);
    const anyBrnOpen = ELEVS.some((x) => p(`BRN_${x}_OPEN`) || s.elev[x].brn);
    const inService = ELEVS.filter((x) => s.elev[x].state === SEQ.IN_SERVICE);
    const bfpAny = p('BFP_A_RUN') || p('BFP_B_RUN') || p('BFP_C_RUN');
    const dehOk = this.peerOk('DEH');
    const dehTripped = dehOk ? this.peer('DEH', 'TRIPPED') : false;
    const mgtvOpen = p('MGTV_OPEN');

    // ---------------------------------------------------------------- MFT conditions
    const cond = {
      1: this.get('MFT_PB'),
      2: !idRun,
      3: !fdRun,
      4: this.ton('airLow', airPct < 25, 3),
      5: vote2oo3(fpA > 20, fpB > 20, fpC > 20),
      6: vote2oo3(fpA < -25, fpB < -25, fpC < -25),
      7: this.ton('lvlHH', vote2oo3(la > 250, lb > 250, lc > 250), 3),
      8: this.ton('lvlLL', vote2oo3(la < -300, lb < -300, lc < -300), 3),
      9: this.ton('flameLoss', anyBrnOpen && !anyFlame, 5),
      10: this.ton('fuelLoss', s.fuelWas && !anyBrnOpen, 2),
      11: this.rise('dehTrip', dehTripped) && (s.lastFuel ?? 0) > 0.4 * 1620,
      12: this.ton('bfpLoss', s.fuelWas && !bfpAny, 10),
      13: !s.mft && !s.fuelWas && s.lightoff > LIGHTOFF_TIME,
      14: p('BMS_WD_FAIL'),
      16: this.ton('hdrLL', inService.length > 0 && hdr < 120, 2),
      17: this.ton('hdrHH', mgtvOpen && hdr > 4500, 1),
      18: this.ton('supLow', mgtvOpen && sup < 12, 3),
    };
    s.lastMw = p('GEN_MW');
    s.lastFuel = p('FUEL_HEAT');
    if (!s.mft) {
      s.lightoff += dt;
      const first = Object.entries(cond).find(([, v]) => v);
      if (first) this.#trip(Number(first[0]));
    }

    // ---------------------------------------------------------------- purge
    const fuelOff = p('MGTV_CLOSED') && !ELEVS.some((x) => p(`BRN_${x}_OPEN`)) && !ELEVS.some((x) => s.elev[x].ign);
    const pp = {
      PP_FANS: idRun && fdRun,
      PP_AIR: airPct >= 25 && airPct <= 40,
      PP_FUEL_OFF: fuelOff,
      PP_FURN: Math.abs(fp) < 5,
      PP_DRUM: lvl > -250 && lvl < 200,
      PP_NO_TRIP: ![2, 3, 5, 6, 7, 8, 14].some((c) => cond[c]),
    };
    for (const [k, v] of Object.entries(pp)) this.set(k, v);
    const ready = s.mft && Object.values(pp).every(Boolean);
    if (this.get('PURGE_START')) {
      if (ready && !s.purge.complete) s.purge = { active: true, t: 0, complete: false };
      else this.reject('Purge permissives not satisfied');
    }
    if (s.purge.active) {
      if (!ready) s.purge.active = false;
      else {
        s.purge.t += dt;
        if (s.purge.t >= PURGE_TIME) s.purge = { active: false, t: PURGE_TIME, complete: true };
      }
    }
    if (this.get('MFT_RESET')) {
      if (s.mft && s.purge.complete && pp.PP_NO_TRIP) {
        s.mft = false;
        s.cause = 0;
        s.purge = { active: false, t: 0, complete: false };
        s.lightoff = 0;
        s.fuelWas = false;
        s.train = { state: TRAIN.CLOSED, t: 0 };
        this.log.info('MFT reset');
      } else this.reject('MFT reset not permitted - purge not complete');
    }

    // ---------------------------------------------------------------- gas fuel train
    const tr = s.train;
    const trainPerm = !s.mft && sup > 16 && p('MGTV_CLOSED');
    if (this.get('GAS_TRAIN.OPEN')) {
      if (trainPerm && tr.state === TRAIN.CLOSED) s.train = { state: TRAIN.OPENING, t: 0 };
      else this.reject('Gas train open not permitted');
    }
    if (this.get('GAS_TRAIN.CLOSE')) {
      if (!inService.length) s.train = { state: TRAIN.CLOSED, t: 0 };
      else this.reject('Shut down burner elevations before closing the gas train');
    }
    if (s.mft && s.train.state !== TRAIN.TRIPPED) s.train = { state: TRAIN.TRIPPED, t: 0 };
    if (s.train.state === TRAIN.OPENING) {
      s.train.t += dt;
      if (mgtvOpen) s.train.state = TRAIN.OPEN;
      else if (s.train.t > 10) s.train = { state: TRAIN.CLOSED, t: 0 };
    }
    const trainCmd = s.train.state === TRAIN.OPENING || s.train.state === TRAIN.OPEN;
    this.pset('MGTV_CMD', trainCmd);
    this.pset('GAS_VENT_CMD', !trainCmd);
    const trainOpen = s.train.state === TRAIN.OPEN && mgtvOpen && !p('GAS_VENT_OPEN');
    this.set('GAS_TRAIN.STATE', s.train.state);
    this.set('GAS_TRAIN.PERM', trainPerm);
    this.set('GAS_TRAIN.OPENED', trainOpen);

    // ---------------------------------------------------------------- burner elevations
    for (const x of ELEVS) {
      const e = s.elev[x];
      const perm = !s.mft && trainOpen && airPct > 25 && hdr > 150 && hdr < 3000 && Math.abs(fp) < 10;
      this.set(`ELEV_${x}.PERM`, perm);
      if (this.get(`ELEV_${x}.START`)) {
        if (perm && (e.state === SEQ.OFF || e.state === SEQ.FAIL)) Object.assign(e, { state: SEQ.STARTING, t: 0 });
        else this.reject(`Elevation ${x} light-off not permitted`);
      }
      if (this.get(`ELEV_${x}.STOP`)) {
        if (e.state === SEQ.STARTING || e.state === SEQ.IN_SERVICE) Object.assign(e, { state: SEQ.STOPPING, t: 0 });
        else if (e.state === SEQ.FAIL) e.state = SEQ.OFF;
      }
      e.t += dt;
      const flame = p(`FLAME_${x}`);
      switch (e.state) {
        case SEQ.STARTING:
          e.ign = true;
          if (e.t > 6 && !p(`IGN_${x}_FLAME`)) this.#elevFail(x, 'igniter flame not proven');
          else if (p(`IGN_${x}_FLAME`)) e.brn = true;
          if (e.state === SEQ.STARTING && e.brn && flame && e.t > 5) Object.assign(e, { state: SEQ.IN_SERVICE, t: 0 });
          else if (e.state === SEQ.STARTING && e.t > 15) this.#elevFail(x, 'main flame not proven');
          break;
        case SEQ.IN_SERVICE:
          e.brn = true;
          e.ign = e.t < 10;
          if (this.ton(`flame${x}`, !flame, 2)) this.#elevFail(x, 'loss of flame');
          break;
        case SEQ.STOPPING:
          e.brn = false;
          e.ign = false;
          if (e.t > 3) e.state = SEQ.OFF;
          break;
        default:
          e.brn = false;
          e.ign = false;
      }
      if (s.mft) {
        e.brn = false;
        e.ign = false;
        if (e.state !== SEQ.FAIL) e.state = SEQ.OFF;
      }
      this.pset(`IGN_${x}_CMD`, e.ign);
      this.pset(`BRN_${x}_CMD`, e.brn);
      this.set(`ELEV_${x}.STATE`, e.state);
      this.set(`ELEV_${x}.INSERV`, e.state === SEQ.IN_SERVICE);
      this.set(`ELEV_${x}.FAIL`, e.state === SEQ.FAIL);
    }
    const nIn = ELEVS.filter((x) => s.elev[x].state === SEQ.IN_SERVICE).length;
    if (nIn > 0) s.fuelWas = true;

    // ---------------------------------------------------------------- outputs & status
    this.pset('MFT_TRIP', s.mft);
    this.set('MFT', s.mft);
    this.set('MFT_CAUSE', s.cause);
    this.set('PURGE_READY', ready);
    this.set('PURGE_ACTIVE', s.purge.active);
    this.set('PURGE_COMPLETE', s.purge.complete);
    this.set('PURGE_REMAIN', s.purge.complete ? 0 : PURGE_TIME - s.purge.t);
    this.set('LIGHTOFF_REMAIN', s.mft || s.fuelWas ? 0 : Math.max(0, LIGHTOFF_TIME - s.lightoff));
    this.set('FUEL_IN_SERVICE', nIn > 0);
    this.set('ELEV_INSERV', nIn);
    this.set('FIREBALL', anyFlame ? Math.min(100, (p('FUEL_HEAT') / 1620) * 110) : 0);
  }

  #trip(cause) {
    const s = this.state;
    s.mft = true;
    s.cause = cause;
    s.purge = { active: false, t: 0, complete: false };
    s.fuelWas = false;
    for (const x of ELEVS) Object.assign(s.elev[x], { state: SEQ.OFF, ign: false, brn: false });
    this.log.warn(`MASTER FUEL TRIP - cause ${cause}`);
  }

  #elevFail(x, why) {
    Object.assign(this.state.elev[x], { state: SEQ.FAIL, ign: false, brn: false, t: 0 });
    this.log.warn(`Elevation ${x} tripped: ${why}`);
  }

  onBuiltInIC() {
    const s = this.state;
    const fired = ELEVS.some((x) => this.p(`FLAME_${x}`));
    if (fired) {
      s.mft = false;
      s.cause = 0;
      s.fuelWas = true;
      s.train = { state: TRAIN.OPEN, t: 0 };
      for (const x of ELEVS) {
        const on = this.p(`FLAME_${x}`);
        Object.assign(s.elev[x], { state: on ? SEQ.IN_SERVICE : SEQ.OFF, t: 60, ign: false, brn: on });
      }
    }
    s.lastMw = this.p('GEN_MW');
    s.lastFuel = this.p('FUEL_HEAT');
  }
}
