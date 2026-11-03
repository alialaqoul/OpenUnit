import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseBody, parseExpr, splitPou } from '../scripts/fbd/st-parse.js';
import { programToFbd } from '../scripts/fbd/st-to-fbd.js';
import { CONTROLLER_NAMES, ROOT_DIR } from '../src/common/config.js';

const lib = new Map();
for (const d of ['function-blocks', 'functions']) {
  const dir = path.join(ROOT_DIR, 'plc', 'lib', d);
  for (const f of readdirSync(dir)) {
    const pou = splitPou(readFileSync(path.join(dir, f), 'utf8'));
    lib.set(pou.name.toUpperCase(), pou);
  }
}

/** The diagram of a generated .fbd file: { nodes, edges } plus lookups. */
function diagram(text) {
  const body = JSON.parse(text.slice(text.search(/^\{/m), text.lastIndexOf('END_PROGRAM')));
  const nodes = body.rung.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, edges: body.rung.edges, byId, blocks: (name) => nodes.filter((n) => n.type === 'block' && n.data.variant.name === name) };
}

const program = (decl, body) => `PROGRAM P\n  VAR\n${decl}\n  END_VAR\n${body}\nEND_PROGRAM\n`;

describe('ST parser', () => {
  it('parses statements, keeps comments and marks trailing ones', () => {
    const body = parseBody(`
      (* ---- section *)
      x := a + b * c;   (* trailing *)
      IF a > 1.0 THEN y := TRUE; ELSIF b THEN y := FALSE; ELSE y := c[2]; END_IF;
      CASE s OF 1: z := 1; 2, 3: z := 2; 4..6: z := 3; ELSE z := 0; END_CASE;
      FOR i := 1 TO 4 DO t[i] := 0.0; END_FOR;
      T1(IN := x > 2.0, PT := 3.0);`);
    expect(body.map((s) => s.k)).toEqual(['comment', 'assign', 'comment', 'if', 'case', 'for', 'fbcall']);
    expect(body[2]).toMatchObject({ k: 'comment', trailing: true });
    expect(body[3].branches).toHaveLength(2);
    expect(body[4].branches[1].labels).toEqual([{ lo: 2, hi: 2 }, { lo: 3, hi: 3 }]);
    expect(body[4].branches[2].labels).toEqual([{ lo: 4, hi: 6 }]);
    expect(body[5]).toMatchObject({ v: 'i', from: 1, to: 4, by: 1 });
  });

  it('respects operator precedence and reads operators called as functions', () => {
    expect(parseExpr('a OR b AND NOT c')).toMatchObject({ op: 'OR', b: { op: 'AND', b: { k: 'un', op: 'NOT' } } });
    expect(parseExpr('a + b * c > d')).toMatchObject({ op: '>', a: { op: '+', b: { op: '*' } } });
    expect(parseExpr('AND(x, y, z)')).toMatchObject({ k: 'call', fn: 'AND' });
    expect(parseExpr('-2.5')).toEqual({ k: 'lit', text: '-2.5' });
  });

  it('splits a POU into declarations and body, with types, arrays and locations', () => {
    const pou = splitPou(program('    a AT %MD3 : REAL; (* x *)\n    arr : ARRAY[1..4] OF DINT;', '  a := 1.0;'));
    expect(pou.vars.get('A')).toMatchObject({ type: 'REAL', loc: '%MD3' });
    expect(pou.vars.get('ARR')).toMatchObject({ type: 'DINT', array: { lo: 1, hi: 4 } });
    expect(parseBody(pou.bodyText)).toHaveLength(1);
  });
});

describe('ST to function block diagram', () => {
  it('draws an assignment as a block tree ending in the output variable', () => {
    const { text } = programToFbd(program('    a : REAL;\n    b : REAL;\n    y : BOOL;', '  y := a + b > 10.0;'), lib);
    const d = diagram(text);
    const [gt] = d.blocks('GT');
    const [add] = d.blocks('ADD');
    const out = d.nodes.find((n) => n.type === 'output-variable');
    expect(out.data.variable.name).toBe('y');
    expect(d.edges).toContainEqual(expect.objectContaining({ source: gt.id, sourceHandle: 'OUT', target: out.id }));
    expect(d.edges).toContainEqual(expect.objectContaining({ source: add.id, target: gt.id, targetHandle: 'IN1' }));
    // children execute first
    expect(add.data.executionOrder).toBeLessThan(gt.data.executionOrder);
    expect(gt.data.executionOrder).toBeLessThan(out.data.executionOrder);
  });

  it('gates IF branches with branch conditions computed before the bodies', () => {
    const { text } = programToFbd(
      program('    a : BOOL;\n    b : BOOL;\n    x : REAL;', '  IF a THEN x := 1.0; ELSIF b THEN x := 2.0; ELSE x := x * 2.0; END_IF;'),
      lib,
    );
    expect(text).toMatch(/IF1 : BOOL;/);
    expect(text).toMatch(/IF1_2 : BOOL;/);
    expect(text).toMatch(/IF1_ELSE : BOOL;/);
    const d = diagram(text);
    const gates = d.nodes.filter((n) => n.type === 'output-variable' && /^IF1/.test(n.data.variable.name));
    const writes = d.nodes.filter((n) => n.type === 'output-variable' && n.data.variable.name === 'x');
    expect(Math.max(...gates.map((n) => n.data.executionOrder))).toBeLessThan(Math.min(...writes.map((n) => n.data.executionOrder)));
    // a copy of a constant is a MOVE with EN, an expression gets EN on its own block
    const moves = d.blocks('MOVE');
    expect(moves).toHaveLength(2);
    expect(moves.every((m) => m.data.executionControl)).toBe(true);
    expect(d.blocks('MUL')[0].data.executionControl).toBe(true);
  });

  it('works around what MatIEC lacks: NEG, EQ/NE on BOOL, EN on keyword operators', () => {
    const { text } = programToFbd(
      program('    a : BOOL;\n    b : BOOL;\n    c : BOOL;\n    r : REAL;\n    q : REAL;', '  q := -r;\n  c := a <> b;\n  IF c THEN a := b AND c; END_IF;'),
      lib,
    );
    const d = diagram(text);
    expect(d.blocks('NEG')).toHaveLength(0);
    expect(d.blocks('SUB')).toHaveLength(1);
    expect(d.blocks('NE')).toHaveLength(0);
    expect(d.blocks('XOR')).toHaveLength(1);
    expect(d.blocks('AND').some((n) => n.data.executionControl)).toBe(false);
    expect(d.blocks('MOVE')[0].data.executionControl).toBe(true);
  });

  it('unrolls FOR loops and leaves the loop variable at its final value', () => {
    const { text } = programToFbd(program('    i : INT;\n    t : ARRAY[1..3] OF REAL;', '  FOR i := 1 TO 3 DO t[i] := t[i] + 1.0; END_FOR;'), lib);
    const names = diagram(text)
      .nodes.filter((n) => n.type === 'output-variable')
      .map((n) => n.data.variable.name);
    expect(names).toEqual(['t[1]', 't[2]', 't[3]', 'i']);
  });

  it('calls function blocks with wired pins and takes the outputs read right after from the block', () => {
    const { text } = programToFbd(
      program('    RT : FB_TONS;\n    on : BOOL;\n    done : BOOL;', '  RT(IN := on, PT := 3.0, DTS := 0.05, INIT := FALSE);\n  done := RT.Q;'),
      lib,
    );
    const d = diagram(text);
    const [fb] = d.blocks('FB_TONS');
    expect(fb.data.variable.name).toBe('RT');
    expect(fb.data.variant.type).toBe('function-block');
    const out = d.nodes.find((n) => n.type === 'output-variable');
    expect(d.edges).toContainEqual(expect.objectContaining({ source: fb.id, sourceHandle: 'Q', target: out.id }));
  });

  it('lists the widest instance of an extensible block first, so the Editor types all its inputs', () => {
    const { text } = programToFbd(program('    a : BOOL;\n    b : BOOL;\n    c : BOOL;\n    x : BOOL;\n    y : BOOL;', '  x := a AND b;\n  y := a AND b AND c;'), lib);
    const first = diagram(text).nodes.find((n) => n.type === 'block' && n.data.variant.name === 'AND');
    expect(first.data.variant.variables.map((v) => v.name)).toContain('IN3');
  });

  it('converts every controller program into a consistent diagram', () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'fbd-test-'));
    try {
      const r = spawnSync(process.execPath, [path.join(ROOT_DIR, 'scripts', 'plc-build.js'), `--out=${out}`], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      for (const n of CONTROLLER_NAMES) {
        const dir = path.join(out, n, 'pous', 'programs');
        const [file] = readdirSync(dir).filter((f) => f.endsWith('.fbd'));
        const d = diagram(readFileSync(path.join(dir, file), 'utf8'));
        expect(d.nodes.length).toBeGreaterThan(100);
        for (const e of d.edges) {
          const src = d.byId.get(e.source);
          const dst = d.byId.get(e.target);
          expect(src && dst, `${n}: edge ${e.id}`).toBeTruthy();
          expect(src.data.handles.some((h) => h.id === e.sourceHandle), `${n}: ${e.sourceHandle} on ${src.id}`).toBe(true);
          expect(dst.data.handles.some((h) => h.id === e.targetHandle), `${n}: ${e.targetHandle} on ${dst.id}`).toBe(true);
        }
        // execution order ids are unique
        const eo = d.nodes.filter((x) => x.type === 'block' || x.type === 'output-variable').map((x) => x.data.executionOrder);
        expect(new Set(eo).size).toBe(eo.length);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
