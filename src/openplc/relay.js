import net from 'node:net';
import { createLogger } from '../common/logger.js';

/**
 * Loopback address relay for the OpenPLC soft-PLCs.
 *
 * OpenPLC Editor reaches a Runtime v3 by IP address only: REST on port 8443 and the live debugger
 * on Modbus TCP port 502. The eight runtimes run side by side in WSL on distinct ports, so this
 * relay gives each one its own loopback address on Windows (127.0.0.11, .12, ...) that answers on
 * the standard ports and forwards to the runtime's real ports on localhost.
 *
 * routes: [{ name, listenHost, listenPort, targetHost, targetPort }]
 */
export class LoopbackRelay {
  constructor(routes) {
    this.routes = routes;
    this.servers = [];
    this.log = createLogger('RELAY');
  }

  async start() {
    for (const r of this.routes) {
      const server = net.createServer((client) => {
        const upstream = net.createConnection({ host: r.targetHost, port: r.targetPort });
        client.setNoDelay(true);
        upstream.setNoDelay(true);
        client.pipe(upstream);
        upstream.pipe(client);
        const done = () => {
          client.destroy();
          upstream.destroy();
        };
        client.on('error', done);
        upstream.on('error', done);
        client.on('close', done);
        upstream.on('close', done);
      });
      await new Promise((resolve) => {
        server.once('error', (err) => {
          this.log.warn(`${r.name}: cannot listen on ${r.listenHost}:${r.listenPort} (${err.message})`);
          resolve();
        });
        server.listen(r.listenPort, r.listenHost, () => {
          this.servers.push(server);
          resolve();
        });
      });
    }
    this.log.info(`${this.servers.length}/${this.routes.length} loopback routes active`);
  }

  async stop() {
    await Promise.all(this.servers.map((s) => new Promise((r) => s.close(() => r()))));
    this.servers = [];
  }
}
