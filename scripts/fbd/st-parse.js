/**
 * Parser for the Structured Text subset of the controller programs (plc/src, plc/lib):
 * declarations (VAR blocks), assignments, function-block calls, IF / ELSIF / ELSE, CASE and FOR
 * with constant bounds, and expressions. Statement-level comments are kept, because they become
 * the comment boxes of the function block diagrams.
 *
 * Expression nodes:  { k: 'ref', name }  { k: 'lit', text }  { k: 'un', op, a }
 *                    { k: 'bin', op, a, b }  { k: 'call', fn, args: [{ name?, e }] }
 *                    { k: 'idx', name, index }            (array element, name[index])
 * Statement nodes:   { k: 'assign', target, e }  { k: 'fbcall', inst, args }
 *                    { k: 'if', branches: [{ cond, body }], els }
 *                    { k: 'case', e, branches: [{ labels: [{ lo, hi }], body }], els }
 *                    { k: 'for', v, from, to, by, body }   { k: 'while', cond, body }
 *                    { k: 'comment', text, trailing }
 * (WHILE is parsed for the library functions; a diagram cannot show it.)
 */

const KEYWORDS = new Set([
  'IF', 'THEN', 'ELSIF', 'ELSE', 'END_IF', 'CASE', 'OF', 'END_CASE', 'FOR', 'TO', 'BY', 'DO', 'END_FOR',
  'WHILE', 'END_WHILE', 'AND', 'OR', 'XOR', 'NOT', 'MOD', 'TRUE', 'FALSE',
]);

export function tokenize(src) {
  const toks = [];
  let i = 0;
  let line = 1;
  const push = (t, v, extra = {}) => toks.push({ t, v, line, ...extra });
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (src.startsWith('(*', i)) {
      const end = src.indexOf('*)', i + 2);
      if (end < 0) throw new Error(`line ${line}: unterminated comment`);
      const text = src.slice(i + 2, end);
      push('comment', text.trim(), { endLine: line + (text.match(/\n/g) || []).length });
      line += (text.match(/\n/g) || []).length;
      i = end + 2;
      continue;
    }
    let m;
    if ((m = /^[A-Za-z_][A-Za-z0-9_]*#[A-Za-z0-9_.+-]+/.exec(src.slice(i)))) {
      push('num', m[0]); // typed literal, e.g. REAL#1.0, T#5s
      i += m[0].length;
      continue;
    }
    // "1..4" stays an integer followed by the range operator: a real needs a digit after the point
    if ((m = /^\d+\.\d+(?:[eE][+-]?\d+)?|^\d+[eE][+-]?\d+|^\d+/.exec(src.slice(i)))) {
      push('num', m[0]);
      i += m[0].length;
      continue;
    }
    if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)))) {
      const up = m[0].toUpperCase();
      if (KEYWORDS.has(up)) push('kw', up);
      else push('id', m[0]);
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if ([':=', '=>', '<=', '>=', '<>', '..', '**'].includes(two)) {
      push('op', two);
      i += 2;
      continue;
    }
    if ('+-*/()=<>,;:[].'.includes(c)) {
      push('op', c);
      i++;
      continue;
    }
    throw new Error(`line ${line}: unexpected character '${c}'`);
  }
  push('eof', '');
  return toks;
}

class Parser {
  constructor(toks) {
    this.toks = toks;
    this.p = 0;
    this.lastLine = 0;
  }
  peek(o = 0) {
    let q = this.p;
    let n = o;
    for (;;) {
      while (this.toks[q].t === 'comment') q++;
      if (n-- === 0) return this.toks[q];
      q++;
    }
  }
  next() {
    while (this.toks[this.p].t === 'comment') this.p++;
    const t = this.toks[this.p++];
    this.lastLine = t.line;
    return t;
  }
  is(t, v) {
    const k = this.peek();
    return k.t === t && (v === undefined || k.v === v);
  }
  isKw(...vs) {
    const k = this.peek();
    return k.t === 'kw' && vs.includes(k.v);
  }
  expect(t, v) {
    const k = this.next();
    if (k.t !== t || (v !== undefined && k.v !== v)) throw new Error(`line ${k.line}: expected ${v ?? t}, found '${k.v}'`);
    return k;
  }
  accept(t, v) {
    if (this.is(t, v)) return this.next();
    return null;
  }
  /** Comments before the next token, as statements (trailing = on the line of the previous statement). */
  takeComments() {
    const out = [];
    while (this.toks[this.p].t === 'comment') {
      const c = this.toks[this.p++];
      out.push({ k: 'comment', text: c.v, trailing: c.line === this.lastLine && this.lastLine > 0 });
    }
    return out;
  }

  statements(...terminators) {
    const body = [];
    for (;;) {
      body.push(...this.takeComments());
      const k = this.peek();
      if (k.t === 'eof' || (k.t === 'kw' && terminators.includes(k.v))) return body;
      if (k.t === 'op' && k.v === ';') {
        this.next();
        continue;
      }
      // CASE labels end a branch body: "2:" / "2, 3:" / "1..4:"
      if (terminators.includes('#label') && k.t === 'num' && this.isCaseLabel()) return body;
      body.push(this.statement());
    }
  }
  isCaseLabel() {
    let o = 0;
    for (;;) {
      const t = this.peek(o);
      if (t.t !== 'num' && !(t.t === 'op' && t.v === '-')) return false;
      if (t.t === 'op') {
        o++;
        continue;
      }
      const n = this.peek(o + 1);
      if (n.t === 'op' && n.v === ':') return true;
      if (n.t === 'op' && (n.v === ',' || n.v === '..')) {
        o += 2;
        continue;
      }
      return false;
    }
  }
  statement() {
    if (this.isKw('IF')) return this.ifStmt();
    if (this.isKw('CASE')) return this.caseStmt();
    if (this.isKw('FOR')) return this.forStmt();
    if (this.isKw('WHILE')) {
      const line = this.next().line;
      const cond = this.expr();
      this.expect('kw', 'DO');
      const body = this.statements('END_WHILE');
      this.expect('kw', 'END_WHILE');
      this.accept('op', ';');
      return { k: 'while', cond, body, line };
    }
    const t = this.expect('id');
    let target = t.v;
    if (this.accept('op', '[')) {
      const index = this.expr();
      this.expect('op', ']');
      target = { k: 'idx', name: t.v, index };
    } else {
      while (this.accept('op', '.')) target += `.${this.expect('id').v}`;
    }
    if (this.accept('op', ':=')) {
      const e = this.expr();
      this.expect('op', ';');
      return { k: 'assign', target, e, line: t.line };
    }
    if (this.accept('op', '(')) {
      const args = this.args();
      this.expect('op', ';');
      return { k: 'fbcall', inst: target, args, line: t.line };
    }
    throw new Error(`line ${t.line}: expected := or ( after ${t.v}`);
  }
  ifStmt() {
    const line = this.expect('kw', 'IF').line;
    const branches = [];
    let cond = this.expr();
    this.expect('kw', 'THEN');
    for (;;) {
      const body = this.statements('ELSIF', 'ELSE', 'END_IF');
      branches.push({ cond, body });
      if (this.accept('kw', 'ELSIF')) {
        cond = this.expr();
        this.expect('kw', 'THEN');
        continue;
      }
      break;
    }
    let els = null;
    if (this.accept('kw', 'ELSE')) els = this.statements('END_IF');
    this.expect('kw', 'END_IF');
    this.accept('op', ';');
    return { k: 'if', branches, els, line };
  }
  caseStmt() {
    const line = this.expect('kw', 'CASE').line;
    const e = this.expr();
    this.expect('kw', 'OF');
    const branches = [];
    let els = null;
    for (;;) {
      this.takeComments();
      if (this.accept('kw', 'ELSE')) {
        els = this.statements('END_CASE');
        break;
      }
      if (this.isKw('END_CASE')) break;
      const labels = [];
      do {
        const lo = this.signedInt();
        let hi = lo;
        if (this.accept('op', '..')) hi = this.signedInt();
        labels.push({ lo, hi });
      } while (this.accept('op', ','));
      this.expect('op', ':');
      const body = this.statements('ELSE', 'END_CASE', '#label');
      branches.push({ labels, body });
    }
    this.expect('kw', 'END_CASE');
    this.accept('op', ';');
    return { k: 'case', e, branches, els, line };
  }
  signedInt() {
    const neg = this.accept('op', '-');
    const n = this.expect('num');
    if (!/^\d+$/.test(n.v)) throw new Error(`line ${n.line}: CASE label must be an integer`);
    return (neg ? -1 : 1) * Number(n.v);
  }
  forStmt() {
    const line = this.expect('kw', 'FOR').line;
    const v = this.expect('id').v;
    this.expect('op', ':=');
    const from = this.constInt();
    this.expect('kw', 'TO');
    const to = this.constInt();
    let by = 1;
    if (this.accept('kw', 'BY')) by = this.constInt();
    this.expect('kw', 'DO');
    const body = this.statements('END_FOR');
    this.expect('kw', 'END_FOR');
    this.accept('op', ';');
    return { k: 'for', v, from, to, by, body, line };
  }
  constInt() {
    const e = this.expr();
    const n = constValue(e);
    if (n === null) throw new Error(`line ${this.lastLine}: FOR bounds must be integer constants`);
    return n;
  }
  args() {
    const args = [];
    if (this.accept('op', ')')) return args;
    do {
      if (this.is('id') && this.peek(1).t === 'op' && (this.peek(1).v === ':=' || this.peek(1).v === '=>')) {
        const name = this.next().v;
        const out = this.next().v === '=>';
        args.push(out ? { name, out: true, target: this.expect('id').v } : { name, e: this.expr() });
      } else {
        args.push({ e: this.expr() });
      }
    } while (this.accept('op', ','));
    this.expect('op', ')');
    return args;
  }

  // precedence, lowest first: OR, XOR, AND, = <>, < > <= >=, + -, * / MOD, unary, **
  expr() {
    return this.binary(['OR'], () => this.binary(['XOR'], () => this.binary(['AND'], () => this.equality())));
  }
  binary(ops, sub) {
    let a = sub();
    while (this.peek().t === 'kw' && ops.includes(this.peek().v)) {
      const op = this.next().v;
      a = { k: 'bin', op, a, b: sub() };
    }
    return a;
  }
  opBinary(ops, sub) {
    let a = sub();
    while ((this.peek().t === 'op' && ops.includes(this.peek().v)) || (ops.includes('MOD') && this.isKw('MOD'))) {
      const op = this.next().v;
      a = { k: 'bin', op, a, b: sub() };
    }
    return a;
  }
  equality() {
    return this.opBinary(['=', '<>'], () => this.opBinary(['<', '>', '<=', '>='], () => this.additive()));
  }
  additive() {
    return this.opBinary(['+', '-'], () => this.opBinary(['*', '/', 'MOD'], () => this.unary()));
  }
  unary() {
    if (this.accept('kw', 'NOT')) return { k: 'un', op: 'NOT', a: this.unary() };
    if (this.accept('op', '-')) {
      const a = this.unary();
      if (a.k === 'lit' && /^\d/.test(a.text)) return { k: 'lit', text: `-${a.text}` };
      return { k: 'un', op: '-', a };
    }
    return this.power();
  }
  power() {
    const a = this.primary();
    if (this.accept('op', '**')) return { k: 'call', fn: 'EXPT', args: [{ e: a }, { e: this.unary() }] };
    return a;
  }
  primary() {
    const t = this.next();
    if (t.t === 'num') return { k: 'lit', text: t.v };
    if (t.t === 'kw' && (t.v === 'TRUE' || t.v === 'FALSE')) return { k: 'lit', text: t.v };
    // AND(a, b, c) - the operator called as a function, as generated ST does
    if (t.t === 'kw' && ['AND', 'OR', 'XOR', 'MOD'].includes(t.v) && this.accept('op', '(')) return { k: 'call', fn: t.v, args: this.args() };
    if (t.t === 'op' && t.v === '(') {
      const e = this.expr();
      this.expect('op', ')');
      return e;
    }
    if (t.t === 'id') {
      if (this.accept('op', '(')) return { k: 'call', fn: t.v, args: this.args() };
      if (this.accept('op', '[')) {
        const index = this.expr();
        this.expect('op', ']');
        return { k: 'idx', name: t.v, index };
      }
      let name = t.v;
      while (this.is('op', '.') && this.peek(1).t === 'id') {
        this.next();
        name += `.${this.next().v}`;
      }
      return { k: 'ref', name };
    }
    throw new Error(`line ${t.line}: unexpected '${t.v}' in expression`);
  }
}

/** Integer value of a constant expression, or null. */
export function constValue(e) {
  if (e.k === 'lit' && /^-?\d+$/.test(e.text)) return Number(e.text);
  return null;
}

/** Parses statements (a POU body). */
export function parseBody(src) {
  const p = new Parser(tokenize(src));
  const body = p.statements();
  p.expect('eof');
  return body;
}

/** Parses one expression. */
export function parseExpr(src) {
  const p = new Parser(tokenize(src));
  const e = p.expr();
  p.expect('eof');
  return e;
}

/**
 * Splits a POU source: header comment, kind + name (+ return type), declaration text, body text.
 * Variables: Map upper-name -> { name, type, cls ('input'|'output'|'inOut'|'local'|'const'), array }.
 */
export function splitPou(src) {
  const head = /^\s*(PROGRAM|FUNCTION_BLOCK|FUNCTION)\s+(\w+)(?:\s*:\s*(\w+))?/m.exec(src);
  if (!head) throw new Error('no PROGRAM / FUNCTION_BLOCK / FUNCTION header');
  const kind = head[1];
  const endKw = `END_${kind}`;
  const afterHead = head.index + head[0].length;
  const end = src.lastIndexOf(endKw);
  if (end < 0) throw new Error(`no ${endKw}`);
  const inner = src.slice(afterHead, end);
  // declarations run until the last END_VAR of the leading VAR ... END_VAR sequence
  const declRe = /\s*(?:\(\*[\s\S]*?\*\)\s*)*(VAR(?:_INPUT|_OUTPUT|_IN_OUT|_TEMP)?)(\s+CONSTANT)?\b([\s\S]*?)\bEND_VAR\b/y;
  let pos = 0;
  const blocks = [];
  for (;;) {
    declRe.lastIndex = pos;
    const m = declRe.exec(inner);
    if (!m) break;
    blocks.push({ section: m[1], constant: !!m[2], text: m[3] });
    pos = declRe.lastIndex;
  }
  const vars = new Map();
  for (const b of blocks) {
    const cls = b.constant
      ? 'const'
      : { VAR_INPUT: 'input', VAR_OUTPUT: 'output', VAR_IN_OUT: 'inOut' }[b.section] || 'local';
    const clean = b.text.replace(/\(\*[\s\S]*?\*\)/g, ' ');
    for (const m of clean.matchAll(/([A-Za-z_]\w*)\s*(?:AT\s+(%[\w.]+)\s*)?:\s*([^;:=]+?)\s*(?::=\s*([^;]+?))?\s*;/g)) {
      const typeText = m[3].trim();
      const arr = /^ARRAY\s*\[\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*\]\s*OF\s+(\w+)$/i.exec(typeText);
      vars.set(m[1].toUpperCase(), {
        name: m[1],
        type: arr ? arr[3].toUpperCase() : typeText.toUpperCase(),
        array: arr ? { lo: Number(arr[1]), hi: Number(arr[2]) } : null,
        cls,
        loc: m[2] ?? null,
        init: m[4]?.trim(),
      });
    }
  }
  return {
    kind,
    name: head[2],
    returnType: head[3]?.toUpperCase(),
    header: src.slice(0, head.index),
    declText: inner.slice(0, pos),
    bodyText: inner.slice(pos),
    vars,
  };
}
