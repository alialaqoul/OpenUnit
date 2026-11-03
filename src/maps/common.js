/** Diagnostic tags present in every controller (always at the start of the map). */
export function commonTags(m, peers = []) {
  m.ir('HEARTBEAT', '', 'Controller heartbeat counter', { type: 'u16' });
  m.ir('SCAN_MS', 'ms', 'Logic execution time', { dp: 2 });
  m.ir('SIM_DT', 's', 'Simulation time step of last scan', { dp: 3 });
  m.ir('IC_APPLIED', '', 'Last applied initial condition', { type: 'u16' });
  m.ir('SCAN_COUNT', '', 'Scan counter', { type: 'u32' });
  m.di('HEALTHY', 'Controller healthy');
  m.di('COMM_PLANT', 'Communication with field I/O', { alarm: { on: false, pri: 1, text: `${m.node} lost communication with field I/O` } });
  for (const p of peers) {
    m.di(`COMM_${p}`, `Communication with ${p}`, { alarm: { on: false, pri: 2, text: `${m.node} lost communication with ${p}` } });
  }
}

/** Heartbeat register that a peer writes into this controller's map. */
export function peerBlock(m, writer, fn) {
  m.section(writer, () => {
    m.hr(`${writer}_HB`, '', `${writer} heartbeat (peer write)`, { type: 'u16' });
    fn();
  });
}
