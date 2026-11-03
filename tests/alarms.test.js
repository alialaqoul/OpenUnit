import { describe, it, expect } from 'vitest';
import { TagMap } from '../src/common/tags.js';
import { AlarmEngine } from '../src/hmi/alarms.js';
import { History } from '../src/hmi/history.js';

function engine() {
  const m = new TagMap('N');
  m.ir('P', 'MPa', 'Pressure', { min: 0, max: 20, alarm: { h: 17, hh: 18, pri: 2 } });
  m.di('TRIP', 'Trip', { alarm: { on: true, pri: 1, text: 'TRIP' } });
  const events = [];
  const e = new AlarmEngine({ N: m }, { onEvent: (ev) => events.push(ev) });
  return { e, events };
}

describe('alarm engine', () => {
  it('raises, acknowledges and clears analog alarms with deadband', () => {
    const { e } = engine();
    e.evaluate({ N: { P: 17.5, TRIP: false } }, { N: true });
    expect(e.list().map((a) => a.id)).toEqual(['N:P:H']);
    expect(e.counts().unack).toBe(1);
    e.ack('ALL');
    expect(e.list()[0].state).toBe('ACTIVE_ACK');
    e.evaluate({ N: { P: 16.95, TRIP: false } }, { N: true }); // inside deadband
    expect(e.list()).toHaveLength(1);
    e.evaluate({ N: { P: 16.0, TRIP: false } }, { N: true });
    expect(e.list()).toHaveLength(0);
  });

  it('keeps unacknowledged alarms that returned to normal (RTN_UNACK)', () => {
    const { e, events } = engine();
    e.evaluate({ N: { P: 0, TRIP: true } }, { N: true });
    e.evaluate({ N: { P: 0, TRIP: false } }, { N: true });
    expect(e.list()[0].state).toBe('RTN_UNACK');
    expect(events.map((x) => x.type)).toEqual(['ALARM', 'RTN']);
    e.ack('N:TRIP');
    expect(e.list()).toHaveLength(0);
  });

  it('suppresses alarms of nodes without communication', () => {
    const { e } = engine();
    e.evaluate({ N: { P: 19, TRIP: true } }, { N: false });
    expect(e.list()).toHaveLength(0);
  });
});

describe('history', () => {
  it('returns the most recent samples in order', () => {
    const h = new History(['a'], { capacity: 5 });
    for (let i = 1; i <= 8; i++) h.record(() => i, i * 1000, i);
    const q = h.query(['a'], 3);
    expect(q.series.a).toEqual([6, 7, 8]);
  });
});
