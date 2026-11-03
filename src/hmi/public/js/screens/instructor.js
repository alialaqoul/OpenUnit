import { S, val, write, onUpdate, esc, fmt, simClock, toast, loadCatalog } from '../core.js';

const ENV = [
  ['GRID_FREQ_SET', 'Grid frequency', 'Hz', [59.5, 59.8, 60, 60.2]],
  ['GRID_KV_SET', 'Grid voltage', 'kV', [380, 400, 415]],
  ['CW_INLET_T_SET', 'CW inlet temperature', 'degC', [15, 25, 33]],
  ['AMBIENT_T_SET', 'Ambient air temperature', 'degC', [10, 30, 45]],
  ['GAS_LHV_SET', 'Natural gas LHV', 'MJ/kg', [45, 49, 51]],
  ['GAS_SUPPLY_SET', 'Gas supply pressure', 'bar', [15, 30]],
  ['MF_TUBE_LEAK_SEV', 'Tube leak size', 't/h', [30, 80, 200]],
  ['MF_AIR_INGRESS_SEV', 'Air in-leakage multiplier', 'x', [10, 30, 80]],
  ['MF_VIB_SEV', 'Bearing 3 extra vibration', 'um', [80, 150, 260]],
];

export default {
  id: 'instructor',
  title: 'Instructor',
  render(root) {
    const ins = (tag, value) => write('PLANT', tag, value, 'Instructor');
    const draw = () => {
      const groups = {};
      for (const m of S.catalog.malfunctions) (groups[m.group] ||= []).push(m);
      root.innerHTML = `<div class="cols" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
        <div class="col">
          <div class="panel"><h3>Simulation</h3>
            <div class="row"><button class="btn ok" data-run="1">RUN</button><button class="btn" data-run="0">FREEZE</button>
              <span style="margin-left:12px;color:var(--muted)">Speed</span>${[0.5, 1, 2, 5, 10].map((x) => `<button class="btn" data-speed="${x}">${x}x</button>`).join('')}</div>
            <div class="kv" style="margin-top:10px"><span>State</span><span id="istate">--</span><span>Simulation time</span><span id="itime">--</span><span>Active IC</span><span id="iic">--</span></div>
            <p style="color:var(--muted);font-size:11px">Fast time (5-10x) is useful for heat-up, vacuum raising and pressure raising. Fast control loops (furnace draft) are less accurate at high speed.</p></div>
          <div class="panel"><h3>Initial conditions</h3><table class="tbl"><tr><th>#</th><th>Name</th><th>Source</th><th></th></tr>
            ${S.catalog.ics
              .map(
                (ic) =>
                  `<tr><td class="mono">${ic.id}</td><td><b>${esc(ic.name)}</b><br><span style="color:var(--muted);font-size:11px">${esc(ic.desc || '')}</span></td><td style="font-size:11px">${ic.snapshot ? 'snapshot file' : 'built-in model'}</td><td><button class="btn primary small" data-ic="${ic.id}">LOAD</button></td></tr>`,
              )
              .join('')}</table>
            <div class="row" style="margin-top:10px"><span style="color:var(--muted)">Save snapshot to slot</span><input class="num" id="slot" value="10" style="width:60px"/><button class="btn" id="snap">SAVE SNAPSHOT</button></div>
            <p style="color:var(--muted);font-size:11px">Loading an IC freezes the simulation; all 8 controllers re-initialise (or restore their own snapshot) via the Modbus IC handshake. Press RUN to continue.</p></div>
          <div class="panel"><h3>Process & boundary conditions</h3><table class="tbl">${ENV.map(
            ([t, d, u, presets]) =>
              `<tr><td>${esc(d)}</td><td class="r mono"><span data-v="PLANT:${t}">--</span> ${esc(u)}</td><td><input class="num" style="width:70px" data-env="${t}"/> <button class="btn small" data-envset="${t}">Set</button></td><td>${presets.map((p) => `<button class="btn small" data-envp="${t}|${p}">${p}</button>`).join('')}</td></tr>`,
          ).join('')}</table></div>
        </div>
        <div class="col"><div class="panel"><h3>Malfunctions</h3>${Object.entries(groups)
          .map(
            ([g, list]) =>
              `<h3 style="margin-top:10px;color:var(--accent)">${esc(g)}</h3><div class="mf-grid">${list.map((m) => `<div class="mf" data-mf="${m.tag}"><span class="sw"></span><span><b class="mono" style="font-size:11px">${esc(m.tag)}</b><br>${esc(m.desc)}</span></div>`).join('')}</div>`,
          )
          .join('')}
          <div class="row" style="margin-top:12px"><button class="btn danger" id="clearmf">CLEAR ALL MALFUNCTIONS</button></div></div></div>
      </div>`;
      refresh();
    };
    const refresh = () => {
      const p = S.values.PLANT || {};
      const q = (s) => root.querySelector(s);
      if (!q('#istate')) return;
      q('#istate').textContent = p.SIM_FROZEN ? 'FROZEN' : `RUNNING ${p.SIM_SPEED_ACT ?? ''}x`;
      q('#itime').textContent = simClock(p.SIM_TIME_MS);
      q('#iic').textContent = String(p.IC_ACTIVE ?? '--');
      root.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('sel', Number(b.dataset.speed) === Number(p.SIM_SPEED)));
      root.querySelectorAll('[data-run]').forEach((b) => b.classList.toggle('sel', (b.dataset.run === '1') === !p.SIM_FROZEN));
      root.querySelectorAll('[data-mf]').forEach((d) => d.classList.toggle('on', !!p[d.dataset.mf]));
      root.querySelectorAll('[data-env]').forEach((inp) => {
        if (document.activeElement !== inp) inp.value = fmt(`PLANT:${inp.dataset.env}`);
      });
    };
    root.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-run],[data-speed],[data-ic],[data-mf],[data-envset],[data-envp],#snap,#clearmf');
      if (!t) return;
      const d = t.dataset;
      if (d.run !== undefined) ins('SIM_RUN', d.run === '1');
      if (d.speed) ins('SIM_SPEED', Number(d.speed));
      if (d.ic) {
        if (!confirm(`Load initial condition ${d.ic}? The current plant state will be lost.`)) return;
        await ins('IC_SELECT', Number(d.ic));
        await ins('IC_LOAD', true);
      }
      if (d.mf) ins(d.mf, !val(`PLANT:${d.mf}`));
      if (d.envset) ins(d.envset, Number(root.querySelector(`[data-env="${d.envset}"]`).value));
      if (d.envp) {
        const [tag, v] = d.envp.split('|');
        ins(tag, Number(v));
      }
      if (t.id === 'snap') {
        const slot = Number(root.querySelector('#slot').value);
        if (!(slot >= 1 && slot <= 99)) return toast('Slot must be 1..99');
        if (slot <= 5 && !confirm(`Slot ${slot} is a built-in IC. Overwrite it with the current state?`)) return;
        await ins('SNAP_SELECT', slot);
        await ins('SNAP_SAVE', true);
        toast(`Snapshot saved to slot ${slot}`, 'info');
        setTimeout(async () => {
          await loadCatalog();
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        }, 1500);
      }
      if (t.id === 'clearmf') for (const m of S.catalog.malfunctions) if (val(`PLANT:${m.tag}`)) await ins(m.tag, false);
    });
    draw();
    const off = onUpdate(refresh);
    return { dispose: off };
  },
};
