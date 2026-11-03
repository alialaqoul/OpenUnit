import { describe, it, expect } from 'vitest';
import * as st from '../src/common/steam.js';

describe('steam tables', () => {
  it('matches saturation data at atmospheric and drum pressure', () => {
    expect(st.tsat(st.P_ATM)).toBeCloseTo(99.97, 1);
    expect(st.tsat(18)).toBeCloseTo(356.99, 1);
    expect(st.hfg(1.0)).toBeCloseTo(2014.6, 0);
  });

  it('inverts saturation pressure and temperature', () => {
    for (const p of [0.008, 0.5, 6, 17]) expect(st.psat(st.tsat(p))).toBeCloseTo(p, 2);
  });

  it('inverts superheated enthalpy and temperature', () => {
    const h = st.hSteam(16.8, 538);
    expect(h).toBeGreaterThan(3300);
    expect(st.tSteam(16.8, h)).toBeCloseTo(538, 6);
  });

  it('returns saturation temperature for wet steam', () => {
    expect(st.tSteam(0.007, 2300)).toBeCloseTo(st.tsat(0.007), 6);
    expect(st.quality(0.007, 2300)).toBeGreaterThan(0.8);
  });

  it('gives a plausible HP turbine enthalpy drop', () => {
    const dh = st.expansionDrop(16.8, 538, 4.4, 0.86);
    expect(dh).toBeGreaterThan(330);
    expect(dh).toBeLessThan(420);
  });
});
