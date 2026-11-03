import { describe, it, expect } from 'vitest';
import { TagMap, TagIO, encodeTag } from '../src/common/tags.js';
import { DataStore } from '../src/common/modbus/dataStore.js';
import { MAPS, PEERS } from '../src/maps/index.js';
import { PLANT_MAP } from '../src/maps/plant.js';

describe('TagMap', () => {
  it('allocates addresses sequentially with 2 registers per float', () => {
    const m = new TagMap('T');
    const a = m.ir('A', 'MPa', 'a');
    const b = m.ir('B', '', 'b', { type: 'u16' });
    const c = m.ir('C', '', 'c');
    expect([a.address, b.address, c.address]).toEqual([0, 2, 3]);
  });

  it('round-trips every data type through a store', () => {
    const m = new TagMap('T');
    m.hr('F', '', '', { init: 538.25 });
    m.hr('U', '', '', { type: 'u32', init: 4000000000 });
    m.hr('I', '', '', { type: 'i16', init: -1234 });
    m.co('B', '', { init: true });
    const store = new DataStore(m.sizes());
    m.applyInit(store);
    const io = new TagIO(m, store);
    expect(io.get('F')).toBeCloseTo(538.25, 4);
    expect(io.get('U')).toBe(4000000000);
    expect(io.get('I')).toBe(-1234);
    expect(io.get('B')).toBe(true);
    expect(encodeTag(m.get('I'), -1)).toEqual([65535]);
  });

  it('rejects non-contiguous owner blocks', () => {
    const m = new TagMap('T');
    m.section('X', () => m.hr('X1', '', ''));
    m.hr('Y', '', '');
    expect(() => m.section('X', () => m.hr('X2', '', ''))).toThrow(/not contiguous/);
  });

  it('expands PID faceplate tags', () => {
    const m = new TagMap('T');
    m.pid('LIC', { desc: 'level', pvUnits: 'mm', pvMin: 0, pvMax: 100 });
    for (const t of ['PV', 'SP', 'OUT', 'MODE', 'KP', 'TI', 'TD', 'CSP', 'STS']) expect(m.has(`LIC.${t}`)).toBe(true);
    expect(m.loops[0].name).toBe('LIC');
  });
});

describe('system register maps', () => {
  it('builds all nine node maps', () => {
    expect(Object.keys(MAPS).sort()).toEqual(['BMS', 'BOP', 'CCS', 'CMB', 'DEH', 'FWC', 'GEN', 'PLANT', 'STC']);
  });

  it('gives every field output exactly one owner', () => {
    for (const t of PLANT_MAP.tags.values()) {
      if (t.area === 'co' || t.area === 'hr') expect(t.owner, t.name).toBeTruthy();
    }
  });

  it('declares a peer write block for every peer write relationship', () => {
    for (const [ctrl, p] of Object.entries(PEERS)) {
      for (const target of p.write) {
        const r = MAPS[target].ownerRange(ctrl, 'hr');
        expect(r.count, `${ctrl} -> ${target}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every controller map within protocol limits per area', () => {
    for (const m of Object.values(MAPS)) {
      for (const area of ['co', 'di', 'hr', 'ir']) expect(m.next[area]).toBeLessThan(2000);
    }
  });
});
