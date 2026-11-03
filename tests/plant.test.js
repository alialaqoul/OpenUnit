import { describe, it, expect } from 'vitest';
import { PlantModel } from '../src/plant/model/PlantModel.js';
import { builtInState, coldState } from '../src/plant/model/initialConditions.js';
import { median3 } from '../src/common/blocks.js';

const run = (m, u, seconds, dt = 0.05) => {
  for (let t = 0; t < seconds; t += dt) m.step(dt, u);
  return m.measure();
};

describe('plant model - full load', () => {
  it('produces about 700 MW at MCR conditions and holds steady open loop', () => {
    const m = new PlantModel(builtInState(5));
    const u = m.inputsFromState();
    const o = run(m, u, 20);
    expect(o.GEN_MW).toBeGreaterThan(670);
    expect(o.GEN_MW).toBeLessThan(720);
    expect(o.MS_PRESS).toBeGreaterThan(155); // bar(g)
    expect(o.GRID_FREQ).toBeCloseTo(60, 3);
    expect(o.O2).toBeGreaterThan(1.2);
    expect(o.O2).toBeLessThan(3.5);
    expect(Math.abs(median3(o.DRUM_LVL_A, o.DRUM_LVL_B, o.DRUM_LVL_C))).toBeLessThan(60);
    expect(o.COND_PRESS).toBeLessThan(100); // mbar(a)
  });

  it('a master fuel trip extinguishes all flames and collapses firing', () => {
    const m = new PlantModel(builtInState(5));
    const u = { ...m.inputsFromState(), MFT_TRIP: true };
    const o = run(m, u, 5);
    expect(o.FUEL_HEAT).toBe(0);
    expect(o.MGTV_OPEN).toBe(false);
    expect(['A', 'B', 'C', 'D'].some((x) => o[`FLAME_${x}`])).toBe(false);
  });

  it('a turbine trip closes the stop valves and unloads the generator', () => {
    const m = new PlantModel(builtInState(5));
    const u = { ...m.inputsFromState(), TURB_TRIP: true };
    const o = run(m, u, 3);
    expect(o.MSV_OPEN).toBe(false);
    expect(o.GV_POS).toBe(0);
    expect(o.GEN_MW).toBeLessThan(5);
  });

  it('a generator breaker opening (load rejection) accelerates the rotor', () => {
    const m = new PlantModel(builtInState(5));
    const u = { ...m.inputsFromState(), GCB_CMD: false };
    const o = run(m, u, 0.5);
    expect(o.GCB_CLOSED).toBe(false);
    expect(o.SPEED_A).toBeGreaterThan(3650);
  });

  it('losing all feedwater drains the drum within seconds', () => {
    const m = new PlantModel(builtInState(5));
    const u = { ...m.inputsFromState(), FCV_DMD: 0 };
    const o = run(m, u, 40);
    expect(median3(o.DRUM_LVL_A, o.DRUM_LVL_B, o.DRUM_LVL_C)).toBeLessThan(-250);
  });
});

describe('plant model - cold state', () => {
  it('stays cold, unfired and on turning gear', () => {
    const m = new PlantModel(coldState());
    const u = m.inputsFromState();
    const o = run(m, u, 30);
    expect(o.FUEL_HEAT).toBe(0);
    expect(o.DRUM_PRESS).toBeLessThan(0.5);
    expect(o.TG_ENGAGED).toBe(true);
    expect(o.SPEED_A).toBeLessThan(6);
    expect(o.LO_PRESS).toBeGreaterThan(1.0);
  });

  it('pulls condenser vacuum with vacuum pumps and gland steam', () => {
    const m = new PlantModel(coldState());
    const u = { ...m.inputsFromState(), CWP_A_CMD: true, CWP_B_CMD: true, VP_A_CMD: true, VP_B_CMD: true, GLAND_CMD: true };
    const o = run(m, u, 1500, 0.2);
    expect(o.COND_PRESS).toBeLessThan(200);
  });
});
