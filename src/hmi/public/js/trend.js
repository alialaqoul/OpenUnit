/** Canvas trend rendering (mini trends in faceplates and the full trend display). */

function prep(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || cv.width;
  const h = cv.clientHeight || cv.height;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function range(arr) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of arr) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return [0, 1];
  if (hi - lo < 1e-6) {
    const d = Math.abs(hi) * 0.05 || 1;
    return [lo - d, hi + d];
  }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

const fmtTime = (s) => {
  const t = Math.max(0, Math.floor(s));
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

export function drawMini(cv, data, keys, colors) {
  const { ctx, w, h } = prep(cv);
  const n = data.t.length;
  if (n < 2) return;
  // Shared scale for all pens except the last one if it is an output (%)
  keys.forEach((k, i) => {
    const s = data.series[k];
    if (!s) return;
    const [lo, hi] = range(i === keys.length - 1 && keys.length > 2 ? s : keys.slice(0, keys.length > 2 ? -1 : undefined).flatMap((kk) => data.series[kk] || []));
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    s.forEach((v, j) => {
      const x = (j / (n - 1)) * (w - 4) + 2;
      const y = h - 4 - ((v - lo) / (hi - lo)) * (h - 8);
      if (j) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.stroke();
  });
  ctx.fillStyle = '#6b7684';
  ctx.font = '10px sans-serif';
  ctx.fillText('15 min', 4, 11);
}

/** Full trend chart with independent scales per pen and a hover cursor. */
export class TrendChart {
  constructor(canvas, { onCursor } = {}) {
    this.cv = canvas;
    this.data = null;
    this.pens = [];
    this.cursor = null;
    this.onCursor = onCursor;
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.cursor = (e.clientX - r.left) / r.width;
      this.draw();
    });
    canvas.addEventListener('mouseleave', () => {
      this.cursor = null;
      this.draw();
    });
  }

  setData(data, pens) {
    this.data = data;
    this.pens = pens;
    this.draw();
  }

  draw() {
    const { ctx, w, h } = prep(this.cv);
    const L = 60;
    const R = 12;
    const T = 12;
    const B = 26;
    const pw = w - L - R;
    const ph = h - T - B;
    ctx.strokeStyle = '#232a33';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const y = T + (ph * i) / 10;
      ctx.beginPath();
      ctx.moveTo(L, y);
      ctx.lineTo(L + pw, y);
      ctx.stroke();
    }
    for (let i = 0; i <= 12; i++) {
      const x = L + (pw * i) / 12;
      ctx.beginPath();
      ctx.moveTo(x, T);
      ctx.lineTo(x, T + ph);
      ctx.stroke();
    }
    const d = this.data;
    if (!d || d.t.length < 2) {
      ctx.fillStyle = '#6b7684';
      ctx.font = '13px sans-serif';
      ctx.fillText('Waiting for history data ...', L + 20, T + 30);
      return;
    }
    const n = d.t.length;
    const xs = (j) => L + (j / (n - 1)) * pw;
    const ranges = this.pens.map((p) => (p.min !== undefined && p.max !== undefined && !p.auto ? [p.min, p.max] : range(d.series[p.key] || [])));
    this.pens.forEach((p, i) => {
      const s = d.series[p.key];
      if (!s) return;
      const [lo, hi] = ranges[i];
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      s.forEach((v, j) => {
        const y = T + ph - ((v - lo) / (hi - lo)) * ph;
        if (j) ctx.lineTo(xs(j), y);
        else ctx.moveTo(xs(j), y);
      });
      ctx.stroke();
    });
    // y axis of first pen
    if (this.pens[0]) {
      const [lo, hi] = ranges[0];
      ctx.fillStyle = this.pens[0].color;
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      for (let i = 0; i <= 5; i++) ctx.fillText((hi - ((hi - lo) * i) / 5).toFixed(Math.abs(hi - lo) < 10 ? 2 : 0), L - 6, T + (ph * i) / 5 + 4);
    }
    ctx.fillStyle = '#8a94a3';
    ctx.textAlign = 'center';
    ctx.font = '10px monospace';
    for (let i = 0; i <= 6; i++) {
      const j = Math.round(((n - 1) * i) / 6);
      ctx.fillText(fmtTime(d.sim[j]), xs(j), h - 8);
    }
    if (this.cursor !== null) {
      const j = Math.max(0, Math.min(n - 1, Math.round(((this.cursor * w - L) / pw) * (n - 1))));
      ctx.strokeStyle = '#d5dbe3';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(xs(j), T);
      ctx.lineTo(xs(j), T + ph);
      ctx.stroke();
      ctx.setLineDash([]);
      if (this.onCursor) this.onCursor(j, d);
    } else if (this.onCursor) this.onCursor(n - 1, d);
  }
}
