/** SVG symbol library for the process mimics. Every helper returns an SVG markup string. */
import { units, esc } from './core.js';

const DEFS = `<defs>
  <radialGradient id="fireGrad" cx="50%" cy="55%" r="50%">
    <stop offset="0%" stop-color="#fff3b0" stop-opacity="0.95"/>
    <stop offset="35%" stop-color="#ffb02e" stop-opacity="0.85"/>
    <stop offset="75%" stop-color="#e2531b" stop-opacity="0.45"/>
    <stop offset="100%" stop-color="#7a1e0c" stop-opacity="0"/>
  </radialGradient>
  <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M0 0 L10 5 L0 10 z" fill="#9aa4b1"/>
  </marker>
</defs>`;

export function svgRoot(w, h, inner) {
  return `<svg class="screen-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${DEFS}${inner}</svg>`;
}

const pts = (p) => p.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');

/** Process line. cls: steam | rh | water | cond | gas | air | flue | cw | elec ; flow = KEY for animation */
export function pipe(points, cls, { flow, th = 1, arrow = false, thin = false } = {}) {
  return `<path class="pipe ${cls}${thin ? ' thin' : ''}" d="${pts(points)}"${flow ? ` data-flow="${flow}" data-th="${th}"` : ''}${arrow ? ' marker-end="url(#arrow)"' : ''}/>`;
}

export function txt(x, y, s, cls = 'lbl', anchor = 'start') {
  return `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${esc(s)}</text>`;
}

export function title(x, y, s) {
  return txt(x, y, s, 'title');
}

/** Value box bound to a tag (click opens the tag faceplate / trend). */
export function vbox(x, y, k, { w = 72, dp, label, lpos = 'top', u, fp } = {}) {
  const unit = u ?? units(k);
  let lab = '';
  if (label) {
    if (lpos === 'left') lab = txt(x - 5, y + 14, label, 'lbl-s', 'end');
    else lab = txt(x, y - 4, label, 'lbl-s');
  }
  return `${lab}<g class="vbox clickable" data-alm="${k}" data-fp="${fp || `tag:${k}`}">
    <rect x="${x}" y="${y}" width="${w}" height="20" rx="2"/>
    <text class="v" x="${x + w - 5}" y="${y + 14}" data-v="${k}"${dp !== undefined ? ` data-dp="${dp}"` : ''}>----</text>
    ${unit ? `<text class="u" x="${x + w + 4}" y="${y + 14}">${esc(unit)}</text>` : ''}
  </g>`;
}

/** Status text bound to an enum/bool tag. */
export function stext(x, y, k, { cls = 'lbl-b', anchor = 'start', on, off } = {}) {
  return `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}" data-v="${k}"${on ? ` data-on-text="${esc(on)}"` : ''}${off ? ` data-off-text="${esc(off)}"` : ''}>--</text>`;
}

const status = ({ node, dev, run, trip }) => {
  if (dev) return `data-st="${node}:${dev}" data-fp="dev:${node}:${dev}"`;
  if (run) return `data-run="${run}"${trip ? ` data-trip="${trip}"` : ''}`;
  return '';
};

export function pump(x, y, o) {
  const r = o.r || 16;
  return `<g class="dev clickable" ${status(o)} transform="translate(${x},${y})">
    <circle class="body" r="${r}"/>
    <path d="M${-r * 0.45} ${-r * 0.55} L${r * 0.6} 0 L${-r * 0.45} ${r * 0.55} Z" fill="#d7dde4" opacity="0.85"/>
    <text class="ilkmark" x="${r + 2}" y="${-r + 4}">I</text>
    ${o.label ? `<text class="tag" y="${r + 14}">${esc(o.label)}</text>` : ''}
  </g>`;
}

export function fan(x, y, o) {
  const r = o.r || 20;
  return `<g class="dev clickable" ${status(o)} transform="translate(${x},${y})">
    <circle class="body" r="${r}"/>
    <path d="M0 0 L${r * 0.8} ${-r * 0.3} A${r * 0.85} ${r * 0.85} 0 0 0 ${r * 0.3} ${-r * 0.8} Z M0 0 L${-r * 0.8} ${r * 0.3} A${r * 0.85} ${r * 0.85} 0 0 0 ${-r * 0.3} ${r * 0.8} Z" fill="#d7dde4" opacity="0.8"/>
    <text class="ilkmark" x="${r + 2}" y="${-r + 4}">I</text>
    ${o.label ? `<text class="tag" y="${r + 14}">${esc(o.label)}</text>` : ''}
  </g>`;
}

export function motorBox(x, y, o) {
  const w = o.w || 46;
  return `<g class="dev clickable" ${status(o)} transform="translate(${x},${y})">
    <rect class="body" x="${-w / 2}" y="-12" width="${w}" height="24" rx="3"/>
    <text x="0" y="4" text-anchor="middle" style="font-size:10px;font-weight:700">${esc(o.text || 'M')}</text>
    <text class="ilkmark" x="${w / 2 + 2}" y="-4">I</text>
    ${o.label ? `<text class="tag" y="27">${esc(o.label)}</text>` : ''}
  </g>`;
}

/**
 * Valve symbol. On/off valves bind to a device (dev) or plant status (open key);
 * control valves show their position (pos key) and open a loop/station faceplate (fp).
 */
export function valve(x, y, o = {}) {
  const s = o.size || 11;
  const v = o.orient === 'v';
  const body = v
    ? `M${-s / 1.5} ${-s} L${s / 1.5} ${-s} L0 0 Z M${-s / 1.5} ${s} L${s / 1.5} ${s} L0 0 Z`
    : `M${-s} ${-s / 1.5} L${-s} ${s / 1.5} L0 0 Z M${s} ${-s / 1.5} L${s} ${s / 1.5} L0 0 Z`;
  let attrs = '';
  if (o.dev) attrs = `data-st="${o.node}:${o.dev}" data-fp="dev:${o.node}:${o.dev}"`;
  else if (o.open) attrs = `data-run="${o.open}"`;
  else if (o.pos) attrs = `data-cls="${o.pos}|gt|0.5|st-open"${o.fp ? ` data-fp="${o.fp}"` : ''}`;
  if (o.fp && o.dev) attrs = attrs.replace(/data-fp="[^"]*"/, `data-fp="${o.fp}"`);
  const actuator = o.pos || o.ctrl ? `<path d="M0 0 L0 ${-s - 8}" stroke="#9aa4b1" stroke-width="1.5"/><path d="M${-8} ${-s - 8} A8 8 0 0 1 8 ${-s - 8} Z" fill="#30373f" stroke="#9aa4b1"/>` : '';
  const pos = o.pos ? `<text x="${o.posDx ?? 0}" y="${(o.posDy ?? s + 15)}" text-anchor="middle" class="lbl-s" data-v="${o.pos}" data-dp="0">--</text><text x="${(o.posDx ?? 0) + 14}" y="${o.posDy ?? s + 15}" class="lbl-s">%</text>` : '';
  return `<g class="dev clickable" ${attrs} transform="translate(${x},${y})">
    ${v ? '' : ''}${actuator}<path class="body" d="${body}"/>
    <text class="ilkmark" x="${s + 2}" y="${-s}">I</text>
    ${pos}${o.label ? `<text class="tag" x="${o.ldx ?? 0}" y="${o.ldy ?? -s - 12}">${esc(o.label)}</text>` : ''}
  </g>`;
}

export function vessel(x, y, w, h, { lvl, min = 0, max = 100, label, cls = '', rx = 6 } = {}) {
  const fill = lvl
    ? `<rect class="lvl-fill ${cls}" x="${x + 2}" y="${y + h - 2}" width="${w - 4}" height="0" data-bar="${lvl}" data-min="${min}" data-max="${max}" data-len="${h - 4}" data-y0="${y + 2}"/>`
    : '';
  return `<rect class="vessel" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>${fill}${label ? txt(x + w / 2, y - 6, label, 'lbl-b', 'middle') : ''}`;
}

export function bar(x, y, w, h, k, { min = 0, max = 100, cls = '', dir = 'v', label } = {}) {
  const fg =
    dir === 'h'
      ? `<rect class="bar-fg ${cls}" x="${x + 1}" y="${y + 1}" width="0" height="${h - 2}" data-bar="${k}" data-min="${min}" data-max="${max}" data-dir="h" data-len="${w - 2}"/>`
      : `<rect class="bar-fg ${cls}" x="${x + 1}" y="${y + h - 1}" width="${w - 2}" height="0" data-bar="${k}" data-min="${min}" data-max="${max}" data-len="${h - 2}" data-y0="${y + 1}"/>`;
  return `<rect class="bar-bg" x="${x}" y="${y}" width="${w}" height="${h}"/>${fg}${label ? txt(x + w / 2, y + h + 13, label, 'lbl-s', 'middle') : ''}`;
}

export function ind(x, y, k, { label, kind = '', r = 6, invert = false, ldx = 10 } = {}) {
  return `<circle class="ind-c ${kind}" cx="${x}" cy="${y}" r="${r}" data-on="${k}"${invert ? ' data-invert' : ''}/>${label ? txt(x + ldx, y + 4, label, 'lbl-s') : ''}`;
}

export function flame(x, y, k, s = 1) {
  return `<path class="flame" data-on="${k}" transform="translate(${x},${y}) scale(${s})" d="M0 -16 C7 -8 10 -2 8 5 C6 11 2 13 0 13 C-2 13 -6 11 -8 5 C-10 -2 -7 -8 0 -16 Z"/>`;
}

/** DCS-style function block tag: shows loop name and mode, opens the faceplate. */
export function loopTag(x, y, node, loop, { w = 92, kind = 'loop' } = {}) {
  return `<g class="clickable" data-fp="${kind}:${node}:${loop}" transform="translate(${x},${y})">
    <rect class="hit" x="0" y="0" width="${w}" height="18" rx="2" fill="#11161c" stroke="#4a5563"/>
    <text x="5" y="13" style="font-size:10px;font-family:var(--mono);fill:#b9c3cf">${esc(loop)}</text>
    <g class="mpill" data-mode="${node}:${loop}"><rect x="${w - 34}" y="3" width="30" height="12" rx="2"/><text x="${w - 19}" y="12">MAN</text></g>
  </g>`;
}

export function turbine(x, y, w, hIn, hOut, label) {
  const top = (hOut - hIn) / 2;
  return `<path class="equip" d="M${x} ${y + top} L${x + w} ${y} L${x + w} ${y + hOut} L${x} ${y + top + hIn} Z"/>${txt(x + w / 2, y + hOut / 2 + 5, label, 'lbl-b', 'middle')}`;
}

export function hx(x, y, w, h, label, cls = 'equip') {
  return `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>
    <path d="M${x + 8} ${y + h / 2} ${Array.from({ length: Math.floor((w - 16) / 12) }, (_, i) => `L${x + 14 + i * 12} ${y + (i % 2 ? h * 0.25 : h * 0.75)}`).join(' ')}" fill="none" stroke="#6c7682" stroke-width="1.5"/>
    ${label ? txt(x + w / 2, y + h + 14, label, 'lbl-s', 'middle') : ''}`;
}

export function panelBox(x, y, w, h, label) {
  return `<rect class="zone" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>${label ? txt(x + 8, y + 16, label, 'lbl') : ''}`;
}

export function button(x, y, w, label, fp, cls = '') {
  return `<g class="clickable ${cls}" data-fp="${fp}" transform="translate(${x},${y})">
    <rect class="hit" width="${w}" height="22" rx="3" fill="#252b33" stroke="#4a5563"/>
    <text x="${w / 2}" y="15" text-anchor="middle" style="font-size:11px;font-weight:600">${esc(label)}</text></g>`;
}
