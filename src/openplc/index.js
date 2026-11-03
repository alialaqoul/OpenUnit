import { pathToFileURL } from 'node:url';
import { loadNetworkConfig, plcNodes } from '../common/config.js';
import { createLogger } from '../common/logger.js';
import { LoopbackRelay } from './relay.js';
import { PlcBridge } from './bridge.js';
import { superviseRuntimes, stopAllRuntimes } from './host.js';

/**
 * OpenPLC side of the simulator (started by the launcher when controllers.runtime = "openplc"):
 *   - starts the OpenPLC Runtime v3 instances in WSL (one soft-PLC per controller),
 *   - opens the loopback relay so OpenPLC Editor reaches each PLC at its own IP,
 *   - runs the I/O bridge between the plant, the PLCs and their peers.
 */
export async function startOpenPlc({ manageRuntimes = true } = {}) {
  const cfg = loadNetworkConfig();
  const log = createLogger('OPENPLC');
  const nodes = plcNodes();
  if (!nodes.length) throw new Error('No controller is configured to run on OpenPLC (controllers.runtime / openplc.controllers)');
  let supervisor = null;
  if (manageRuntimes) {
    // Long-lived: keeps WSL (and so the runtimes) alive and restarts a crashed runtime.
    supervisor = await superviseRuntimes(nodes, { onLine: (l) => log.info(l) });
  }
  const routes = nodes.flatMap((n) => {
    const p = cfg.openplc.nodes[n];
    return [
      { name: `${n} debugger`, listenHost: p.ip, listenPort: 502, targetHost: '127.0.0.1', targetPort: p.modbusPort },
      { name: `${n} runtime API`, listenHost: p.ip, listenPort: 8443, targetHost: '127.0.0.1', targetPort: p.apiPort },
    ];
  });
  const relay = new LoopbackRelay(routes);
  await relay.start();
  const bridge = new PlcBridge({ nodes });
  await bridge.start();
  for (const n of nodes) {
    const p = cfg.openplc.nodes[n];
    log.info(`${n}: OpenPLC ${p.ip} (Editor) | Modbus 127.0.0.1:${p.modbusPort} | web http://localhost:${p.webPort}`);
  }
  const stop = async ({ stopRuntimes = manageRuntimes } = {}) => {
    await bridge.stop();
    await relay.stop();
    if (stopRuntimes) await stopAllRuntimes();
    supervisor?.child.kill();
  };
  return { bridge, relay, stop };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const keep = process.argv.includes('--keep-runtimes');
  startOpenPlc()
    .then(({ stop }) => {
      let stopping = false;
      const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        await stop({ stopRuntimes: !keep });
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
