/** In-memory process historian: fixed-size ring buffers sampled once per second. */
export class History {
  constructor(keys, { capacity = 7200 } = {}) {
    this.capacity = capacity;
    this.keys = keys;
    this.index = new Map(keys.map((k, i) => [k, i]));
    this.data = keys.map(() => new Float32Array(capacity));
    this.time = new Float64Array(capacity);
    this.simTime = new Float64Array(capacity);
    this.head = 0;
    this.count = 0;
  }

  record(getValue, wallMs, simS) {
    const i = this.head;
    this.time[i] = wallMs;
    this.simTime[i] = simS;
    for (let k = 0; k < this.keys.length; k++) {
      const v = getValue(this.keys[k]);
      this.data[k][i] = typeof v === 'number' ? v : v ? 1 : 0;
    }
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }

  /** Returns { t: [...], sim: [...], series: { key: [...] } } for the last `seconds` samples. */
  query(keys, seconds = 600, maxPoints = 1200) {
    const n = Math.min(this.count, Math.max(1, Math.round(seconds)));
    const step = Math.max(1, Math.ceil(n / maxPoints));
    const idx = [];
    for (let j = n - 1; j >= 0; j -= step) idx.push((this.head - 1 - j + this.capacity * 2) % this.capacity);
    const out = { t: idx.map((i) => this.time[i]), sim: idx.map((i) => this.simTime[i]), series: {} };
    for (const k of keys) {
      const ki = this.index.get(k);
      if (ki === undefined) continue;
      const arr = this.data[ki];
      out.series[k] = idx.map((i) => Math.round(arr[i] * 1000) / 1000);
    }
    return out;
  }
}
