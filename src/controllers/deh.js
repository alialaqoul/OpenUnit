import { Controller } from './runtime/Controller.js';
import { PID_MODE } from '../common/tags.js';
import { median3, clamp } from '../common/blocks.js';
import { BEARINGS } from '../maps/plant.js';

const RPM = 3600; // 2-pole generator on a 60 Hz grid
const CRITICAL_BANDS = [
  [1140, 1380],
  [1860, 2100],
  [2160, 2400],
];
const MODE = { TRIPPED: 0, SPEED: 1, LOAD: 2, REMOTE: 3, PRESSURE: 4 };

/** Digital electro-hydraulic turbine control: protection, speed/load/pressure control, OPC, bypass. */
export class DehController extends Controller {
  constructor() {
    super('DEH');
    this.loop('SPD_CTRL', { action: 'reverse', spTrack: false });
    this.loop('LOAD_CTRL', { action: 'reverse', spTrack: false });
    this.loop('PIC_TPT', { action: 'direct', spTrack: false });
    this.loop('PIC_HPB', { action: 'direct', spTrack: false });
    this.loop('PIC_LPB', { action: 'direct', spTrack: false });
    this.onoff('SH_VENT', { cmd: 'SH_VENT_CMD', opened: 'SH_VENT_OPEN' });
  }

  defaultState() {
    const s = super.defaultState();
    Object.assign(s, { latched: false, cause: 13, go: false, spdRef: 0, loadRef: 0, loadGo: false, opcT: 0, opc: false, hpbSp: 10, lpbSp: 9 });
    return s;
  }

  speed() {
    return median3(this.p('SPEED_A'), this.p('SPEED_B'), this.p('SPEED_C'));
  }

  tripConditions(n) {
    const p = (t) => this.p(t);
    const vib = Math.max(...BEARINGS.map((b) => p(`VIB_${b}`)));
    const brg = Math.max(...BEARINGS.map((b) => p(`BRG_T_${b}`)));
    const bmsOk = this.peerOk('BMS');
    const genOk = this.peerOk('GEN');
    this.set('MAX_VIB', vib);
    return {
      1: this.get('TRIP_PB'),
      2: [p('SPEED_A'), p('SPEED_B'), p('SPEED_C')].filter((v) => v > RPM * 1.1).length >= 2,
      3: p('MECH_OVERSPEED'),
      4: p('COND_PRESS') > 300,
      5: p('LO_PRESS') < 0.6,
      6: this.ton('vibHH', vib > 250 && n > 200, 2),
      7: Math.abs(p('AXIAL_DISP')) > 1.0,
      8: this.ton('hpxHH', p('HP_EXH_TEMP') > 450, 60),
      9: bmsOk && this.peer('BMS', 'MFT'),
      10: genOk && this.peer('GEN', 'LOCKOUT_86'),
      11: brg > 115,
      12: p('DEH_WD_FAIL'),
    };
  }

  logic() {
    const s = this.state;
    const p = (t) => this.p(t);
    const dt = this.dt;
    const n = this.speed();
    this.set('SPEED', n);
    const gcb = p('GCB_CLOSED');
    const mw = p('GEN_MW');
    const pms = p('MS_PRESS');
    const L = this.loops;

    // ---------------------------------------------------------------- protection
    const trips = this.tripConditions(n);
    if (s.latched) {
      const first = Object.entries(trips).find(([, v]) => v);
      if (first) {
        s.latched = false;
        s.cause = Number(first[0]);
        s.go = false;
        this.log.warn(`TURBINE TRIP - cause ${s.cause}`);
      }
    }
    const tripActive = Object.entries(trips).some(([k, v]) => v && k !== '1');
    const latchPerm = !s.latched && !tripActive && p('COND_PRESS') < 200 && p('LO_PRESS') > 1.0 && n < RPM * 1.033 && !gcb;
    this.set('LATCH_PERM', latchPerm);
    if (this.get('RESET')) {
      if (latchPerm) {
        s.latched = true;
        s.cause = 0;
        s.spdRef = n;
        s.go = false;
        this.set('SPD_TARGET', Math.round(n));
        L.SPD_CTRL.setOut(0);
        L.SPD_CTRL.wasTracking = true;
        this.log.info('Turbine latched');
      } else this.reject('Turbine latch not permitted');
    }
    this.pset('TURB_TRIP', !s.latched);
    this.pset('MSV_CMD', s.latched);
    this.pset('RSV_CMD', s.latched);

    // ---------------------------------------------------------------- mode
    const ccsOk = this.writerOk('CCS');
    const req = ccsOk ? this.get('CCS_REQ') : 0;
    const remoteSel = this.get('MODE_SEL') === 1;
    let mode = MODE.TRIPPED;
    if (s.latched) {
      if (!gcb) mode = MODE.SPEED;
      else if (remoteSel && req === 1) mode = MODE.REMOTE;
      else if (remoteSel && req === 2) mode = MODE.PRESSURE;
      else mode = MODE.LOAD;
    }
    const gcbRise = this.rise('gcb', gcb);
    const gcbFall = this.fall('gcbF', gcb);
    if (gcbRise && s.latched) {
      // Initial load pick-up after synchronising
      s.loadRef = Math.max(35, mw);
      this.set('LOAD_TARGET', Math.max(35, Math.round(mw)));
      s.loadGo = false;
    }
    if (gcbFall && s.latched) {
      // Load rejection: fall back to speed control at synchronous speed
      if ((s.lastMw ?? 0) > 210) s.opcT = 3;
      // ...and let the HP/LP bypass hold the boiler at its present pressure.
      if (L.PIC_HPB.get('MODE') !== PID_MODE.MAN) {
        this.set('HPB_MODE', 0);
        this.set('HPB_TARGET', Math.round(pms));
        s.hpbSp = pms;
        s.lpbSp = Math.max(9, p('HRH_PRESS'));
      }
      s.spdRef = RPM;
      this.set('SPD_TARGET', RPM);
      s.go = false;
    }
    s.lastMw = mw;

    // ---------------------------------------------------------------- OPC
    s.opcT = Math.max(0, s.opcT - dt);
    if (n > RPM * 1.03) s.opc = true;
    else if (n < RPM * 1.01 && s.opcT <= 0) s.opc = false;
    const opc = s.latched && (s.opc || s.opcT > 0);
    this.set('OPC_ACTIVE', opc);

    // ---------------------------------------------------------------- turbine stress evaluator
    const hpMetal = p('HP_METAL_TEMP');
    const flowing = p('GV_POS') > 1 && p('MSV_OPEN');
    const stressHp = flowing ? ((p('MS_TEMP') - 40 - hpMetal) / 110) * 100 : 0;
    const stressIp = flowing ? ((p('HRH_TEMP') - 20 - p('IP_METAL_TEMP')) / 120) * 100 : 0;
    this.set('STRESS_HP', clamp(stressHp, -100, 200));
    this.set('STRESS_IP', clamp(stressIp, -100, 200));
    const stressFactor = clamp((110 - Math.max(stressHp, stressIp)) / 30, 0.2, 1);
    this.set('START_CLASS', hpMetal < 200 ? 0 : hpMetal < 350 ? 1 : hpMetal < 450 ? 2 : 3);

    // ---------------------------------------------------------------- speed control
    if (this.get('GO')) {
      if (mode === MODE.SPEED) s.go = true;
      else s.loadGo = true;
    }
    if (this.get('HOLD')) {
      s.go = false;
      s.loadGo = false;
    }
    const inBand = (v) => CRITICAL_BANDS.some(([a, b]) => v > a && v < b);
    const target = clamp(this.get('SPD_TARGET'), 0, RPM * 1.02);
    if (mode === MODE.SPEED) {
      let rate = (this.get('SPD_RATE') / 60) * stressFactor;
      const banded = inBand(s.spdRef);
      if (banded) {
        rate = Math.max(rate, 300 / 60);
        if (!s.go && Math.abs(target - s.spdRef) > 1) s.go = true; // never hold inside a critical band
      }
      if (s.go) {
        const d = target - s.spdRef;
        s.spdRef += clamp(d, -rate * dt, rate * dt);
        if (Math.abs(target - s.spdRef) < 0.5) s.go = false;
      }
      const genOk = this.writerOk('GEN');
      if (genOk && this.get('SYNC_ACTIVE') && s.spdRef >= RPM * 0.983) {
        s.spdRef = clamp(s.spdRef + this.get('SYNC_ADJ') * dt, RPM * 0.983, RPM * 1.02);
        this.set('SPD_TARGET', Math.round(s.spdRef));
      }
    } else {
      s.spdRef = n;
      s.go = false;
    }
    this.set('CRIT_ZONE', mode === MODE.SPEED && inBand(n));
    this.set('SPEED_REF', s.spdRef);
    this.set('RAMP_ACTIVE', s.go || s.loadGo);

    // ---------------------------------------------------------------- load / pressure control
    const df = p('GRID_FREQ') - 60;
    const dfDb = Math.abs(df) > 0.015 ? df - Math.sign(df) * 0.015 : 0;
    const droop = Math.max(1, this.get('DROOP')) / 100;
    const fcorr = this.get('FREQ_ON') && gcb ? clamp((-dfDb / 60 / droop) * 700, -70, 70) : 0;
    this.set('FREQ_CORR', fcorr);
    if (mode === MODE.REMOTE) {
      s.loadRef = this.get('LOAD_REF_REM');
      this.set('LOAD_TARGET', Math.round(s.loadRef));
    } else if (mode === MODE.LOAD) {
      const tgt = clamp(this.get('LOAD_TARGET'), 0, 720);
      if (s.loadGo) {
        const r = (this.get('LOAD_RATE') / 60) * stressFactor * dt;
        s.loadRef += clamp(tgt - s.loadRef, -r, r);
        if (Math.abs(tgt - s.loadRef) < 0.05) s.loadGo = false;
      }
    } else if (mode !== MODE.PRESSURE) {
      s.loadRef = Math.max(0, mw);
      s.loadGo = false;
    } else {
      s.loadRef = mw;
    }
    this.set('LOAD_REF', s.loadRef);

    // Throttle pressure limiter
    const tpl = mode === MODE.LOAD || mode === MODE.REMOTE ? pms < this.get('TPL_SP') : false;
    this.set('TPL_ACTIVE', tpl);
    const gvPos = p('GV_POS');
    let gvHi = this.get('VPL');
    if (tpl) gvHi = Math.min(gvHi, Math.max(0, gvPos - 0.5));

    let gv = 0;
    const pf0 = this.state.latch.pFilt ?? pms;
    this.state.latch.pFilt = pf0 + (pms - pf0) * Math.min(1, dt / 30);
    if (!s.latched || opc) {
      for (const l of [L.SPD_CTRL, L.LOAD_CTRL, L.PIC_TPT]) l.run({ pv: l === L.SPD_CTRL ? n : l === L.LOAD_CTRL ? mw : pms, track: 0 });
      gv = 0;
    } else if (mode === MODE.SPEED) {
      L.SPD_CTRL.setSP(s.spdRef);
      gv = L.SPD_CTRL.run({ pv: n, outHi: gvHi });
      L.LOAD_CTRL.run({ pv: mw, track: gv });
      L.PIC_TPT.run({ pv: pms, track: gv });
    } else if (mode === MODE.PRESSURE) {
      L.PIC_TPT.setSP(this.get('PRESS_SP_REM'));
      gv = L.PIC_TPT.run({ pv: pms, outHi: gvHi });
      L.SPD_CTRL.run({ pv: n, track: gv });
      L.LOAD_CTRL.run({ pv: mw, track: gv });
    } else {
      const sp = s.loadRef + fcorr;
      L.LOAD_CTRL.setSP(sp);
      // Feed-forward: valve area needed for the demanded load at the (slowly filtered) throttle pressure
      const pf = this.state.latch.pFilt ?? pms;
      const ff = clamp((sp / 700) * 90 * (168 / Math.max(20, pf + 1)), 0, 100);
      gv = L.LOAD_CTRL.run({ pv: mw, ff, outHi: gvHi });
      L.SPD_CTRL.run({ pv: n, track: gv });
      L.PIC_TPT.run({ pv: pms, track: gv });
    }
    this.state.latch.gv = gv;
    this.set('GV_DEMAND', gv);
    this.pset('GV_DMD', gv);
    // Valve management: intercept valves share the flow demand at low load so that the
    // reheater (held up by the LP bypass) cannot over-drive the IP turbine; fully open above ~67 %.
    this.pset('ICV_DMD', s.latched && !opc ? clamp(gv * 1.5, 0, 100) : 0);

    // ---------------------------------------------------------------- HP / LP bypass
    const lpbIlk = p('COND_PRESS') > 300 || p('CW_FLOW') < 15000;
    this.set('LPB_ILK', lpbIlk);
    if (this.fall('latchedF', s.latched) && L.PIC_HPB.get('MODE') !== PID_MODE.MAN) {
      // Turbine trip: hold the boiler at its present pressure through the bypass
      this.set('HPB_MODE', 0);
      this.set('HPB_TARGET', Math.round(pms));
      s.hpbSp = pms;
      s.lpbSp = Math.max(9, p('HRH_PRESS'));
    }
    const hpbPos = p('HPB_POS');
    if (this.ton('hpbClosed', gcb && hpbPos < 2 && mw > 50, 30) && this.get('HPB_MODE') === 0) this.set('HPB_MODE', 1);
    const follow = this.get('HPB_MODE') === 1;
    if (follow) {
      const tgt = pms + 10;
      s.hpbSp = tgt < s.hpbSp ? tgt : Math.min(tgt, s.hpbSp + (5 / 60) * dt);
      const lt = p('HRH_PRESS') + 3;
      s.lpbSp = lt < s.lpbSp ? lt : Math.min(lt, s.lpbSp + (3 / 60) * dt);
    } else {
      const r = (this.get('HPB_RAMP') / 60) * dt;
      s.hpbSp += clamp(this.get('HPB_TARGET') - s.hpbSp, -r, r);
      if (L.PIC_LPB.get('MODE') !== PID_MODE.MAN && !gcb) s.lpbSp = 9;
    }
    if (L.PIC_HPB.get('MODE') !== PID_MODE.MAN) L.PIC_HPB.setSP(s.hpbSp);
    else s.hpbSp = pms;
    if (L.PIC_LPB.get('MODE') !== PID_MODE.MAN) L.PIC_LPB.setSP(s.lpbSp);
    this.pset('HPB_DMD', L.PIC_HPB.run({ pv: pms, track: lpbIlk ? 0 : null }));
    this.pset('LPB_DMD', L.PIC_LPB.run({ pv: p('HRH_PRESS'), track: lpbIlk ? 0 : null }));

    // SH start-up vent: open while raising pressure from cold, closed above 5 bar
    const fired = this.peerOk('BMS') && this.peer('BMS', 'FUEL_IN_SERVICE');
    const pd = p('DRUM_PRESS');
    this.devices.SH_VENT.run({ autoOpen: fired && pd < 3, autoClose: pd > 5 });

    // ---------------------------------------------------------------- status
    this.set('TRIPPED', !s.latched);
    this.set('LATCHED', s.latched);
    this.set('MODE', mode);
    this.set('TRIP_CAUSE', s.cause);
    this.set('AT_SPEED', mode === MODE.SPEED && Math.abs(n - RPM) < 18);
    this.set('REM_READY', s.latched && gcb && remoteSel);
  }

  onBuiltInIC(id) {
    const s = this.state;
    const L = this.loops;
    const p = (t) => this.p(t);
    const n = this.speed();
    this.set('SH_VENT.MODE', PID_MODE.AUTO);
    for (const l of [L.SPD_CTRL, L.LOAD_CTRL, L.PIC_TPT]) {
      l.setMode(PID_MODE.AUTO);
      l.setOut(p('GV_POS'));
    }
    L.PIC_HPB.setOut(p('HPB_POS'));
    L.PIC_LPB.setOut(p('LPB_POS'));
    s.hpbSp = p('MS_PRESS');
    s.lpbSp = Math.max(9, p('HRH_PRESS'));
    this.set('HPB_TARGET', Math.round(p('MS_PRESS')));
    const bypassAuto = id >= 2;
    L.PIC_HPB.setMode(bypassAuto ? PID_MODE.AUTO : PID_MODE.MAN);
    L.PIC_LPB.setMode(bypassAuto ? PID_MODE.AUTO : PID_MODE.MAN);
    s.edges.gcb = p('GCB_CLOSED');
    s.edges.gcbF = p('GCB_CLOSED');
    if (p('MSV_OPEN')) {
      s.latched = true;
      s.cause = 0;
      s.spdRef = n;
      this.set('SPD_TARGET', Math.round(n));
      s.loadRef = p('GEN_MW');
      this.set('LOAD_TARGET', Math.round(p('GEN_MW')));
      if (p('GCB_CLOSED')) {
        this.set('MODE_SEL', 1);
        this.set('HPB_MODE', 1);
        s.hpbSp = p('MS_PRESS') + 10;
        s.lpbSp = p('HRH_PRESS') + 3;
      }
    } else {
      s.latched = false;
      s.cause = id === 1 ? 13 : 0;
    }
    s.edges.latchedF = s.latched;
    this.state.latch.gv = p('GV_POS');
  }
}
