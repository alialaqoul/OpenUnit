import { S, onUpdate, esc, val } from '../core.js';

const CTRL = ['CCS', 'BMS', 'CMB', 'FWC', 'STC', 'DEH', 'GEN', 'BOP'];
const POS = {};
CTRL.forEach((n, i) => (POS[n] = { x: 90 + i * 150, y: 230 }));
POS.HMI = { x: 615, y: 50 };
POS.PLANT = { x: 615, y: 430 };

const MODICON = { co: 1, di: 10001, ir: 30001, hr: 40001 };

function topology() {
  const s = [];
  const box = (n, w = 128, h = 62) => {
    const p = POS[n];
    const c = S.catalog.nodes[n];
    const title = n === 'HMI' ? 'HMI / SCADA server' : c.openplc ? `OpenPLC ${c.openplc.ip}` : c.title;
    const port = n === 'HMI' ? `http :${S.catalog.hmi.port}` : `${c.host}:${c.port}  uid ${c.unitId}`;
    const st = n === 'HMI' ? '' : `class="netnode" data-node="${n}"`;
    return `<g ${st}><rect x="${p.x - w / 2}" y="${p.y - h / 2}" width="${w}" height="${h}" rx="5" fill="#1a2028" stroke="#4a5563" stroke-width="1.5" id="nb-${n}"/>
      <text x="${p.x}" y="${p.y - 12}" text-anchor="middle" style="font-weight:700;font-size:14px">${n === 'PLANT' ? 'FIELD I/O' : n}</text>
      <text x="${p.x}" y="${p.y + 4}" text-anchor="middle" class="lbl-s">${esc(title.length > 26 ? `${title.slice(0, 25)}...` : title)}</text>
      <text x="${p.x}" y="${p.y + 19}" text-anchor="middle" class="lbl-s" style="font-family:var(--mono)">${esc(port)}</text></g>`;
  };
  // HMI polling links
  for (const n of ['PLANT', ...CTRL]) {
    const a = POS.HMI;
    const b = POS[n];
    s.push(`<line x1="${a.x}" y1="${a.y + 31}" x2="${b.x}" y2="${b.y - 31}" stroke="#2f3742" stroke-width="1.2" id="hl-${n}"/>`);
  }
  // Controller <-> field I/O
  for (const n of CTRL) {
    const a = POS[n];
    const b = POS.PLANT;
    s.push(`<line x1="${a.x}" y1="${a.y + 31}" x2="${b.x}" y2="${b.y - 31}" stroke="#3fb950" stroke-width="2" id="io-${n}"/>`);
  }
  // Peer-to-peer links
  let k = 0;
  for (const [n, p] of Object.entries(S.catalog.peers)) {
    for (const t of [...new Set([...p.read, ...p.write])]) {
      const a = POS[n];
      const b = POS[t];
      const bend = 40 + (k++ % 4) * 14;
      const midx = (a.x + b.x) / 2;
      const d = `M${a.x} ${a.y - 31} Q${midx} ${a.y - 31 - bend} ${b.x} ${b.y - 31}`;
      s.push(`<path d="${d}" fill="none" stroke="#4ea1ff" stroke-width="1.6" stroke-dasharray="${p.write.includes(t) ? '0' : '5 4'}" id="pl-${n}-${t}" opacity="0.8"/>`);
    }
  }
  s.push(box('HMI', 170), box('PLANT', 200));
  for (const n of CTRL) s.push(box(n));
  const viaBridge = CTRL.some((n) => S.catalog.nodes[n].openplc);
  s.push(
    viaBridge
      ? `<text x="20" y="490" class="lbl-s">OpenPLC mode: the I/O bridge (Modbus TCP master, every 50 ms) writes field inputs and peer data into each soft-PLC and copies its outputs to the field I/O (green) and to peers (blue: solid write, dashed read). Grey: HMI polling (500 ms).</text>`
      : `<text x="20" y="490" class="lbl-s">Green: controller &harr; field I/O (FC3/4/1/2 reads, FC15/16 output block writes, 100 ms scan). Blue solid: peer write (FC16 into peer's holding registers); blue dashed: peer read. Grey: HMI polling (500 ms).</text>`,
  );
  return `<svg viewBox="0 0 1240 500" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block">${s.join('')}</svg>`;
}

/** Controllers running as OpenPLC soft-PLCs: where OpenPLC Editor and the runtime web page find them. */
function plcPanel() {
  const plcs = CTRL.filter((n) => S.catalog.nodes[n].openplc);
  if (!plcs.length) return '';
  const rows = plcs
    .map((n) => {
      const o = S.catalog.nodes[n].openplc;
      return `<tr><td class="mono">${n}</td><td class="mono">${o.ip}</td><td class="mono">${esc(o.project)}</td><td><a href="http://localhost:${o.webPort}" target="_blank" rel="noopener">localhost:${o.webPort}</a></td></tr>`;
    })
    .join('');
  return `<h3 style="margin-top:12px">OpenPLC soft-PLCs</h3>
    <p style="color:var(--muted);font-size:11px;margin:2px 0 6px">The controller logic runs as IEC 61131-3 programs in OpenPLC Runtime v3. To watch it live, open the project folder in OpenPLC Editor,
      select the runtime IP (user / password: see config/network.json) and start the Debugger. The web page lists every located variable with its live value.</p>
    <table class="tbl"><tr><th>PLC</th><th>Editor IP</th><th>Project</th><th>Runtime web page</th></tr>${rows}</table>`;
}

export default {
  id: 'network',
  title: 'Network / Modbus',
  render(root) {
    const nodes = ['PLANT', ...CTRL];
    root.innerHTML = `<div class="cols" style="grid-template-columns:minmax(0,1.15fr) minmax(0,1fr)">
      <div class="col">
        <div class="panel grow" style="padding:4px;flex:1.5 1 0;min-height:300px">${topology()}</div>
        <div class="panel grow" style="flex:1 1 0;min-height:200px"><div class="scroll"><h3>HMI Modbus TCP client statistics</h3><div id="stats"></div>
          <h3 style="margin-top:12px">Controller diagnostics</h3><div id="cdiag"></div>${plcPanel()}</div></div>
      </div>
      <div class="col">
        <div class="panel grow"><h3>Modbus register explorer (live read)</h3>
          <div class="row"><select class="sel" id="xn">${nodes.map((n) => `<option>${n}</option>`).join('')}</select>
            <select class="sel" id="xa"><option value="hr">Holding registers (FC3)</option><option value="ir">Input registers (FC4)</option><option value="co">Coils (FC1)</option><option value="di">Discrete inputs (FC2)</option></select>
            start <input class="num" id="xs" value="0" style="width:60px"/> count <input class="num" id="xc" value="40" style="width:50px"/>
            <button class="btn primary" id="xr">Read</button><label><input type="checkbox" id="xauto"/> auto</label></div>
          <div id="xout" class="scroll" style="margin-top:8px"></div></div>
      <div class="panel grow"><h3>Register map</h3><div class="row"><select class="sel" id="mn">${nodes.map((n) => `<option>${n}</option>`).join('')}</select>
        <input class="txt" id="mq" placeholder="filter"/><span style="color:var(--muted);font-size:11px">Addresses are zero-based protocol addresses; Modicon reference shown for convenience. 32-bit values: float32 / uint32, high word first.</span></div>
        <div id="mout" class="scroll" style="margin-top:8px"></div></div>
      </div>
    </div>`;
    const tagAt = (node, area, addr) => S.catalog.nodes[node].tags.find((t) => t.area === area && (t.address === addr || ((t.type === 'f32' || t.type === 'u32') && t.address + 1 === addr)));
    const read = async () => {
      const node = root.querySelector('#xn').value;
      const area = root.querySelector('#xa').value;
      const start = Number(root.querySelector('#xs').value) || 0;
      const count = Number(root.querySelector('#xc').value) || 20;
      const r = await (await fetch(`/api/raw?node=${node}&area=${area}&start=${start}&count=${count}`)).json();
      if (!r.ok) {
        root.querySelector('#xout').innerHTML = `<p style="color:var(--trip)">${esc(r.error)}</p>`;
        return;
      }
      root.querySelector('#xout').innerHTML = `<table class="tbl"><tr><th>Addr</th><th>Ref</th><th class="r">Raw</th><th class="r">Hex</th><th>Tag</th><th class="r">Value</th></tr>${r.values
        .map((v, i) => {
          const a = start + i;
          const t = tagAt(node, area, a);
          const first = t && t.address === a;
          return `<tr><td class="mono">${a}</td><td class="mono">${MODICON[area] + a}</td><td class="r mono">${v}</td><td class="r mono">${area === 'co' || area === 'di' ? '' : `0x${Number(v).toString(16).padStart(4, '0')}`}</td>
          <td class="mono">${t ? `${esc(t.name)}${first ? '' : ' (lo)'}` : ''}</td><td class="r mono">${t && first ? esc(String(val(`${node}:${t.name}`)?.toFixed?.(3) ?? val(`${node}:${t.name}`))) : ''}</td></tr>`;
        })
        .join('')}</table>`;
    };
    root.querySelector('#xr').onclick = read;
    const map = () => {
      const node = root.querySelector('#mn').value;
      const q = root.querySelector('#mq').value.toLowerCase();
      const tags = S.catalog.nodes[node].tags.filter((t) => !q || t.name.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q));
      const iec = S.catalog.nodes[node].layout === 'openplc';
      root.querySelector('#mout').innerHTML = `<table class="tbl"><tr><th>Tag</th><th>Area</th><th class="r">Addr</th><th class="r">Ref</th>${iec ? '<th>IEC</th>' : ''}<th>Type</th><th>Units</th><th>Description</th><th>Written by</th></tr>${tags
        .map(
          (t) =>
            `<tr class="click" data-fp="tag:${node}:${t.name}"><td class="mono">${esc(t.name)}</td><td>${t.area.toUpperCase()}</td><td class="r mono">${t.address}</td><td class="r mono">${MODICON[t.area] + t.address}</td>${iec ? `<td class="mono">${t.plc?.loc ?? ''}</td>` : ''}<td>${t.type}</td><td>${esc(t.units || '')}</td><td>${esc(t.desc)}</td><td>${esc(t.owner === 'IO' ? 'I/O bridge' : t.owner || (t.ro ? node : 'HMI / operator'))}</td></tr>`,
        )
        .join('')}</table>`;
    };
    root.querySelector('#mn').onchange = map;
    root.querySelector('#mq').oninput = map;
    map();
    const refresh = () => {
      const d = S.diag;
      root.querySelector('#stats').innerHTML = `<table class="tbl"><tr><th>Node</th><th>Endpoint</th><th>Link</th><th class="r">Requests</th><th class="r">Errors</th><th class="r">Timeouts</th><th class="r">Latency ms</th></tr>${nodes
        .map((n) => {
          const x = d[n] || {};
          return `<tr><td class="mono">${n}</td><td class="mono">${esc(x.host || '')}:${x.port || ''}</td><td><span class="ind ${x.ok ? 'on' : 'bad on'}"></span></td><td class="r mono">${x.requests ?? 0}</td><td class="r mono">${x.errors ?? 0}</td><td class="r mono">${x.timeouts ?? 0}</td><td class="r mono">${(x.avgLatencyMs ?? 0).toFixed(1)}</td></tr>`;
        })
        .join('')}</table>`;
      root.querySelector('#cdiag').innerHTML = `<table class="tbl"><tr><th>Ctrl</th><th>Healthy</th><th>Field I/O</th><th>Peers</th><th class="r">Scan ms</th><th class="r">Scans</th></tr>${CTRL.map((n) => {
        const peers = Object.keys(S.values[n] || {})
          .filter((k) => k.startsWith('COMM_') && k !== 'COMM_PLANT')
          .map((k) => `<span class="ind ${val(`${n}:${k}`) ? 'on' : 'bad on'}" title="${k}"></span> ${k.slice(5)}`)
          .join(' ');
        return `<tr><td class="mono">${n}</td><td><span class="ind ${val(`${n}:HEALTHY`) ? 'on' : 'bad on'}"></span></td><td><span class="ind ${val(`${n}:COMM_PLANT`) ? 'on' : 'bad on'}"></span></td><td style="font-size:11px">${peers}</td><td class="r mono">${(val(`${n}:SCAN_MS`) ?? 0).toFixed(2)}</td><td class="r mono">${val(`${n}:SCAN_COUNT`) ?? 0}</td></tr>`;
      }).join('')}</table>`;
      for (const n of CTRL) {
        const io = root.querySelector(`#io-${n}`);
        if (io) io.setAttribute('stroke', val(`${n}:COMM_PLANT`) ? '#3fb950' : '#e5484d');
        const nb = root.querySelector(`#nb-${n}`);
        if (nb) nb.setAttribute('stroke', S.comm[n] && val(`${n}:HEALTHY`) ? '#4a5563' : '#e5484d');
        for (const [src, p] of Object.entries(S.catalog.peers)) {
          if (src !== n) continue;
          for (const t of [...new Set([...p.read, ...p.write])]) {
            const el = root.querySelector(`#pl-${src}-${t}`);
            if (el) el.setAttribute('stroke', val(`${src}:COMM_${t}`) === false ? '#e5484d' : '#4ea1ff');
          }
        }
      }
      for (const n of nodes) {
        const hl = root.querySelector(`#hl-${n}`);
        if (hl) hl.setAttribute('stroke', S.comm[n] ? '#2f3742' : '#e5484d');
      }
      if (root.querySelector('#xauto').checked) read();
    };
    refresh();
    let last = 0;
    const off = onUpdate(() => {
      if (Date.now() - last > 1000) {
        last = Date.now();
        refresh();
      }
    });
    return { dispose: off };
  },
};
