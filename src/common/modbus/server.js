import net from 'node:net';
import { EventEmitter } from 'node:events';
import { FC, EXCEPTION, LIMITS, buildFrame, splitFrames, packBits, unpackBits } from './protocol.js';

/**
 * Modbus TCP server (slave) backed by a DataStore.
 * Supports FC1, FC2, FC3, FC4, FC5, FC6, FC15 and FC16.
 *
 * Events:
 *   'write' ({ area, address, quantity, remote })  after a successful write request
 *   'client' ({ remote, connected })               on connect / disconnect
 */
export class ModbusServer extends EventEmitter {
  constructor(store, { unitId = 1, name = 'server' } = {}) {
    super();
    this.store = store;
    this.unitId = unitId;
    this.name = name;
    this.server = null;
    this.clients = new Map();
    this.stats = { requests: 0, exceptions: 0, bytesIn: 0, bytesOut: 0, byFunction: {} };
  }

  listen(port, host = '127.0.0.1') {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.#onConnection(socket));
      this.server.once('error', reject);
      this.server.listen(port, host, () => {
        this.server.off('error', reject);
        resolve(this.server.address());
      });
    });
  }

  close() {
    for (const { socket } of this.clients.values()) socket.destroy();
    this.clients.clear();
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  clientList() {
    return [...this.clients.entries()].map(([remote, c]) => ({ remote, requests: c.requests, since: c.since }));
  }

  #onConnection(socket) {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    const client = { socket, requests: 0, since: Date.now() };
    this.clients.set(remote, client);
    this.emit('client', { remote, connected: true });
    socket.setNoDelay(true);
    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      this.stats.bytesIn += chunk.length;
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      const { frames, rest, corrupt } = splitFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        client.requests++;
        const response = this.handleFrame(frame, remote);
        if (response) {
          this.stats.bytesOut += response.length;
          socket.write(response);
        }
      }
      if (corrupt) socket.destroy();
    });
    const drop = () => {
      if (this.clients.delete(remote)) this.emit('client', { remote, connected: false });
    };
    socket.on('close', drop);
    socket.on('error', drop);
  }

  /** Processes one request frame and returns the response frame (or null to stay silent). */
  handleFrame({ transactionId, protocolId, unitId, pdu }, remote = 'local') {
    if (protocolId !== 0) return null;
    // Unit 0 and 255 are accepted as "any unit" which is common practice for Modbus TCP.
    if (unitId !== this.unitId && unitId !== 0 && unitId !== 255) return null;
    this.stats.requests++;
    const fc = pdu[0];
    this.stats.byFunction[fc] = (this.stats.byFunction[fc] || 0) + 1;
    let body;
    try {
      body = this.#process(fc, pdu, remote);
    } catch (err) {
      body = this.#exception(fc, err.modbusCode ?? EXCEPTION.SERVER_DEVICE_FAILURE);
    }
    return buildFrame(transactionId, unitId, body);
  }

  #exception(fc, code) {
    this.stats.exceptions++;
    return Buffer.from([fc | 0x80, code]);
  }

  #process(fc, pdu, remote) {
    const fail = (code) => {
      const e = new Error('modbus exception');
      e.modbusCode = code;
      throw e;
    };
    if (pdu.length < 5 && fc !== undefined && [1, 2, 3, 4, 5, 6, 15, 16].includes(fc)) fail(EXCEPTION.ILLEGAL_DATA_VALUE);
    const addr = pdu.length >= 3 ? pdu.readUInt16BE(1) : 0;
    const qty = pdu.length >= 5 ? pdu.readUInt16BE(3) : 0;

    switch (fc) {
      case FC.READ_COILS:
      case FC.READ_DISCRETE_INPUTS: {
        const area = fc === FC.READ_COILS ? this.store.co : this.store.di;
        if (qty < 1 || qty > LIMITS.MAX_READ_BITS) fail(EXCEPTION.ILLEGAL_DATA_VALUE);
        if (addr + qty > area.length) fail(EXCEPTION.ILLEGAL_DATA_ADDRESS);
        const bits = packBits(area.subarray(addr, addr + qty));
        return Buffer.concat([Buffer.from([fc, bits.length]), bits]);
      }
      case FC.READ_HOLDING_REGISTERS:
      case FC.READ_INPUT_REGISTERS: {
        const area = fc === FC.READ_HOLDING_REGISTERS ? this.store.hr : this.store.ir;
        if (qty < 1 || qty > LIMITS.MAX_READ_REGS) fail(EXCEPTION.ILLEGAL_DATA_VALUE);
        if (addr + qty > area.length) fail(EXCEPTION.ILLEGAL_DATA_ADDRESS);
        const out = Buffer.alloc(2 + qty * 2);
        out[0] = fc;
        out[1] = qty * 2;
        for (let i = 0; i < qty; i++) out.writeUInt16BE(area[addr + i], 2 + i * 2);
        return out;
      }
      case FC.WRITE_SINGLE_COIL: {
        const value = pdu.readUInt16BE(3);
        if (value !== 0xff00 && value !== 0x0000) fail(EXCEPTION.ILLEGAL_DATA_VALUE);
        if (addr >= this.store.co.length) fail(EXCEPTION.ILLEGAL_DATA_ADDRESS);
        this.store.co[addr] = value === 0xff00 ? 1 : 0;
        this.emit('write', { area: 'co', address: addr, quantity: 1, remote });
        return Buffer.from(pdu.subarray(0, 5));
      }
      case FC.WRITE_SINGLE_REGISTER: {
        if (addr >= this.store.hr.length) fail(EXCEPTION.ILLEGAL_DATA_ADDRESS);
        this.store.hr[addr] = pdu.readUInt16BE(3);
        this.emit('write', { area: 'hr', address: addr, quantity: 1, remote });
        return Buffer.from(pdu.subarray(0, 5));
      }
      case FC.WRITE_MULTIPLE_COILS: {
        const byteCount = pdu[5];
        if (qty < 1 || qty > LIMITS.MAX_WRITE_BITS || byteCount !== Math.ceil(qty / 8) || pdu.length < 6 + byteCount) {
          fail(EXCEPTION.ILLEGAL_DATA_VALUE);
        }
        if (addr + qty > this.store.co.length) fail(EXCEPTION.ILLEGAL_DATA_ADDRESS);
        const bits = unpackBits(pdu.subarray(6, 6 + byteCount), qty);
        for (let i = 0; i < qty; i++) this.store.co[addr + i] = bits[i];
        this.emit('write', { area: 'co', address: addr, quantity: qty, remote });
        return Buffer.from(pdu.subarray(0, 5));
      }
      case FC.WRITE_MULTIPLE_REGISTERS: {
        const byteCount = pdu[5];
        if (qty < 1 || qty > LIMITS.MAX_WRITE_REGS || byteCount !== qty * 2 || pdu.length < 6 + byteCount) {
          fail(EXCEPTION.ILLEGAL_DATA_VALUE);
        }
        if (addr + qty > this.store.hr.length) fail(EXCEPTION.ILLEGAL_DATA_ADDRESS);
        for (let i = 0; i < qty; i++) this.store.hr[addr + i] = pdu.readUInt16BE(6 + i * 2);
        this.emit('write', { area: 'hr', address: addr, quantity: qty, remote });
        return Buffer.from(pdu.subarray(0, 5));
      }
      default:
        return fail(EXCEPTION.ILLEGAL_FUNCTION);
    }
  }
}
