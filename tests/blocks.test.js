import { describe, it, expect } from 'vitest';
import { PID, RateLimiter, Lag, TON, median3, vote2oo3, fgen, Hysteresis } from '../src/common/blocks.js';

describe('PID', () => {
  it('drives a first-order process to setpoint (reverse action)', () => {
    const pid = new PID({ kp: 2, ti: 5, pvMin: 0, pvMax: 100 });
    let pv = 0;
    for (let i = 0; i < 2000; i++) {
      const out = pid.update(50, pv, 0.1);
      pv += ((out - pv) / 3) * 0.1;
    }
    expect(pv).toBeCloseTo(50, 1);
  });

  it('increases output when PV rises above SP in direct action', () => {
    const pid = new PID({ kp: 1, ti: 0, action: 'direct', outMin: -100 });
    expect(pid.update(0, 10, 0.1)).toBeGreaterThan(0);
  });

  it('does not wind up while saturated', () => {
    const pid = new PID({ kp: 1, ti: 2 });
    for (let i = 0; i < 1000; i++) pid.update(100, 0, 0.1);
    expect(pid.out).toBe(100);
    // Error reverses: output must leave the limit immediately
    const out = pid.update(0, 100, 0.1);
    expect(out).toBeLessThan(100);
  });

  it('tracks bumplessly', () => {
    const pid = new PID({ kp: 3, ti: 10 });
    pid.track(42, 50, 48);
    expect(pid.update(50, 48, 0.001)).toBeCloseTo(42, 2);
  });
});

describe('function blocks', () => {
  it('rate limits in both directions', () => {
    const r = new RateLimiter(1, 2, 0);
    r.update(10, 1);
    expect(r.value).toBe(1);
    r.update(-10, 1);
    expect(r.value).toBe(-1);
  });

  it('lags toward input', () => {
    const l = new Lag(10, 0);
    for (let i = 0; i < 100; i++) l.update(1, 0.1);
    expect(l.value).toBeCloseTo(1 - Math.exp(-1), 1);
  });

  it('on-delay timer', () => {
    const t = new TON(1);
    expect(t.update(true, 0.5)).toBe(false);
    expect(t.update(true, 0.6)).toBe(true);
    expect(t.update(false, 0.1)).toBe(false);
  });

  it('median and 2oo3 voting', () => {
    expect(median3(5, 500, 7)).toBe(7);
    expect(vote2oo3(true, false, true)).toBe(true);
    expect(vote2oo3(true, false, false)).toBe(false);
  });

  it('function generator interpolates and clamps', () => {
    const f = fgen([
      [0, 9],
      [30, 9],
      [90, 16.7],
    ]);
    expect(f(-5)).toBe(9);
    expect(f(60)).toBeCloseTo(12.85, 2);
    expect(f(120)).toBe(16.7);
  });

  it('hysteresis', () => {
    const h = new Hysteresis(25, 20);
    expect(h.update(22)).toBe(false);
    expect(h.update(26)).toBe(true);
    expect(h.update(22)).toBe(true);
    expect(h.update(19)).toBe(false);
  });
});
