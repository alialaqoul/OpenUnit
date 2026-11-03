/** HTML control helpers used by the screen side panels. */
import { val, write, pulse, onUpdate, esc, units, fmt, meta } from './core.js';
import { openFaceplate } from './faceplates.js';

export const kv = (label, k, { dp, u } = {}) =>
  `<span>${esc(label)}</span><span><span data-v="${k}"${dp !== undefined ? ` data-dp="${dp}"` : ''}>--</span> ${esc(u ?? units(k))}</span>`;

export const indRow = (label, k, kind = '') => `<div class="row" style="margin:3px 0"><span class="ind ${kind}" data-on="${k}"></span><span>${esc(label)}</span></div>`;

/** Button that writes a fixed value; `sel` highlights it when the tag equals that value. */
export const wbtn = (label, node, tag, value, { cls = '', sel = true, title = '' } = {}) =>
  `<button class="btn ${cls}" data-w="${node}|${tag}|${value}"${sel ? ' data-sel' : ''}${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</button>`;

export const pbtn = (label, node, tag, { cls = '', confirm = false } = {}) =>
  `<button class="btn ${cls}" data-${confirm ? 'confirm' : 'pulse'}="${node}|${tag}">${esc(label)}</button>`;

export const numSet = (node, tag, { w = 80 } = {}) =>
  `<input class="num" style="width:${w}px" data-in="${node}|${tag}" type="number" step="any"/><button class="btn small" data-set="${node}|${tag}">Set</button>`;

/** Wires all data-w / data-pulse / data-confirm / data-set controls inside root. */
export function attachControls(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !root.contains(b)) return;
    if (b.dataset.w) {
      const [n, t, v] = b.dataset.w.split('|');
      const m = meta(`${n}:${t}`);
      write(n, t, m?.type === 'bool' ? v === '1' || v === 'true' : Number(v), b.dataset.src);
    } else if (b.dataset.pulse) {
      const [n, t] = b.dataset.pulse.split('|');
      pulse(n, t);
    } else if (b.dataset.confirm) {
      const [n, t] = b.dataset.confirm.split('|');
      openFaceplate(`cmd:${n}:${t}`, e);
    } else if (b.dataset.set) {
      const [n, t] = b.dataset.set.split('|');
      const inp = root.querySelector(`[data-in="${b.dataset.set}"]`);
      if (inp) write(n, t, Number(inp.value));
    }
  });
  const refresh = () => {
    root.querySelectorAll('[data-in]').forEach((inp) => {
      if (document.activeElement === inp) return;
      const [n, t] = inp.dataset.in.split('|');
      const v = val(`${n}:${t}`);
      if (v !== undefined) inp.value = fmt(`${n}:${t}`).replace(/[^\d.-]/g, '') || v;
    });
    root.querySelectorAll('button[data-sel]').forEach((b) => {
      const [n, t, v] = b.dataset.w.split('|');
      const cur = val(`${n}:${t}`);
      b.classList.toggle('sel', typeof cur === 'boolean' ? cur === (v === '1' || v === 'true') : Number(cur) === Number(v));
    });
  };
  refresh();
  return onUpdate(refresh);
}

export function panel(title, inner, style = '') {
  return `<div class="panel" style="${style}"><h3>${esc(title)}</h3>${inner}</div>`;
}

/** Layout: SVG mimic on the left, control panels on the right. */
export function split(svgHtml, sideHtml, side = 360) {
  return `<div class="split" style="grid-template-columns:minmax(0,1fr) ${side}px">
    <div class="panel mimic">${svgHtml}</div><div class="col">${sideHtml}</div></div>`;
}
