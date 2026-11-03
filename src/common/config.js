import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, '..', '..');
export const CONFIG_DIR = path.join(ROOT_DIR, 'config');
export const IC_DIR = path.join(CONFIG_DIR, 'ic');

export const PLC_DIR = path.join(ROOT_DIR, 'plc');

export const CONTROLLER_NAMES = ['CCS', 'BMS', 'CMB', 'FWC', 'STC', 'DEH', 'GEN', 'BOP'];
export const NODE_NAMES = ['PLANT', ...CONTROLLER_NAMES];

let cached = null;

/**
 * Loads config/network.json once. Environment variable SIM_CONFIG can point elsewhere.
 *
 * controllers.runtime (or SIM_RUNTIME) selects how the eight controllers run:
 *   "node"    - simulated controllers in Node.js (src/controllers)
 *   "openplc" - IEC 61131-3 programs in OpenPLC Runtime v3 soft-PLCs (plc/); each such node
 *               then points at its runtime's Modbus TCP port (openplc.nodes).
 * openplc.controllers (or SIM_OPENPLC=BMS,BOP) limits OpenPLC to some controllers; the others
 * keep running in Node.js and exchange data with the PLCs as before.
 */
export function loadNetworkConfig() {
  if (cached) return cached;
  const file = process.env.SIM_CONFIG || path.join(CONFIG_DIR, 'network.json');
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  cfg.controllers ||= {};
  cfg.controllers.runtime = process.env.SIM_RUNTIME || cfg.controllers.runtime || 'node';
  cfg.plcNodes = [];
  if (cfg.controllers.runtime === 'openplc') {
    if (!cfg.openplc?.nodes) throw new Error(`${file}: controllers.runtime is "openplc" but there is no openplc.nodes section`);
    const only = process.env.SIM_OPENPLC ? process.env.SIM_OPENPLC.split(',').map((s) => s.trim().toUpperCase()) : cfg.openplc.controllers;
    cfg.plcNodes = CONTROLLER_NAMES.filter((n) => !only || only.includes(n));
    for (const n of cfg.plcNodes) {
      const p = cfg.openplc.nodes[n];
      if (!p) throw new Error(`${file}: openplc.nodes.${n} is missing`);
      // OpenPLC v3 answers one Modbus request per socket read: never pipeline to it.
      cfg.nodes[n] = { ...cfg.nodes[n], host: '127.0.0.1', port: p.modbusPort, maxInFlight: 1, runtime: 'openplc' };
    }
  }
  cached = cfg;
  return cached;
}

/** "node" or "openplc". */
export const controllerRuntime = () => loadNetworkConfig().controllers.runtime;

/** Controllers that run as OpenPLC soft-PLCs (empty in "node" mode). */
export const plcNodes = () => loadNetworkConfig().plcNodes;
