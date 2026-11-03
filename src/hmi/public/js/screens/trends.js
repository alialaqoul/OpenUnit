import { S, esc, fmt, meta } from '../core.js';
import { TrendChart } from '../trend.js';

const COLORS = ['#4ea1ff', '#f0a020', '#3fb950', '#e5484d', '#c4b5ff', '#3cc4b4', '#e2d045', '#ff7eb6'];
const PRESETS = {
  'Unit load': ['PLANT:GEN_MW', 'CCS:ULD_ACT', 'PLANT:MS_PRESS', 'CCS:PRESS_SP', 'CCS:BLR_DMD', 'PLANT:GAS_FLOW'],
  'Steam temperatures': ['PLANT:MS_TEMP', 'PLANT:HRH_TEMP', 'PLANT:DSH_OUT_TEMP', 'PLANT:SH_SPRAY_FLOW', 'PLANT:TILT_FB'],
  'Drum level': ['FWC:DRUM_LVL_SEL', 'PLANT:FW_FLOW', 'PLANT:STEAM_FLOW', 'PLANT:DRUM_PRESS', 'PLANT:FCV_FB'],
  Combustion: ['PLANT:GAS_FLOW', 'PLANT:AIR_FLOW', 'PLANT:O2', 'CMB:FURN_PRESS_SEL', 'PLANT:GAS_HDR_PRESS'],
  Turbine: ['DEH:SPEED', 'DEH:SPEED_REF', 'PLANT:GV_POS', 'PLANT:VIB_3', 'DEH:STRESS_HP'],
  Electrical: ['PLANT:GEN_MW', 'PLANT:GEN_MVAR', 'PLANT:GEN_KV', 'PLANT:GRID_FREQ', 'PLANT:LOAD_ANGLE'],
  Condenser: ['PLANT:COND_PRESS', 'PLANT:CW_OUT_T', 'PLANT:HW_LVL', 'PLANT:DA_LVL', 'PLANT:DA_PRESS'],
};

let pens = PRESETS['Unit load'].map((key, i) => ({ key, color: COLORS[i], auto: true }));
let seconds = 900;

export default {
  id: 'trends',
  title: 'Trends',
  render(root) {
    const allKeys = [];
    for (const [node, c] of Object.entries(S.catalog.nodes)) for (const t of c.tags) if (t.type === 'f32') allKeys.push({ key: `${node}:${t.name}`, desc: t.desc, units: t.units });
    root.innerHTML = `<div class="trend-wrap">
      <div class="panel" style="padding:6px;display:flex;flex-direction:column;gap:6px">
        <div class="row">${['300', '900', '1800', '3600', '7200'].map((s) => `<button class="btn small" data-sec="${s}">${Number(s) / 60} min</button>`).join('')}
          <span style="flex:1"></span>${Object.keys(PRESETS).map((p) => `<button class="btn small" data-preset="${esc(p)}">${esc(p)}</button>`).join('')}</div>
        <canvas class="trend-canvas" id="tcv"></canvas>
      </div>
      <div class="panel" style="overflow:auto"><h3>Pens (hover the chart for values)</h3><div id="pens"></div>
        <h3 style="margin-top:12px">Add tag</h3><input class="txt" id="q" placeholder="search e.g. drum, MW, O2" style="width:100%"/>
        <div class="taglist" id="tl"></div>
        <p style="color:var(--muted);font-size:11px">History is sampled once per second for every analog tag of all 9 nodes (2 hours retained). Time axis shows simulation time.</p></div>
    </div>`;
    const cursorVals = {};
    const drawPens = () => {
      root.querySelector('#pens').innerHTML = pens
        .map(
          (p, i) => `<div class="pen"><i style="background:${p.color}"></i><span title="${esc(meta(p.key)?.desc || '')}">${esc(p.key)}<br><span style="color:var(--muted);font-size:10px">${esc(meta(p.key)?.desc || '')}</span></span>
          <span class="mono">${cursorVals[p.key] ?? fmt(p.key)} ${esc(meta(p.key)?.units || '')}</span><span class="x" data-rm="${i}" style="cursor:pointer;color:var(--muted)">&times;</span></div>`,
        )
        .join('');
    };
    const chart = new TrendChart(root.querySelector('#tcv'), {
      onCursor: (j, d) => {
        for (const p of pens) {
          const s = d.series[p.key];
          cursorVals[p.key] = s ? s[j]?.toFixed(meta(p.key)?.dp ?? 2) : '--';
        }
        drawPens();
      },
    });
    const load = async () => {
      const r = await fetch(`/api/history?seconds=${seconds}&tags=${encodeURIComponent(pens.map((p) => p.key).join(','))}`);
      chart.setData(await r.json(), pens);
    };
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sec],[data-preset],[data-rm],[data-add]');
      if (!b) return;
      if (b.dataset.sec) seconds = Number(b.dataset.sec);
      if (b.dataset.preset) pens = PRESETS[b.dataset.preset].map((key, i) => ({ key, color: COLORS[i], auto: true }));
      if (b.dataset.rm) pens.splice(Number(b.dataset.rm), 1);
      if (b.dataset.add && pens.length < 8 && !pens.some((p) => p.key === b.dataset.add)) pens.push({ key: b.dataset.add, color: COLORS.find((c) => !pens.some((p) => p.color === c)), auto: true });
      drawPens();
      load();
    });
    const q = root.querySelector('#q');
    const list = () => {
      const s = q.value.toLowerCase();
      root.querySelector('#tl').innerHTML = allKeys
        .filter((k) => !s || k.key.toLowerCase().includes(s) || k.desc.toLowerCase().includes(s))
        .slice(0, 80)
        .map((k) => `<div data-add="${k.key}"><b class="mono">${esc(k.key)}</b> ${esc(k.desc)} <span style="color:var(--muted)">${esc(k.units || '')}</span></div>`)
        .join('');
    };
    q.addEventListener('input', list);
    list();
    drawPens();
    load();
    const t = setInterval(load, 2000);
    const ro = new ResizeObserver(() => chart.draw());
    ro.observe(root.querySelector('#tcv'));
    return {
      dispose() {
        clearInterval(t);
        ro.disconnect();
      },
    };
  },
};
