import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * OpenPLC Editor 4 on Windows: its command line (openplc-cli) and its list of recent projects.
 * openplc-cli is a .cmd shim around the Editor executable: the executable is called directly
 * (no cmd.exe quoting) with --cli.
 */
export function findEditor() {
  const local = process.env.LOCALAPPDATA;
  const exe = local && path.join(local, 'Programs', 'open-plc-editor', 'OpenPLC Editor.exe');
  return exe && existsSync(exe) ? exe : null;
}

export function findCli() {
  const shims = [process.env.OPENPLC_CLI, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'openplc-cli', 'openplc-cli.cmd')].filter(
    (c) => c && existsSync(c),
  );
  for (const shim of shims) {
    if (!shim.toLowerCase().endsWith('.cmd')) return { exe: shim, pre: [] };
    const m = /"([^"]+\.exe)"\s+"--cli"/i.exec(readFileSync(shim, 'utf8'));
    if (m && existsSync(m[1])) return { exe: m[1], pre: ['--cli'] };
  }
  return null;
}

/** The Editor is an Electron app: it must not inherit "run as plain Node" from an editor terminal. */
export function editorEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/** Runs openplc-cli. Resolves { code, out, err, json } (json: its last JSON line, or null). */
export function runCli(cli, args, env = editorEnv()) {
  return new Promise((resolve) => {
    const child = spawn(cli.exe, [...cli.pre, ...args], { env, windowsHide: true, shell: false });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const done = (code) => {
      let json = null;
      try {
        json = JSON.parse(out.trim().split('\n').filter((l) => l.startsWith('{')).pop());
      } catch {
        json = null;
      }
      resolve({ code, out, err, json });
    };
    child.on('close', done);
    child.on('error', (e) => {
      err += e.message;
      done(-1);
    });
  });
}

/**
 * Puts projects at the top of the Editor's recent projects (its start screen), most recent first.
 * @param {{ dir: string, name: string }[]} projects
 */
export function addRecentProjects(projects) {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  const file = path.join(appData, 'open-plc-editor', 'User', 'History', 'projects.json');
  let history = [];
  try {
    history = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(history)) history = [];
  } catch {
    history = [];
  }
  const now = Date.now();
  const norm = (p) => path.resolve(p).toLowerCase();
  const ours = new Set(projects.map((p) => norm(p.dir)));
  const kept = history.filter((h) => h && h.path && !ours.has(norm(h.path)));
  const added = projects.map((p, i) => {
    const old = history.find((h) => h && h.path && norm(h.path) === norm(p.dir));
    // a second apart, so the Editor keeps this order when it sorts by last opened
    const t = new Date(now - i * 1000).toISOString();
    return { name: p.name, path: p.dir, projectFilePath: path.join(p.dir, 'project.json'), createdAt: old?.createdAt ?? t, lastOpenedAt: t };
  });
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify([...added, ...kept], null, 2));
  return file;
}
