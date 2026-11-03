/**
 * Alarm engine (ISA-18.2 style states):
 *   NORMAL -> ACTIVE_UNACK -> ACTIVE_ACK -> NORMAL
 *                     \-> RTN_UNACK (returned to normal but not yet acknowledged)
 * Alarm points are generated from the `alarm` attribute of tag definitions.
 */
const LEVELS = [
  ['hh', (v, l) => v >= l, 'HH'],
  ['h', (v, l) => v >= l, 'H'],
  ['ll', (v, l) => v <= l, 'LL'],
  ['l', (v, l) => v <= l, 'L'],
];

export class AlarmEngine {
  constructor(maps, { onEvent } = {}) {
    this.points = [];
    this.onEvent = onEvent || (() => {});
    this.seq = 0;
    for (const map of Object.values(maps)) {
      for (const t of map.tags.values()) {
        if (!t.alarm) continue;
        if (t.type === 'bool') {
          this.points.push({
            id: `${t.node}:${t.name}`,
            node: t.node,
            tag: t.name,
            kind: 'bool',
            on: t.alarm.on,
            pri: t.alarm.pri ?? 2,
            text: t.alarm.text || t.desc,
            state: 'NORMAL',
          });
        } else {
          for (const [key, , label] of LEVELS) {
            if (t.alarm[key] === undefined) continue;
            const isHigh = key.startsWith('h');
            const span = (t.max ?? 100) - (t.min ?? 0);
            this.points.push({
              id: `${t.node}:${t.name}:${label}`,
              node: t.node,
              tag: t.name,
              kind: 'analog',
              level: label,
              limit: t.alarm[key],
              high: isHigh,
              db: Math.max(Math.abs(t.alarm[key]) * 0.01, span * 0.005, 0.01),
              pri: key.length === 2 ? 1 : t.alarm.pri ?? 2,
              text: `${t.desc} ${label === 'HH' ? 'HIGH-HIGH' : label === 'H' ? 'HIGH' : label === 'LL' ? 'LOW-LOW' : 'LOW'}`,
              units: t.units,
              dp: t.dp,
              state: 'NORMAL',
              delay: 0,
            });
          }
        }
      }
    }
    this.byId = new Map(this.points.map((p) => [p.id, p]));
  }

  /** values: {NODE: {TAG: v}}, comm: {NODE: bool}; returns true when anything changed. */
  evaluate(values, comm, now = Date.now()) {
    let changed = false;
    for (const p of this.points) {
      const nv = values[p.node];
      if (!nv || !comm[p.node]) continue; // suppress alarms of nodes we cannot see
      const v = nv[p.tag];
      if (v === undefined) continue;
      let active;
      if (p.kind === 'bool') active = !!v === !!p.on;
      else {
        const was = p.state === 'ACTIVE_UNACK' || p.state === 'ACTIVE_ACK';
        if (p.high) active = was ? v > p.limit - p.db : v >= p.limit;
        else active = was ? v < p.limit + p.db : v <= p.limit;
      }
      p.value = v;
      if (active) {
        if (p.state === 'NORMAL' || p.state === 'RTN_UNACK') {
          p.state = 'ACTIVE_UNACK';
          p.tIn = now;
          p.seq = ++this.seq;
          changed = true;
          this.onEvent({ type: 'ALARM', pri: p.pri, text: p.text, id: p.id, value: v, units: p.units });
        }
      } else if (p.state === 'ACTIVE_UNACK') {
        p.state = 'RTN_UNACK';
        p.tOut = now;
        changed = true;
        this.onEvent({ type: 'RTN', pri: p.pri, text: p.text, id: p.id });
      } else if (p.state === 'ACTIVE_ACK') {
        p.state = 'NORMAL';
        p.tOut = now;
        changed = true;
        this.onEvent({ type: 'RTN', pri: p.pri, text: p.text, id: p.id });
      }
    }
    return changed;
  }

  ack(id) {
    const list = id === 'ALL' ? this.points : [this.byId.get(id)].filter(Boolean);
    let n = 0;
    for (const p of list) {
      if (p.state === 'ACTIVE_UNACK') {
        p.state = 'ACTIVE_ACK';
        n++;
      } else if (p.state === 'RTN_UNACK') {
        p.state = 'NORMAL';
        n++;
      }
    }
    return n;
  }

  /** Clears every alarm (used after an IC load so stale alarms do not linger). */
  reset() {
    for (const p of this.points) p.state = 'NORMAL';
  }

  list() {
    return this.points
      .filter((p) => p.state !== 'NORMAL')
      .map((p) => ({
        id: p.id,
        node: p.node,
        tag: p.tag,
        pri: p.pri,
        text: p.text,
        state: p.state,
        tIn: p.tIn,
        tOut: p.tOut,
        value: p.value,
        limit: p.limit,
        units: p.units,
        seq: p.seq,
      }))
      .sort((a, b) => a.pri - b.pri || b.seq - a.seq);
  }

  counts() {
    const c = { total: 0, unack: 0, p1: 0, p2: 0, p3: 0 };
    for (const p of this.points) {
      if (p.state === 'NORMAL') continue;
      c.total++;
      if (p.state.endsWith('UNACK')) c.unack++;
      if (p.state.startsWith('ACTIVE')) c[`p${p.pri}`]++;
    }
    return c;
  }
}
