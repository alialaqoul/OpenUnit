/**
 * Control function blocks, written in the style of DCS function-block libraries.
 * All blocks are time-step agnostic: pass dt in (simulation) seconds every call.
 */

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, f) => a + (b - a) * f;
export const median3 = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

/** 2-out-of-3 voting for boolean trip channels. */
export const vote2oo3 = (a, b, c) => (a ? 1 : 0) + (b ? 1 : 0) + (c ? 1 : 0) >= 2;

/**
 * PID controller, ideal (ISA) form with % span normalisation, back-calculation
 * anti-windup, derivative on measurement, feed-forward and bumpless mode changes.
 *
 * action: 'reverse' -> output rises when PV < SP (e.g. level controlling an inflow valve)
 *         'direct'  -> output rises when PV > SP (e.g. furnace pressure controlling ID fans)
 */
export class PID {
  constructor({ kp = 1, ti = 30, td = 0, pvMin = 0, pvMax = 100, outMin = 0, outMax = 100, action = 'reverse', tdFilter = 0.1 } = {}) {
    Object.assign(this, { kp, ti, td, pvMin, pvMax, outMin, outMax, action, tdFilter });
    this.integral = 0;
    this.out = outMin;
    this.prevPv = null;
    this.dState = 0;
  }

  error(sp, pv) {
    const span = this.pvMax - this.pvMin || 1;
    const e = ((sp - pv) / span) * 100;
    return this.action === 'direct' ? -e : e;
  }

  /** Forces output (manual / tracking) and back-calculates the integrator for a bumpless return to auto. */
  track(value, sp, pv, ff = 0) {
    this.out = clamp(value, this.outMin, this.outMax);
    this.integral = this.out - this.kp * this.error(sp, pv) - ff;
    this.prevPv = pv;
    this.dState = 0;
    return this.out;
  }

  update(sp, pv, dt, { ff = 0, outHi = this.outMax, outLo = this.outMin } = {}) {
    if (!(dt > 0)) return this.out;
    const e = this.error(sp, pv);
    const p = this.kp * e;
    if (this.ti > 0) this.integral += (this.kp * e * dt) / this.ti;
    let d = 0;
    if (this.td > 0 && this.prevPv !== null) {
      const span = this.pvMax - this.pvMin || 1;
      const dpv = (((pv - this.prevPv) / span) * 100) / dt;
      const raw = -this.kp * this.td * (this.action === 'direct' ? -dpv : dpv);
      const alpha = dt / (this.tdFilter * this.td + dt);
      this.dState += alpha * (raw - this.dState);
      d = this.dState;
    }
    this.prevPv = pv;
    const hi = Math.min(outHi, this.outMax);
    const lo = Math.max(outLo, this.outMin);
    const unclamped = p + this.integral + d + ff;
    this.out = clamp(unclamped, lo, hi);
    if (unclamped !== this.out) this.integral = this.out - p - d - ff; // back-calculation anti-windup
    if (this.ti <= 0) this.integral = clamp(this.integral, -1e6, 1e6);
    this.atHigh = this.out >= hi - 1e-9;
    this.atLow = this.out <= lo + 1e-9;
    return this.out;
  }
}

/** Rate limiter: output follows input with separate up/down rates (units per second). */
export class RateLimiter {
  constructor(up, down = up, initial = 0) {
    this.up = up;
    this.down = down;
    this.value = initial;
  }

  reset(v) {
    this.value = v;
  }

  update(target, dt) {
    const d = target - this.value;
    const maxUp = this.up * dt;
    const maxDown = this.down * dt;
    this.value += d > 0 ? Math.min(d, maxUp) : Math.max(d, -maxDown);
    return this.value;
  }
}

/** First-order lag (low-pass filter). */
export class Lag {
  constructor(tau, initial = 0) {
    this.tau = tau;
    this.value = initial;
  }

  reset(v) {
    this.value = v;
  }

  update(input, dt) {
    if (this.tau <= 0) return (this.value = input);
    this.value += (input - this.value) * Math.min(1, dt / this.tau);
    return this.value;
  }
}

/** Lead-lag compensator (1 + T1 s) / (1 + T2 s). */
export class LeadLag {
  constructor(lead, lag, initial = 0) {
    this.lead = lead;
    this.lag = new Lag(lag, initial);
    this.prev = initial;
    this.value = initial;
  }

  reset(v) {
    this.lag.reset(v);
    this.prev = v;
    this.value = v;
  }

  update(input, dt) {
    if (!(dt > 0)) return this.value;
    const x = input + (this.lead * (input - this.prev)) / dt;
    this.prev = input;
    this.value = this.lag.update(x, dt);
    return this.value;
  }
}

/** On-delay timer (TON). */
export class TON {
  constructor(preset) {
    this.preset = preset;
    this.elapsed = 0;
    this.q = false;
  }

  update(input, dt) {
    if (input) this.elapsed = Math.min(this.preset, this.elapsed + dt);
    else this.elapsed = 0;
    this.q = input && this.elapsed >= this.preset;
    return this.q;
  }

  reset() {
    this.elapsed = 0;
    this.q = false;
  }
}

/** Off-delay timer (TOF). */
export class TOF {
  constructor(preset) {
    this.preset = preset;
    this.elapsed = 0;
    this.q = false;
  }

  update(input, dt) {
    if (input) {
      this.elapsed = 0;
      this.q = true;
    } else if (this.q) {
      this.elapsed += dt;
      if (this.elapsed >= this.preset) this.q = false;
    }
    return this.q;
  }
}

/** Rising-edge detector. */
export class Edge {
  constructor(initial = false) {
    this.prev = initial;
  }

  rise(v) {
    const r = v && !this.prev;
    this.prev = v;
    return r;
  }

  fall(v) {
    const f = !v && this.prev;
    this.prev = v;
    return f;
  }
}

/** Piecewise linear function generator f(x) defined by [[x, y], ...] sorted by x. */
export class FunctionGenerator {
  constructor(points) {
    this.points = points;
  }

  eval(x) {
    const p = this.points;
    if (x <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) {
      if (x <= p[i][0]) return lerp(p[i - 1][1], p[i][1], (x - p[i - 1][0]) / (p[i][0] - p[i - 1][0]));
    }
    return p[p.length - 1][1];
  }
}

export const fgen = (points) => {
  const f = new FunctionGenerator(points);
  return (x) => f.eval(x);
};

/** Hysteresis comparator: true above `on`, false below `off`. */
export class Hysteresis {
  constructor(on, off, initial = false) {
    this.on = on;
    this.off = off;
    this.q = initial;
  }

  update(x) {
    if (this.on >= this.off) {
      if (x >= this.on) this.q = true;
      else if (x <= this.off) this.q = false;
    } else {
      if (x <= this.on) this.q = true;
      else if (x >= this.off) this.q = false;
    }
    return this.q;
  }
}

/** Gaussian noise helper (Box-Muller). */
export function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
