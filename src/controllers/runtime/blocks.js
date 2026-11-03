import { PID, clamp } from '../../common/blocks.js';
import { PID_MODE, PID_STS } from '../../common/tags.js';

/**
 * PID loop bound to its faceplate tags (<name>.PV/.SP/.OUT/.MODE/.KP/.TI/.TD/.CSP/.STS).
 * The algorithm works in % of output span; tags are in engineering units.
 */
export class Loop {
  constructor(ctrl, name, { action = 'reverse', spTrack = true, refDt = 0 } = {}) {
    this.ctrl = ctrl;
    this.name = name;
    // Fast loops: when the simulation runs faster than real time the scan step (dt) grows; above
    // refDt the gain is reduced and the integral time stretched to keep the sampled loop stable.
    this.refDt = refDt;
    this.meta = ctrl.map.loops.find((l) => l.name === name);
    if (!this.meta) throw new Error(`${ctrl.name}: loop ${name} not in map`);
    this.spTrack = spTrack;
    this.pid = new PID({ pvMin: this.meta.pvMin, pvMax: this.meta.pvMax, outMin: 0, outMax: 100, action });
    this.out = 0;
    this.mode = PID_MODE.MAN;
  }

  toPct(v) {
    const { outMin, outMax } = this.meta;
    return ((v - outMin) / (outMax - outMin)) * 100;
  }

  toEng(p) {
    const { outMin, outMax } = this.meta;
    return outMin + (p / 100) * (outMax - outMin);
  }

  get(t) {
    return this.ctrl.get(`${this.name}.${t}`);
  }

  set(t, v) {
    this.ctrl.set(`${this.name}.${t}`, v);
  }

  /** Puts the loop in a mode (used by interlocks and IC defaults). */
  setMode(mode) {
    this.set('MODE', mode);
  }

  setSP(v) {
    this.set('SP', v);
  }

  setOut(v) {
    this.set('OUT', v);
  }

  /**
   * opts: pv, csp (cascade/remote setpoint), ff (eng units of output), forceMan, track (eng),
   *       outHi/outLo (eng), spLo/spHi, casAvail
   */
  run({ pv, csp, ff = 0, forceMan = false, track = null, outHi, outLo, spLo = -Infinity, spHi = Infinity, casAvail = true }) {
    const c = this.ctrl;
    const { outMin, outMax } = this.meta;
    const slow = this.refDt > 0 && c.dt > this.refDt ? this.refDt / c.dt : 1;
    this.pid.kp = Math.max(0, this.get('KP')) * slow;
    this.pid.ti = Math.max(0, this.get('TI')) / slow;
    this.pid.td = Math.max(0, this.get('TD'));
    let mode = this.get('MODE');
    if (mode > 2) mode = PID_MODE.MAN;
    let sts = 0;
    if (forceMan && mode !== PID_MODE.MAN) mode = PID_MODE.MAN;
    if (forceMan) sts |= PID_STS.INTERLOCK;
    const casOk = this.meta.cas && casAvail && csp !== undefined && csp !== null && Number.isFinite(csp);
    if (casOk) sts |= PID_STS.CAS_OK;
    if (mode === PID_MODE.CAS && !casOk) mode = PID_MODE.AUTO;
    let sp = this.get('SP');
    if (mode === PID_MODE.CAS) sp = csp;
    sp = clamp(sp, spLo, spHi);
    const ffPct = (ff / (outMax - outMin)) * 100;
    const hiPct = outHi === undefined ? 100 : this.toPct(Math.min(outHi, outMax));
    const loPct = outLo === undefined ? 0 : this.toPct(Math.max(outLo, outMin));
    let pct;
    if (track !== null && track !== undefined) {
      pct = this.pid.track(this.toPct(track), sp, pv, ffPct);
      sts |= PID_STS.TRACK;
      if (mode === PID_MODE.MAN && this.spTrack) sp = pv;
    } else if (mode === PID_MODE.MAN) {
      pct = this.pid.track(clamp(this.toPct(this.get('OUT')), loPct, hiPct), sp, pv, ffPct);
      if (this.spTrack) sp = clamp(pv, spLo, spHi);
    } else {
      if (c.resync || this.mode === PID_MODE.MAN || this.wasTracking) this.pid.track(this.toPct(this.get('OUT')), sp, pv, ffPct);
      pct = this.pid.update(sp, pv, c.dt, { ff: ffPct, outHi: hiPct, outLo: loPct });
      if (pct >= hiPct - 1e-6) sts |= PID_STS.HI_LIM;
      if (pct <= loPct + 1e-6) sts |= PID_STS.LO_LIM;
    }
    this.wasTracking = (sts & PID_STS.TRACK) !== 0;
    const out = this.toEng(pct);
    this.set('PV', pv);
    this.set('SP', sp);
    this.set('OUT', out);
    this.set('MODE', mode);
    this.set('CSP', csp ?? sp);
    this.set('STS', sts);
    this.out = out;
    this.mode = mode;
    this.sp = sp;
    return out;
  }

  get auto() {
    return this.mode !== PID_MODE.MAN;
  }
}

/** Manual / auto loading station (<name>.OUT/.MODE/.BIAS/.IN/.FB/.STS). */
export class Station {
  constructor(ctrl, name) {
    this.ctrl = ctrl;
    this.name = name;
    this.meta = ctrl.map.stations.find((s) => s.name === name);
    if (!this.meta) throw new Error(`${ctrl.name}: station ${name} not in map`);
    this.out = 0;
    this.mode = PID_MODE.MAN;
  }

  get(t) {
    return this.ctrl.get(`${this.name}.${t}`);
  }

  set(t, v) {
    this.ctrl.set(`${this.name}.${t}`, v);
  }

  setMode(m) {
    this.set('MODE', m);
  }

  setOut(v) {
    this.set('OUT', v);
  }

  run({ auto = 0, fb = 0, forceMan = false, track = null, lo = this.meta.outMin, hi = this.meta.outMax, rate = Infinity }) {
    const prev = this.ctrl.state.stMode[this.name] ?? PID_MODE.MAN;
    let mode = this.get('MODE') === PID_MODE.AUTO ? PID_MODE.AUTO : PID_MODE.MAN;
    let sts = 0;
    if (forceMan) {
      mode = PID_MODE.MAN;
      sts |= 1;
    }
    let out;
    const current = this.get('OUT');
    if (track !== null && track !== undefined) {
      out = track;
      sts |= 2;
    } else if (mode === PID_MODE.AUTO) {
      if (prev !== PID_MODE.AUTO) this.set('BIAS', clamp(current - auto, -50, 50));
      out = auto + this.get('BIAS');
      if (Number.isFinite(rate)) out = current + clamp(out - current, -rate * this.ctrl.dt, rate * this.ctrl.dt);
    } else {
      out = current;
    }
    out = clamp(out, lo, hi);
    this.ctrl.state.stMode[this.name] = mode;
    this.set('OUT', out);
    this.set('MODE', mode);
    this.set('IN', auto);
    this.set('FB', fb);
    this.set('STS', sts);
    this.out = out;
    this.mode = mode;
    return out;
  }

  get auto() {
    return this.mode === PID_MODE.AUTO;
  }
}

/** Motor device block driving <plant>_CMD from START/STOP pulses, auto logic and interlocks. */
export class Motor {
  constructor(ctrl, name, { plant = name } = {}) {
    this.ctrl = ctrl;
    this.name = name;
    this.plant = plant;
    this.meta = ctrl.map.devices.find((d) => d.name === name);
  }

  run({ permit = true, ilk = false, autoStart = false, autoStop = false } = {}) {
    const c = this.ctrl;
    const st = (c.state.dev[this.name] ||= { cmd: false, trip: false });
    const running = c.p(`${this.plant}_RUN`);
    const tripped = c.p(`${this.plant}_TRIP`);
    const auto = c.get(`${this.name}.MODE`) === 1;
    if (tripped) {
      st.cmd = false;
      st.trip = true;
    }
    if (c.get(`${this.name}.STOP`)) {
      st.cmd = false;
      st.trip = false;
    }
    if (c.get(`${this.name}.START`)) {
      if (permit && !ilk && !tripped) {
        st.cmd = true;
        st.trip = false;
      } else c.reject(`${this.name} start not permitted`);
    }
    if (auto && autoStart && permit && !ilk && !tripped && !st.trip) st.cmd = true;
    if (auto && autoStop) st.cmd = false;
    if (ilk) st.cmd = false;
    c.pset(`${this.plant}_CMD`, st.cmd);
    c.set(`${this.name}.RUN`, running);
    c.set(`${this.name}.TRIP`, st.trip);
    c.set(`${this.name}.PERM`, permit);
    c.set(`${this.name}.ILK`, ilk);
    this.running = running;
    this.cmd = st.cmd;
    this.tripped = tripped || st.trip;
    this.auto = auto;
    return running;
  }

  /** Forces the command (used by sequences and IC initialisation). */
  command(on) {
    const st = (this.ctrl.state.dev[this.name] ||= { cmd: false, trip: false });
    st.cmd = !!on;
    if (on) st.trip = false;
  }

  syncFromPlant() {
    this.command(this.ctrl.p(`${this.plant}_RUN`));
  }
}

/** On/off valve or breaker device block. */
export class OnOff {
  constructor(ctrl, name, { cmd, opened, closed = null, resetOnLoss = false } = {}) {
    this.ctrl = ctrl;
    this.name = name;
    this.cmdTag = cmd;
    this.openedTag = opened;
    this.closedTag = closed;
    this.resetOnLoss = resetOnLoss;
  }

  run({ permit = true, ilkClose = false, ilkOpen = false, autoOpen = false, autoClose = false, closePermit = true } = {}) {
    const c = this.ctrl;
    const st = (c.state.dev[this.name] ||= { cmd: false, was: false });
    const opened = c.p(this.openedTag);
    const closed = this.closedTag ? c.p(this.closedTag) : !opened;
    const auto = c.get(`${this.name}.MODE`) === 1;
    if (this.resetOnLoss && st.cmd && st.was && !opened) st.cmd = false;
    if (c.get(`${this.name}.OPEN`)) {
      if (permit && !ilkClose) st.cmd = true;
      else c.reject(`${this.name} open/close not permitted`);
    }
    if (c.get(`${this.name}.CLOSE`)) {
      if (closePermit) st.cmd = false;
      else c.reject(`${this.name} not permitted`);
    }
    if (auto && autoOpen && permit && !ilkClose) st.cmd = true;
    if (auto && autoClose) st.cmd = false;
    if (ilkOpen) st.cmd = true;
    if (ilkClose) st.cmd = false;
    st.was = opened;
    c.pset(this.cmdTag, st.cmd);
    c.set(`${this.name}.OPENED`, opened);
    c.set(`${this.name}.CLOSED`, closed);
    c.set(`${this.name}.PERM`, permit);
    c.set(`${this.name}.ILK`, ilkClose || ilkOpen);
    this.opened = opened;
    this.closed = closed;
    this.cmd = st.cmd;
    return opened;
  }

  command(on) {
    const st = (this.ctrl.state.dev[this.name] ||= { cmd: false, was: false });
    st.cmd = !!on;
  }

  syncFromPlant() {
    const st = (this.ctrl.state.dev[this.name] ||= { cmd: false, was: false });
    st.cmd = st.was = this.ctrl.p(this.openedTag);
  }
}
