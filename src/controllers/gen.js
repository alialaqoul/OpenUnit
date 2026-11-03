import { Controller } from './runtime/Controller.js';
import { PID_MODE } from '../common/tags.js';
import { clamp } from '../common/blocks.js';

const SYNC = { OFF: 0, WAIT: 1, MATCH: 2, CLOSING: 3, DONE: 4 };
const SLIP_TARGET = 0.08; // Hz, generator slightly faster than grid
const I_RATED = 21.6; // kA

/** Generator protection (86G), AVR with limiters, field & generator breakers, auto synchroniser. */
export class GenController extends Controller {
  constructor() {
    super('GEN');
    this.onoff('FCB', { cmd: 'FCB_CMD', opened: 'FCB_CLOSED', resetOnLoss: true });
    this.onoff('GCB', { cmd: 'GCB_CMD', opened: 'GCB_CLOSED', resetOnLoss: true });
    this.loop('AVR', { action: 'reverse', spTrack: false, refDt: 0.15 });
  }

  defaultState() {
    const s = super.defaultState();
    Object.assign(s, { lock: false, cause: 0, sync: SYNC.OFF, syncT: 0 });
    return s;
  }

  logic() {
    const s = this.state;
    const p = (t) => this.p(t);
    const dt = this.dt;
    const n = p('SPEED_B');
    const f = Math.max(1, n / 60);
    const vPu = p('GEN_KV') / 22;
    const gPu = p('GRID_KV') / 400;
    const vhz = vPu / (f / 60);
    const gcb = p('GCB_CLOSED');
    const fcb = p('FCB_CLOSED');
    const mw = p('GEN_MW');
    const slip = p('SYNC_SLIP');
    const phase = p('SYNC_PHASE');
    const ifPu = p('FIELD_AMPS') / 2400;
    const dehOk = this.peerOk('DEH');
    const dehLatched = dehOk && this.peer('DEH', 'LATCHED');
    const dehTripped = dehOk ? this.peer('DEH', 'TRIPPED') : true;
    const dehSpeedMode = dehOk && this.peer('DEH', 'MODE') === 1;
    this.set('V_PU', vPu);
    this.set('GRID_V_PU', gPu);
    this.set('VHZ', vhz);
    const dV = (vPu - gPu) * 100;
    this.set('DV_PCT', dV);

    // ---------------------------------------------------------------- protection (86G lockout)
    const cond = {
      1: this.get('TRIP_86'),
      2: p('GEN_DIFF_RELAY'),
      3: this.ton('oos', gcb && (p('OUT_OF_STEP') || ifPu < 0.15), 0.5),
      4: this.ton('revP', gcb && mw < -4, dehTripped ? 2 : 5),
      5: this.ton('ov', fcb && vPu > 1.18, 5) || vPu > 1.4,
      6: this.ton('freq', gcb && (f < 57.5 || f > 61.8), 5),
      7: this.ton('vhz', fcb && vhz > 1.12, 5),
      8: p('STATOR_TEMP') > 125,
      9: this.ton('oc', p('GEN_KA') > 1.3 * I_RATED, 10),
      10: this.ton('lfp', dehTripped && gcb && mw < 10, 20),
    };
    this.set('REV_POWER', gcb && mw < -2);
    if (!s.lock) {
      const first = Object.entries(cond).find(([, v]) => v);
      if (first) {
        s.lock = true;
        s.cause = Number(first[0]);
        s.sync = SYNC.OFF;
        this.log.warn(`GENERATOR TRIP 86G - cause ${s.cause}`);
      }
    }
    if (this.get('RESET_86')) {
      const active = [2, 3, 5, 7, 8].some((c) => cond[c]);
      if (s.lock && !active) {
        s.lock = false;
        s.cause = 0;
      } else if (active) this.reject('86G reset not permitted - fault still present');
    }

    // ---------------------------------------------------------------- breakers
    const syncCheck = !gcb && fcb && Math.abs(slip) < 0.2 && Math.abs(phase) < 15 && Math.abs(dV) < 5;
    this.set('SYNC_CHECK', syncCheck);
    this.devices.FCB.run({ permit: n > 3420 && !s.lock && dehLatched, ilkClose: s.lock || n < 3000 });
    let autoClose = false;

    // ---------------------------------------------------------------- auto synchroniser
    if (this.get('SYNC_ON') && !gcb) s.sync = SYNC.WAIT;
    if (this.get('SYNC_OFF')) s.sync = SYNC.OFF;
    let adj = 0;
    const avr = this.loops.AVR;
    const syncPerm = dehLatched && dehSpeedMode && n > 3540 && fcb && avr.get('MODE') !== PID_MODE.MAN && !s.lock && !gcb;
    switch (s.sync) {
      case SYNC.WAIT:
        if (syncPerm) s.sync = SYNC.MATCH;
        break;
      case SYNC.MATCH: {
        if (!syncPerm) {
          s.sync = SYNC.WAIT;
          break;
        }
        adj = clamp((SLIP_TARGET - slip) * 60 * 0.6, -4, 4);
        const vTarget = gPu * 22 * 1.005;
        const cur = avr.get('SP');
        avr.setSP(cur + clamp(vTarget - cur, -0.2 * dt, 0.2 * dt));
        const slipOk = slip > 0.02 && slip < 0.2;
        const vOk = Math.abs(dV) < 2;
        const advance = 360 * slip * 0.08;
        const phaseOk = phase < -advance + 4 && phase > -advance - 6;
        if (slipOk && vOk && phaseOk) {
          autoClose = true;
          s.sync = SYNC.CLOSING;
          s.syncT = 0;
        }
        break;
      }
      case SYNC.CLOSING:
        autoClose = true;
        s.syncT += dt;
        if (gcb) {
          s.sync = SYNC.DONE;
          s.syncT = 0;
        } else if (s.syncT > 2) s.sync = SYNC.MATCH;
        break;
      case SYNC.DONE:
        s.syncT += dt;
        if (s.syncT > 5) s.sync = SYNC.OFF;
        break;
      default:
        break;
    }
    if (gcb && s.sync !== SYNC.DONE && s.sync !== SYNC.OFF) s.sync = SYNC.DONE;
    this.set('SYNC_STATE', s.sync);
    this.peerSet('DEH', 'SYNC_ADJ', adj);
    this.peerSet('DEH', 'SYNC_ACTIVE', s.sync === SYNC.MATCH || s.sync === SYNC.CLOSING ? 1 : 0);

    const gcbDev = this.devices.GCB;
    if (autoClose && !gcbDev.cmd) gcbDev.command(true);
    gcbDev.run({ permit: (syncCheck || gcb) && !s.lock && dehLatched, ilkClose: s.lock });

    // ---------------------------------------------------------------- AVR & limiters
    const mode = this.get('EXC_MODE');
    if (gcb && avr.get('MODE') !== PID_MODE.MAN && mode > 0) {
      const qTarget = mode === 1 ? this.get('MVAR_SP') : mw * Math.tan(Math.acos(clamp(this.get('PF_SP'), 0.7, 1)));
      const err = qTarget - p('GEN_MVAR');
      avr.setSP(clamp(avr.get('SP') + clamp(err / 300, -1, 1) * 0.05 * dt, 20, 24.2));
    }
    if (!gcb && avr.get('MODE') !== PID_MODE.MAN) {
      // V/Hz limiter while off line
      avr.setSP(Math.min(avr.get('SP'), 22 * 1.05 * (f / 60)));
    }
    const oel = ifPu > 2.1;
    const uel = gcb && p('GEN_MVAR') < -0.3 * Math.max(0, mw) - 120;
    this.set('OEL_ACTIVE', oel);
    this.set('UEL_ACTIVE', uel);
    // Load rejection: force the field down to no-load excitation so terminal voltage stays near rated.
    if (this.fall('gcbOpen', gcb) && avr.get('MODE') !== PID_MODE.MAN) {
      avr.setOut(1.0);
      avr.setSP(22);
      avr.set('MODE', PID_MODE.AUTO);
      avr.wasTracking = true;
      this.set('EXC_MODE', 0);
    }
    const exc = avr.run({
      pv: p('GEN_KV'),
      track: fcb ? null : 0,
      outHi: oel ? ifPu : 2.3,
      outLo: uel ? ifPu + 0.005 : 0,
    });
    this.pset('EXC_DMD', exc);

    if (s.lock) {
      this.devices.FCB.command(false);
      gcbDev.command(false);
    }
    this.set('LOCKOUT_86', s.lock);
    this.set('TRIP_CAUSE', s.cause);
  }

  onBuiltInIC() {
    const avr = this.loops.AVR;
    const fcb = this.p('FCB_CLOSED');
    avr.setOut(this.p('FIELD_AMPS') / 2400);
    avr.setSP(fcb ? Math.round(this.p('GEN_KV') * 100) / 100 : 22);
    avr.setMode(fcb ? PID_MODE.AUTO : PID_MODE.MAN);
    if (!fcb) avr.setOut(0);
    this.set('FCB.MODE', PID_MODE.MAN);
    this.set('GCB.MODE', PID_MODE.MAN);
  }
}
