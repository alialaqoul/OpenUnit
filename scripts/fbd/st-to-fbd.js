/**
 * Structured Text program -> function block diagram (FBD) for OpenPLC Editor 4.
 *
 * Every statement becomes one network, in execution order:
 *   x := expr                    expression tree of standard blocks (AND, ADD, LIMIT, ...) -> x
 *   INST(a := e, ...)            the function block, its inputs wired; the statements right after
 *                                it that read its outputs (y := INST.Q) become output wires
 *   IF / ELSIF / ELSE, CASE      one network per branch computes the branch condition into a BOOL
 *                                (IF12, IF12_2, IF12_ELSE, CASE3_1, ...); the networks of the branch
 *                                body are gated with it: EN of their last block (MOVE for a plain copy)
 *   FOR i := a TO b              unrolled (constant bounds), i replaced by its value
 * The branch conditions are computed before the branch bodies run, exactly like the IF statement
 * evaluates its condition once. Execution order ids follow the statement order, so the Editor's
 * transpiler gives back the original program, statement for statement.
 */
import { parseBody, splitPou, constValue } from './st-parse.js';
import { STD_FUNCTIONS } from './std-functions.js';

// ------------------------------------------------------------------ geometry (OpenPLC Editor 4.3)
const BLOCK_PIN_Y = 48; // first pin, then every 48 px
const BLOCK_MAX_WIDTH = 216;
const VAR_HEIGHT = 32;
const VAR_PIN_Y = 16;
const VAR_INSET = 16;
const H_GAP = 48; // between a block and what feeds it
const V_GAP = 16; // between stacked inputs
const NET_GAP = 40; // between networks
const LEFT = 32;
const IN_OUT_MARKER_WIDTH = 16;
const INSTANCE_LABEL = 24; // room for the instance name above a function block

const variableWidth = (text) => {
  // the Editor's font needs about 8.5 px per character (upper case, digits and underscores)
  const needed = text.length * 8.5 + VAR_INSET + 8;
  return Math.min(320, Math.max(64, Math.ceil(needed / 16) * 16));
};
const commentWidth = (text, min, max) => Math.min(max, Math.max(min, Math.max(...text.split('\n').map((l) => l.length)) * 8 + 32));

const BIN_FN = { '+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV', MOD: 'MOD', '=': 'EQ', '<>': 'NE', '<': 'LT', '<=': 'LE', '>': 'GT', '>=': 'GE', AND: 'AND', OR: 'OR', XOR: 'XOR' };
const FLATTEN = new Set(['AND', 'OR', 'XOR', '+', '*']);

const baseType = (value) => ({ definition: /^ANY/.test(value) ? 'generic-type' : 'base-type', value });

/**
 * @param {string} programSrc  the complete PROGRAM (declarations included)
 * @param {Map<string, object>} pous  library POUs by upper-case name (splitPou results)
 */
export function programToFbd(programSrc, pous) {
  const pou = splitPou(programSrc);
  if (pou.kind !== 'PROGRAM') throw new Error('only PROGRAMs are converted');
  const body = parseBody(pou.bodyText);
  const conv = new Converter(pou, pous);
  conv.statements(body, null);
  const { nodes, edges } = conv.layout();
  const temps = conv.temps.map((t) => `    ${t.name} : BOOL; (* ${t.what.replace(/\*\)/g, '* )')} *)`);
  const decl = pou.declText.replace(/\s+$/, '') + (temps.length ? `\n  VAR\n    (* branch conditions of the function block diagram *)\n${temps.join('\n')}\n  END_VAR` : '');
  const json = JSON.stringify({ name: pou.name, rung: { comment: '', nodes, edges } }, null, 2);
  const text = `${pou.header.replace(/\s+$/, '')}\nPROGRAM ${pou.name}\n${decl.replace(/^\n+/, '')}\n\n${json}\nEND_PROGRAM\n`;
  return { text, name: pou.name, stats: { networks: conv.networks.length, blocks: conv.blockCount, temps: conv.temps.length } };
}

class Converter {
  constructor(pou, pous) {
    this.pou = pou;
    this.pous = pous;
    this.vars = pou.vars;
    this.networks = []; // { sinks: [node], comment?, note? }
    this.pending = []; // comments waiting for the next network
    this.temps = [];
    this.taken = new Set([...pou.vars.keys(), ...pous.keys()]);
    this.ifCount = 0;
    this.blockCount = 0;
    this.eo = 0;
  }

  // ---------------------------------------------------------------- names and types
  temp(base, what) {
    let name = base;
    for (let i = 2; this.taken.has(name.toUpperCase()); i++) name = `${base}_${i}`;
    this.taken.add(name.toUpperCase());
    this.temps.push({ name, what });
    return name;
  }
  fbType(inst) {
    const v = this.vars.get(inst.toUpperCase());
    const def = v && this.pous.get(v.type);
    return def && def.kind === 'FUNCTION_BLOCK' ? def : null;
  }
  /** IEC type of an expression, or null when it is an untyped literal / unknown. */
  typeOf(e) {
    switch (e.k) {
      case 'lit':
        if (/^(TRUE|FALSE)$/i.test(e.text)) return 'BOOL';
        if (/#/.test(e.text)) return e.text.split('#')[0].toUpperCase();
        return /[.eE]/.test(e.text) ? 'REAL' : null;
      case 'ref': {
        const [head, ...rest] = e.name.split('.');
        const v = this.vars.get(head.toUpperCase());
        if (!v) return null;
        if (!rest.length) return v.type;
        const fb = this.pous.get(v.type);
        return fb?.vars.get(rest[0].toUpperCase())?.type ?? null;
      }
      case 'idx':
        return this.vars.get(e.name.toUpperCase())?.type ?? null;
      case 'un':
        return e.op === 'NOT' ? this.typeOf(e.a) ?? 'BOOL' : this.typeOf(e.a);
      case 'bin':
        if (['=', '<>', '<', '<=', '>', '>='].includes(e.op)) return 'BOOL';
        return this.typeOf(e.a) ?? this.typeOf(e.b);
      case 'call': {
        const fn = e.fn.toUpperCase();
        const conv = /^(\w+?)_TO_(\w+)$/.exec(fn);
        if (conv) return conv[2];
        const user = this.pous.get(fn);
        if (user?.kind === 'FUNCTION') return user.returnType;
        const std = STD_FUNCTIONS[fn];
        if (std && !/^ANY/.test(std.ret)) return std.ret;
        for (const a of e.args) {
          const t = this.typeOf(a.e);
          if (t && t !== 'BOOL') return t;
        }
        return this.typeOf(e.args[e.args.length - 1].e);
      }
      default:
        return null;
    }
  }
  /** True when OpenPLC Editor's transpiler can work out the type of this expression by itself. */
  resolvable(e) {
    if (e.k === 'ref') return this.typeOf(e) !== null;
    if (e.k === 'lit') return /#/.test(e.text); // a bare TRUE / 1.0 has no type for the transpiler
    if (e.k === 'idx') return false;
    if (e.k === 'un') return this.resolvable(e.a);
    if (e.k === 'bin') return ['=', '<>', '<', '<=', '>', '>='].includes(e.op) || this.resolvable(e.a) || this.resolvable(e.b);
    if (e.k === 'call') {
      const fn = e.fn.toUpperCase();
      if (/_TO_/.test(fn) || this.pous.get(fn)?.kind === 'FUNCTION') return true;
      const std = STD_FUNCTIONS[fn];
      if (std && !/^ANY/.test(std.ret)) return true;
      return e.args.some((a) => this.resolvable(a.e));
    }
    return false;
  }
  text(e) {
    switch (e.k) {
      case 'lit':
        return e.text;
      case 'ref':
        return e.name;
      case 'idx':
        return `${e.name}[${this.text(e.index)}]`;
      case 'un':
        return e.op === 'NOT' ? `NOT ${this.text(e.a)}` : `-${this.text(e.a)}`;
      case 'bin':
        return `${this.text(e.a)} ${e.op} ${this.text(e.b)}`;
      case 'call':
        return `${e.fn}(${e.args.map((a) => (a.name ? `${a.name} := ${this.text(a.e)}` : this.text(a.e))).join(', ')})`;
      default:
        return '?';
    }
  }

  // ---------------------------------------------------------------- graph nodes
  leaf(text) {
    return { t: 'in', text };
  }
  block(fn, kind, vars, { instance = '', extensible = false } = {}) {
    this.blockCount++;
    return { t: 'blk', fn, kind, vars, instance, extensible, conn: new Map(), en: null, outs: [] };
  }
  /** Expression -> { node, pin } (the pin a consumer is wired to). */
  expr(e, typeHint = null) {
    switch (e.k) {
      case 'lit': {
        let text = e.text;
        // STruC++ (the Editor's compile check) takes REAL#1.0 / DINT#2, but not BOOL#TRUE or DINT#-1
        if (typeHint && !/#|^-/.test(text) && !/^(ANY|BOOL)/.test(typeHint)) text = `${typeHint}#${text}`;
        return { node: this.leaf(text), pin: 'output-variable' };
      }
      case 'ref':
      case 'idx':
        return { node: this.leaf(this.text(e)), pin: 'output-variable' };
      case 'un':
        if (e.op === 'NOT') return this.fnBlock('NOT', [{ e: e.a }]);
        // MatIEC has no NEG function (an IL operator there): -x is drawn as 0 - x
        return this.fnBlock('SUB', [{ e: { k: 'lit', text: /REAL/.test(this.typeOf(e.a) ?? 'REAL') ? '0.0' : '0' } }, { e: e.a }]);
      case 'bin': {
        const fn = BIN_FN[e.op];
        if (!fn) throw new Error(`operator ${e.op} has no FBD block`);
        // MatIEC has no EQ / NE for BOOL: a <> b is XOR, a = b is NOT XOR
        if ((e.op === '=' || e.op === '<>') && (this.typeOf(e.a) === 'BOOL' || this.typeOf(e.b) === 'BOOL')) {
          const x = { k: 'bin', op: 'XOR', a: e.a, b: e.b };
          return this.expr(e.op === '<>' ? x : { k: 'un', op: 'NOT', a: x });
        }
        const operands = FLATTEN.has(e.op) ? this.flatten(e, e.op) : [e.a, e.b];
        return this.fnBlock(fn, operands.map((x) => ({ e: x })));
      }
      case 'call':
        return this.fnBlock(e.fn.toUpperCase(), e.args);
      default:
        throw new Error(`cannot draw expression ${e.k}`);
    }
  }
  flatten(e, op) {
    if (e.k === 'bin' && e.op === op) return [...this.flatten(e.a, op), ...this.flatten(e.b, op)];
    return [e];
  }
  /** A standard, conversion or user function as a block, its arguments wired. */
  fnBlock(fn, args) {
    let params;
    let ret;
    let extensible = false;
    const user = this.pous.get(fn);
    const conv = /^(\w+?)_TO_(\w+)$/.exec(fn);
    if (user?.kind === 'FUNCTION') {
      params = [...user.vars.values()].filter((v) => v.cls === 'input').map((v) => ({ name: v.name, type: v.type }));
      ret = user.returnType;
    } else if (conv) {
      params = [{ name: 'IN', type: conv[1] }];
      ret = conv[2];
    } else if (STD_FUNCTIONS[fn]) {
      const std = STD_FUNCTIONS[fn];
      extensible = !!std.variadic;
      params = std.params.map((p) => ({ ...p }));
      ret = std.ret;
      if (extensible && args.length > params.length) {
        for (let i = params.length; i < args.length; i++) params.push({ name: `${std.prefix}${i + std.first}`, type: params[params.length - 1].type });
      }
    } else {
      throw new Error(`unknown function ${fn}`);
    }
    if (args.length > params.length) throw new Error(`${fn}: ${args.length} arguments, ${params.length} inputs`);
    const vars = [{ name: 'OUT', class: 'output', type: baseType(ret) }, ...params.map((p) => ({ name: p.name, class: 'input', type: baseType(p.type) }))];
    const b = this.block(fn, 'function', vars, { extensible });
    // literals of a generic group without any typed operand get their type written out, otherwise the
    // transpiler cannot type the block's output
    const generic = params.filter((p) => /^ANY/.test(p.type));
    const groupTyped = args.some((a, i) => generic.includes(params[i]) && this.resolvable(a.e));
    let groupType = null;
    if (!groupTyped) for (const a of args) groupType = groupType ?? this.typeOf(a.e);
    args.forEach((a, i) => {
      const p = a.name ? params.find((q) => q.name.toUpperCase() === a.name.toUpperCase()) : params[i];
      if (!p) throw new Error(`${fn} has no input ${a.name}`);
      const hint = /^ANY/.test(p.type) ? (groupTyped ? null : groupType) : null;
      b.conn.set(p.name, this.expr(a.e, hint));
    });
    return { node: b, pin: 'OUT' };
  }
  fbBlock(inst, args, def) {
    const vars = [];
    for (const v of def.vars.values()) {
      if (v.cls === 'input') vars.push({ name: v.name, class: 'input', type: baseType(v.type) });
      else if (v.cls === 'inOut') vars.push({ name: v.name, class: 'inOut', type: baseType(v.type) });
    }
    for (const v of def.vars.values()) if (v.cls === 'output') vars.push({ name: v.name, class: 'output', type: baseType(v.type) });
    const b = this.block(def.name, 'function-block', vars, { instance: inst });
    for (const a of args) {
      if (!a.name) throw new Error(`${inst}: function block arguments must be named`);
      const p = vars.find((v) => v.name.toUpperCase() === a.name.toUpperCase());
      if (!p) throw new Error(`${inst} (${def.name}) has no pin ${a.name}`);
      if (a.out) b.outs.push({ pin: p.name, target: a.target });
      else b.conn.set(p.name, this.expr(a.e));
    }
    return b;
  }

  // ---------------------------------------------------------------- statements
  network(sink, note) {
    const comments = this.pending;
    this.pending = [];
    this.networks.push({ sink, comments, note });
  }
  comment(text, trailing) {
    if (trailing && this.networks.length && !this.pending.length) {
      const last = this.networks[this.networks.length - 1];
      last.trail = last.trail ? `${last.trail}  ${text}` : text;
    } else this.pending.push(text.replace(/^-+\s*/, (m) => (m.length > 3 ? '## ' : m)));
  }
  /** cond: name of the BOOL that gates these statements (null: always executed). */
  statements(list, cond) {
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      switch (s.k) {
        case 'comment':
          this.comment(s.text, s.trailing);
          break;
        case 'assign':
          this.assign(s, cond);
          break;
        case 'fbcall':
          i = this.fbCall(list, i, cond);
          break;
        case 'if':
          this.ifStmt(s, cond);
          break;
        case 'case':
          this.caseStmt(s, cond);
          break;
        case 'for':
          this.forStmt(s, cond);
          break;
        default:
          throw new Error(`statement ${s.k}`);
      }
    }
  }
  targetText(target) {
    return typeof target === 'string' ? target : this.text(target);
  }
  assign(s, cond) {
    const target = this.targetText(s.target);
    const targetExpr = typeof s.target === 'string' ? { k: 'ref', name: s.target } : s.target;
    let src;
    if (!cond) src = this.expr(s.e);
    else if (this.resolvable(targetExpr) || this.resolvable(s.e)) {
      src = this.expr(s.e);
      // AND, OR, XOR, NOT and MOD are ST keywords: MatIEC only accepts them called with positional
      // arguments, so a gated result of one of them goes through a MOVE that carries the EN
      if (src.node.t === 'in' || /^(AND|OR|XOR|NOT|MOD)$/.test(src.node.fn)) src = this.wrap('MOVE', 'ANY', src);
    } else {
      // neither side typed for the transpiler (array elements)
      const type = this.typeOf(targetExpr) ?? this.typeOf(s.e);
      if (!type) throw new Error(`line ${s.line}: cannot work out the type of ${target}`);
      const gate = { k: 'ref', name: cond };
      if (type === 'BOOL') {
        // boolean logic, typed through the gate:  IF c THEN x := TRUE   ->  x := x OR c
        //   x := FALSE  ->  x := x AND NOT c          x := s  ->  x := (c AND s) OR (NOT c AND x)
        let e;
        if (s.e.k === 'lit' && /^TRUE$/i.test(s.e.text)) e = { k: 'bin', op: 'OR', a: targetExpr, b: gate };
        else if (s.e.k === 'lit') e = { k: 'bin', op: 'AND', a: targetExpr, b: { k: 'un', op: 'NOT', a: gate } };
        else e = { k: 'bin', op: 'OR', a: { k: 'bin', op: 'AND', a: gate, b: s.e }, b: { k: 'bin', op: 'AND', a: { k: 'un', op: 'NOT', a: gate }, b: targetExpr } };
        this.network({ t: 'out', text: target, src: this.expr(e) });
        return;
      }
      // numbers: a typed literal, or the value + a typed zero (MatIEC has no REAL_TO_REAL)
      src =
        s.e.k === 'lit' && !s.e.text.startsWith('-')
          ? this.wrap('MOVE', 'ANY', this.expr(s.e, type))
          : this.expr({ k: 'bin', op: '+', a: s.e, b: { k: 'lit', text: `${type}#${/REAL/.test(type) ? '0.0' : '0'}` } });
    }
    if (cond) src.node.en = { node: this.leaf(cond), pin: 'output-variable' };
    this.network({ t: 'out', text: target, src });
  }
  /** One-input block (MOVE or a conversion) in front of a source. */
  wrap(fn, type, src) {
    const b = this.block(fn, 'function', [
      { name: 'OUT', class: 'output', type: baseType(type) },
      { name: 'IN', class: 'input', type: baseType(type) },
    ]);
    b.conn.set('IN', src);
    return { node: b, pin: 'OUT' };
  }
  fbCall(list, i, cond) {
    const s = list[i];
    const def = this.fbType(s.inst);
    if (!def) throw new Error(`line ${s.line}: ${s.inst} is not a function block instance`);
    const b = this.fbBlock(s.inst, s.args, def);
    if (cond) b.en = { node: this.leaf(cond), pin: 'output-variable' };
    // y := INST.OUTPUT right after the call: wire it from the block
    let j = i + 1;
    while (j < list.length) {
      const n = list[j];
      if (n.k === 'comment' && n.trailing) {
        j++;
        continue;
      }
      if (n.k !== 'assign' || n.e.k !== 'ref') break;
      const [head, pin, more] = n.e.name.split('.');
      if (more || !pin || head.toUpperCase() !== s.inst.toUpperCase()) break;
      const out = [...def.vars.values()].find((v) => v.cls === 'output' && v.name.toUpperCase() === pin.toUpperCase());
      if (!out) break;
      b.outs.push({ pin: out.name, target: this.targetText(n.target) });
      j++;
    }
    this.network(b);
    for (let k = i + 1; k < j; k++) if (list[k].k === 'comment') this.comment(list[k].text, true);
    return j - 1;
  }
  /** Variables (upper-case base names) a statement list can change. */
  modifies(list, acc = new Set()) {
    for (const s of list) {
      if (s.k === 'assign') acc.add((typeof s.target === 'string' ? s.target.split('.')[0] : s.target.name).toUpperCase());
      else if (s.k === 'fbcall') {
        acc.add(s.inst.toUpperCase());
        const def = this.fbType(s.inst);
        for (const a of s.args) {
          const p = a.name && def?.vars.get(a.name.toUpperCase());
          if (p?.cls === 'inOut' && a.e.k === 'ref') acc.add(a.e.name.split('.')[0].toUpperCase());
          if (a.out) acc.add(a.target.toUpperCase());
        }
      } else if (s.k === 'if') {
        s.branches.forEach((b) => this.modifies(b.body, acc));
        if (s.els) this.modifies(s.els, acc);
      } else if (s.k === 'case') {
        s.branches.forEach((b) => this.modifies(b.body, acc));
        if (s.els) this.modifies(s.els, acc);
      } else if (s.k === 'for') {
        acc.add(s.v.toUpperCase());
        this.modifies(s.body, acc);
      }
    }
    return acc;
  }
  /**
   * Branch conditions of an IF / CASE: branch i runs when the parent condition holds, no earlier
   * branch was taken and its own condition is true. Returns the gate name of every branch.
   */
  branchGates(kind, conds, hasElse, parent, bodies, describe, suffixes) {
    const n = ++this.ifCount;
    // a single IF on a plain variable that its body does not change needs no extra BOOL
    if (!parent && conds.length === 1 && !hasElse && conds[0].k === 'ref' && !this.modifies(bodies[0]).has(conds[0].name.split('.')[0].toUpperCase())) {
      this.pending.push(describe(0));
      return [conds[0].name];
    }
    const gates = [];
    const all = [...conds, ...(hasElse ? [null] : [])];
    all.forEach((c, i) => {
      const suffix = c === null ? '_ELSE' : suffixes[i];
      const name = this.temp(`${kind}${n}${suffix}`, describe(i));
      const inputs = [];
      if (parent) inputs.push({ k: 'ref', name: parent });
      for (const g of gates) inputs.push({ k: 'un', op: 'NOT', a: { k: 'ref', name: g } });
      if (c) inputs.push(c);
      const e = inputs.length === 1 ? inputs[0] : { k: 'call', fn: 'AND', args: inputs.map((x) => ({ e: x })) };
      this.pending.push(describe(i));
      this.network({ t: 'out', text: name, src: this.expr(e) });
      gates.push(name);
    });
    return gates;
  }
  ifStmt(s, parent) {
    const conds = s.branches.map((b) => b.cond);
    const bodies = [...s.branches.map((b) => b.body), ...(s.els ? [s.els] : [])];
    const describe = (i) =>
      i < conds.length ? `${i === 0 ? 'IF' : 'ELSIF'} ${this.text(conds[i])} THEN` : `ELSE (none of: ${conds.map((c) => this.text(c)).join(' / ')})`;
    const gates = this.branchGates('IF', conds, !!s.els, parent, bodies, describe, conds.map((c, i) => (i ? `_${i + 1}` : '')));
    bodies.forEach((b, i) => this.statements(b, gates[i]));
  }
  caseStmt(s, parent) {
    const conds = s.branches.map((br) => {
      const terms = br.labels.map((l) =>
        l.lo === l.hi
          ? { k: 'bin', op: '=', a: s.e, b: { k: 'lit', text: String(l.lo) } }
          : { k: 'bin', op: 'AND', a: { k: 'bin', op: '>=', a: s.e, b: { k: 'lit', text: String(l.lo) } }, b: { k: 'bin', op: '<=', a: s.e, b: { k: 'lit', text: String(l.hi) } } },
      );
      return terms.reduce((a, b) => ({ k: 'bin', op: 'OR', a, b }));
    });
    const labelText = (br) => br.labels.map((l) => (l.lo === l.hi ? l.lo : `${l.lo}..${l.hi}`)).join(', ');
    const describe = (i) => (i < s.branches.length ? `CASE ${this.text(s.e)} OF ${labelText(s.branches[i])}:` : `CASE ${this.text(s.e)} OF ... ELSE`);
    const bodies = [...s.branches.map((b) => b.body), ...(s.els ? [s.els] : [])];
    const suffixes = s.branches.map((br) => `_${br.labels.map((l) => (l.lo === l.hi ? l.lo : `${l.lo}_${l.hi}`)).join('_')}`.replace(/-/g, 'M'));
    const gates = this.branchGates('CASE', conds, !!s.els, parent, bodies, describe, suffixes);
    bodies.forEach((b, i) => this.statements(b, gates[i]));
  }
  forStmt(s, cond) {
    if (s.by === 0) throw new Error(`line ${s.line}: FOR with BY 0`);
    let v = s.from;
    for (; s.by > 0 ? v <= s.to : v >= s.to; v += s.by) {
      this.pending.push(`FOR ${s.v} = ${v}`);
      this.statements(substitute(s.body, s.v.toUpperCase(), v), cond);
    }
    // the loop variable keeps the value that ended the loop, as in ST
    this.pending.push(`END_FOR: ${s.v} = ${v}`);
    this.assign({ k: 'assign', target: s.v, e: { k: 'lit', text: String(v) }, line: s.line }, cond);
  }

  // ---------------------------------------------------------------- layout and Editor nodes
  layout() {
    const nodes = [];
    const edges = [];
    let id = 0;
    const nextId = () => String(++id);
    let y = 24;
    const commentNode = (text, x, top, width) => {
      const lines = text.split('\n').length;
      const height = Math.max(32, 16 + lines * 18);
      const n = nextId();
      nodes.push({
        id: `COMMENT-${n}`,
        type: 'comment',
        position: { x, y: top },
        width,
        height,
        measured: { width, height },
        draggable: true,
        selectable: true,
        data: { numericId: n, draggable: true, selectable: true, deletable: true, content: text },
      });
      return height;
    };

    for (const net of this.networks) {
      for (const c of net.comments) {
        const section = c.startsWith('## ');
        const text = section ? c.slice(3).toUpperCase() : c;
        if (section) y += 24;
        y += commentNode(text, LEFT, y, commentWidth(text, 320, 960)) + 8;
      }
      // place the network with its right edge at x = 0, then shift it to the left margin
      const placed = [];
      const height = this.place(net.sink, 0, y, placed);
      const minX = Math.min(...placed.map((p) => p.x));
      const dx = LEFT - minX;
      let right = 0;
      for (const p of placed) {
        p.x += dx;
        right = Math.max(right, p.x + p.w);
      }
      for (const p of placed) this.emit(p, nodes, edges, nextId);
      if (net.trail) commentNode(net.trail, right + 32, y, commentWidth(net.trail, 128, 640));
      y += height + NET_GAP;
    }
    // The transpiler types a block's pins from the first instance of its type in the node list: for
    // the extensible blocks (AND, ADD, MAX, ...) that must be the one with the most inputs, otherwise
    // the inputs beyond it (IN3, IN4, ...) are not typed.
    const widest = new Map();
    for (const n of nodes) {
      if (n.type !== 'block' || !n.data.variant.extensible) continue;
      const w = widest.get(n.data.variant.name);
      if (!w || n.data.variant.variables.length > w.data.variant.variables.length) widest.set(n.data.variant.name, n);
    }
    const first = new Set(widest.values());
    // edges reference node ids assigned in emit
    return { nodes: [...first, ...nodes.filter((n) => !first.has(n))], edges: edges.map((e) => e()) };
  }
  /** Lays out the tree that ends in `n` with its right edge at `right` and its top at `top`. */
  place(n, right, top, placed) {
    if (n.t === 'out') {
      const w = variableWidth(n.text);
      const box = { n, x: right - w, y: top, w, h: VAR_HEIGHT };
      placed.push(box);
      const sub = this.placeSource(n.src, box.x - H_GAP, top + VAR_PIN_Y, top, placed);
      box.y = Math.max(top, sub.pinY - VAR_PIN_Y);
      n.eo = ++this.eo;
      return Math.max(sub.bottom, box.y + VAR_HEIGHT) - top;
    }
    // a function block call: outputs to the right of the block
    const outW = n.outs.length ? Math.max(...n.outs.map((o) => variableWidth(o.target))) : 0;
    const blockRight = outW ? right - outW - H_GAP : right;
    // the Editor writes the instance name above the block
    const sub = this.placeBlock(n, blockRight, top + INSTANCE_LABEL, placed);
    return sub.bottom - top;
  }
  /** Places the node behind a source so that its output pin lines up with pinY where possible. */
  placeSource(src, right, pinY, minTop, placed) {
    const n = src.node;
    if (n.t === 'in') {
      const w = variableWidth(n.text);
      const y = Math.max(pinY, minTop + VAR_PIN_Y);
      const box = { n, x: right - w, y: y - VAR_PIN_Y, w, h: VAR_HEIGHT };
      placed.push(box);
      return { pinY: y, bottom: box.y + VAR_HEIGHT };
    }
    const pinRel = blockGeometry(n).outPinY(src.pin);
    const res = this.placeBlock(n, right, Math.max(pinY - pinRel, minTop), placed);
    return { pinY: res.y + pinRel, bottom: res.bottom };
  }
  placeBlock(n, right, top, placed) {
    const g = blockGeometry(n);
    const box = { n, x: right - g.width, y: top, w: g.width, h: g.height, g };
    placed.push(box);
    // inputs, top to bottom in pin order
    let cursor = top;
    let bottom = top + g.height;
    const inputs = g.inputs.filter((name) => (name === 'EN' ? n.en : n.conn.has(name)));
    for (const name of inputs) {
      const src = name === 'EN' ? n.en : n.conn.get(name);
      const sub = this.placeSource(src, box.x - H_GAP, top + g.inPinY(name), cursor, placed);
      cursor = sub.bottom + V_GAP;
      bottom = Math.max(bottom, sub.bottom);
    }
    n.eo = ++this.eo;
    // output wires of a function block call
    for (const o of n.outs) {
      const w = variableWidth(o.target);
      const ob = { n: { t: 'out', text: o.target, src: { node: n, pin: o.pin } }, x: box.x + g.width + H_GAP, y: top + g.outPinY(o.pin) - VAR_PIN_Y, w, h: VAR_HEIGHT };
      ob.n.eo = ++this.eo;
      placed.push(ob);
      bottom = Math.max(bottom, ob.y + VAR_HEIGHT);
    }
    return { y: top, bottom };
  }
  /** Writes one placed node in the Editor's format and queues the edges into it. */
  emit(p, nodes, edges, nextId) {
    const num = nextId();
    const n = p.n;
    const pos = { x: Math.round(p.x), y: Math.round(p.y) };
    const handle = (id, type, side, relX, relY, style) => ({
      id,
      position: side,
      type,
      ...(style ? { style } : {}),
      glbPosition: { x: pos.x + relX, y: pos.y + relY },
      relPosition: { x: relX, y: relY },
    });
    if (n.t === 'in' || n.t === 'out') {
      const isIn = n.t === 'in';
      const h = isIn ? handle('output-variable', 'source', 'right', p.w - VAR_INSET, VAR_PIN_Y) : handle('input-variable', 'target', 'left', 0, VAR_PIN_Y);
      const type = isIn ? 'input-variable' : 'output-variable';
      n.id = `${isIn ? 'INPUT' : 'OUTPUT'}-VARIABLE-${num}`;
      nodes.push({
        id: n.id,
        type,
        position: pos,
        width: p.w,
        height: VAR_HEIGHT,
        measured: { width: p.w, height: VAR_HEIGHT },
        draggable: true,
        selectable: true,
        data: {
          handles: [h],
          inputHandles: isIn ? [] : [h],
          outputHandles: isIn ? [h] : [],
          inputConnector: isIn ? undefined : h,
          outputConnector: isIn ? h : undefined,
          numericId: num,
          variable: { name: n.text },
          executionOrder: isIn ? 0 : n.eo,
          variant: type,
          negated: false,
          draggable: true,
          selectable: true,
          deletable: true,
        },
      });
      if (!isIn) edges.push(this.edge(n.src, n));
      return;
    }
    const g = p.g;
    const left = g.inputs.map((name, i) => handle(name, 'target', 'left', 0, BLOCK_PIN_Y + i * BLOCK_PIN_Y, { top: BLOCK_PIN_Y + i * BLOCK_PIN_Y, left: 0 }));
    const rightH = g.outputs.map((name, i) => handle(name, 'source', 'right', g.width, BLOCK_PIN_Y + i * BLOCK_PIN_Y, { top: BLOCK_PIN_Y + i * BLOCK_PIN_Y, right: 0 }));
    n.id = `BLOCK-${num}`;
    nodes.push({
      id: n.id,
      type: 'block',
      position: pos,
      width: g.width,
      height: g.height,
      measured: { width: g.width, height: g.height },
      draggable: true,
      selectable: true,
      data: {
        handles: [...left, ...rightH],
        inputHandles: left,
        outputHandles: rightH,
        inputConnector: left[0],
        outputConnector: rightH[0],
        numericId: num,
        variant: { name: n.fn, type: n.kind, variables: g.variables, documentation: '', extensible: n.extensible },
        variable: { name: n.instance },
        executionOrder: n.eo,
        executionControl: !!n.en,
        draggable: true,
        selectable: true,
        deletable: true,
      },
    });
    for (const name of g.inputs) {
      const src = name === 'EN' ? n.en : n.conn.get(name);
      if (src) edges.push(this.edge(src, n, name));
    }
  }
  edge(src, target, targetHandle = 'input-variable') {
    return () => ({
      id: `xy-edge__${src.node.id}${src.pin}-${target.id}${targetHandle}`,
      source: src.node.id,
      sourceHandle: src.pin,
      target: target.id,
      targetHandle,
      type: 'smoothstep',
    });
  }
}

/** Pin layout of a block, as OpenPLC Editor draws it (getBlockSize / getBlockVariantAndExecutionControl). */
function blockGeometry(n) {
  if (n.geom) return n.geom;
  let vars = n.vars.filter((v) => v.name !== 'EN' && v.name !== 'ENO');
  if (n.en) {
    vars = [
      { name: 'EN', class: 'input', type: baseType('BOOL') },
      { name: 'ENO', class: 'output', type: baseType('BOOL') },
      ...vars,
    ];
  }
  const ins = vars.filter((v) => v.class === 'input' || v.class === 'inOut');
  const outs = vars.filter((v) => v.class === 'output');
  const inW = Math.max(0, ...ins.map((v) => v.name.length * 12 + (v.class === 'inOut' ? IN_OUT_MARKER_WIDTH : 0)));
  const outW = Math.max(0, ...outs.map((v) => v.name.length * 12));
  const width = Math.min(Math.max(inW + 12 + outW, n.fn.length * 12), BLOCK_MAX_WIDTH);
  const height = BLOCK_PIN_Y + 24 + Math.max(ins.length - 1, outs.length - 1, 0) * BLOCK_PIN_Y;
  const inputs = ins.map((v) => v.name);
  const outputs = outs.map((v) => v.name);
  n.geom = {
    variables: vars,
    inputs,
    outputs,
    width,
    height,
    inPinY: (name) => BLOCK_PIN_Y + inputs.indexOf(name) * BLOCK_PIN_Y,
    outPinY: (name) => BLOCK_PIN_Y + outputs.indexOf(name) * BLOCK_PIN_Y,
  };
  return n.geom;
}

/** Copy of a statement list with the loop variable replaced by its value. */
function substitute(list, v, value) {
  const ex = (e) => {
    if (!e || typeof e !== 'object') return e;
    switch (e.k) {
      case 'ref':
        return e.name.toUpperCase() === v ? { k: 'lit', text: String(value) } : e;
      case 'idx': {
        const index = ex(e.index);
        const c = constValue(index) ?? foldInt(index);
        return { k: 'idx', name: e.name, index: c === null ? index : { k: 'lit', text: String(c) } };
      }
      case 'un':
        return { ...e, a: ex(e.a) };
      case 'bin':
        return { ...e, a: ex(e.a), b: ex(e.b) };
      case 'call':
        return { ...e, args: e.args.map((a) => ({ ...a, e: a.e && ex(a.e) })) };
      default:
        return e;
    }
  };
  const st = (s) => {
    switch (s.k) {
      case 'assign':
        return { ...s, target: typeof s.target === 'string' ? s.target : ex(s.target), e: ex(s.e) };
      case 'fbcall':
        return { ...s, args: s.args.map((a) => ({ ...a, e: a.e && ex(a.e) })) };
      case 'if':
        return { ...s, branches: s.branches.map((b) => ({ cond: ex(b.cond), body: b.body.map(st) })), els: s.els && s.els.map(st) };
      case 'case':
        return { ...s, e: ex(s.e), branches: s.branches.map((b) => ({ ...b, body: b.body.map(st) })), els: s.els && s.els.map(st) };
      case 'for':
        return { ...s, body: s.body.map(st) };
      default:
        return s;
    }
  };
  return list.map(st);
}

function foldInt(e) {
  if (e.k !== 'bin' || !['+', '-', '*'].includes(e.op)) return null;
  const a = constValue(e.a) ?? foldInt(e.a);
  const b = constValue(e.b) ?? foldInt(e.b);
  if (a === null || b === null) return null;
  return e.op === '+' ? a + b : e.op === '-' ? a - b : a * b;
}
