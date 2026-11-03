import net from 'node:net';
import { describe, it, expect } from 'vitest';
import { TagMap, readTag, writeTag, encodeTag, stIdent } from '../src/common/tags.js';
import { DataStore } from '../src/common/modbus/dataStore.js';
import { ModbusClient } from '../src/common/modbus/client.js';
import { buildFrame, splitFrames } from '../src/common/modbus/protocol.js';
import { buildMaps } from '../src/maps/index.js';
import { CONTROLLER_NAMES } from '../src/common/config.js';

describe('OpenPLC register layout', () => {
  const m = new TagMap('T', 'test', { layout: 'openplc' });
  m.ir('PV', 'bar', 'process value');
  m.hr('MODE', '', 'mode', { type: 'u16' });
  m.di('RUN', 'running');
  m.co('START', 'start', { pulse: true });
  m.ir('COUNT', '', 'counter', { type: 'u32' });

  it('puts numbers in %MD holding registers from 2048 and bits in %QX coils', () => {
    expect(m.get('PV')).toMatchObject({ area: 'hr', address: 2048, type: 'f32', ro: true, plc: { loc: '%MD0', iec: 'REAL' } });
    expect(m.get('MODE')).toMatchObject({ area: 'hr', address: 2050, type: 'i32', ro: false, plc: { loc: '%MD1', iec: 'DINT' } });
    expect(m.get('RUN')).toMatchObject({ area: 'co', address: 0, ro: true, plc: { loc: '%QX0.0', iec: 'BOOL' } });
    expect(m.get('START')).toMatchObject({ area: 'co', address: 1, ro: false, plc: { loc: '%QX0.1' } });
    expect(m.get('COUNT').plc).toMatchObject({ loc: '%MD2', iec: 'UDINT' });
    expect(m.range('hr')).toEqual({ start: 2048, count: 6 });
    expect(m.range('co')).toEqual({ start: 0, count: 2 });
  });

  it('round-trips signed 32-bit values high word first', () => {
    const t = m.get('MODE');
    const st = new DataStore(m.sizes());
    writeTag(st, t, -2);
    expect(readTag(st, t)).toBe(-2);
    expect(encodeTag(t, -2)).toEqual([0xffff, 0xfffe]);
    expect(encodeTag(t, 70000)).toEqual([1, 4464]);
  });

  it('maps tag names to Structured Text identifiers', () => {
    expect(stIdent('LIC_HW.MODE')).toBe('LIC_HW_MODE');
  });
});

describe('controller maps for OpenPLC', () => {
  const maps = buildMaps(CONTROLLER_NAMES);

  it('every controller fits the OpenPLC memory and has unique IEC identifiers', () => {
    for (const n of CONTROLLER_NAMES) {
      const map = maps[n];
      expect(map.layout).toBe('openplc');
      expect(map.range('hr').count / 2).toBeLessThan(1024);
      const ids = [...map.tags.values()].map((t) => t.plc.ident.toUpperCase());
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('derives each I/O image from the Structured Text source, without unknown points', () => {
    for (const n of CONTROLLER_NAMES) {
      const img = maps[n].plcImage;
      expect(img.unknown, n).toEqual([]);
      // every field output the program drives is owned by this controller in the plant map
      for (const q of img.plantOut) expect(maps.PLANT.get(q.dst).owner).toBe(n);
      for (const w of img.peerOut) expect(maps[w.peer].get(w.dst).owner).toBe(n);
    }
    const bop = maps.BOP.plcImage;
    expect(bop.plantIn.map((p) => p.src)).toContain('HW_LVL');
    expect(bop.plantOut.map((p) => p.dst)).toContain('MAKEUP_DMD');
    expect(maps.CCS.plcImage.peerOut.map((p) => `${p.peer}.${p.dst}`)).toContain('CMB.BLR_DMD_REM');
  });

  it('keeps the bridge-written image in one contiguous block per area', () => {
    for (const n of CONTROLLER_NAMES) {
      const map = maps[n];
      for (const area of ['hr', 'co']) {
        const r = map.ownerRange('IO', area);
        const io = [...map.tags.values()].filter((t) => t.owner === 'IO' && t.area === area);
        const words = io.reduce((a, t) => a + (t.type === 'bool' ? 1 : 2), 0);
        expect(r.count).toBe(words);
      }
    }
  });

  it('leaves the plant map and the native layout untouched', () => {
    const native = buildMaps([]);
    expect(native.CCS.layout).toBe('native');
    expect(native.CCS.get('PIC_TP.MODE')).toMatchObject({ area: 'hr', type: 'u16' });
    expect(maps.PLANT.get('MS_PRESS').area).toBe('ir');
  });
});

describe('Modbus client request limit', () => {
  it('sends one request at a time with maxInFlight 1 and reconnects after repeated timeouts', async () => {
    let inFlight = 0;
    let maxSeen = 0;
    let connections = 0;
    let silent = true; // first connection never answers
    const server = net.createServer((sock) => {
      connections++;
      const mute = silent;
      silent = false;
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const { frames, rest } = splitFrames(buf);
        buf = rest;
        for (const f of frames) {
          if (mute) continue;
          inFlight++;
          maxSeen = Math.max(maxSeen, inFlight);
          setTimeout(() => {
            inFlight--;
            const qty = f.pdu.readUInt16BE(3);
            const pdu = Buffer.alloc(2 + qty * 2);
            pdu[0] = 3;
            pdu[1] = qty * 2;
            sock.write(buildFrame(f.transactionId, f.unitId, pdu));
          }, 5);
        }
      });
      sock.on('error', () => {});
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const client = new ModbusClient({ port: server.address().port, timeoutMs: 100, reconnectMs: 50, maxInFlight: 1, reconnectAfterTimeouts: 2 });
    await client.connect();
    // the silent connection: two timeouts, then the client drops it and reconnects
    await Promise.allSettled([client.readHoldingRegisters(0, 2), client.readHoldingRegisters(0, 2)]);
    await new Promise((r) => setTimeout(r, 300));
    expect(connections).toBe(2);
    const res = await Promise.all(Array.from({ length: 6 }, () => client.readHoldingRegisters(0, 4)));
    expect(res).toHaveLength(6);
    expect(maxSeen).toBe(1);
    client.close();
    await new Promise((r) => server.close(r));
  });
});
