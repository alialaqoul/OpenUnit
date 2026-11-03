import net from 'node:net';
import { EventEmitter } from 'node:events';
import { FC, LIMITS, EXCEPTION_TEXT, buildFrame, splitFrames, packBits, unpackBits } from './protocol.js';

export class ModbusError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/**
 * Promise based Modbus TCP client (master) with request pipelining, timeouts and
 * automatic reconnection. All addresses are zero-based protocol addresses.
 *
 * maxInFlight limits outstanding requests per connection; servers that handle one frame per
 * socket read (OpenPLC Runtime v3) need 1. Further requests wait in a queue.
 * After reconnectAfterTimeouts consecutive timeouts the connection is dropped and re-opened: a
 * server can accept a socket and then never serve it.
 *
 * Events: 'connect', 'disconnect', 'error'
 */
export class ModbusClient extends EventEmitter {
  constructor({ host = '127.0.0.1', port = 502, unitId = 1, timeoutMs = 1000, reconnectMs = 1000, name = 'client', maxInFlight = Infinity, reconnectAfterTimeouts = 3 } = {}) {
    super();
    Object.assign(this, { host, port, unitId, timeoutMs, reconnectMs, name, maxInFlight, reconnectAfterTimeouts });
    this.consecutiveTimeouts = 0;
    this.queue = [];
    this.socket = null;
    this.connected = false;
    this.closing = false;
    this.tid = 0;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.reconnectTimer = null;
    this.stats = { requests: 0, responses: 0, errors: 0, timeouts: 0, reconnects: 0, lastLatencyMs: 0, avgLatencyMs: 0 };
  }

  /** Starts connecting; resolves on first successful connection (keeps retrying in background). */
  connect() {
    this.closing = false;
    return new Promise((resolve) => {
      const onConnect = () => {
        this.off('connect', onConnect);
        resolve();
      };
      this.on('connect', onConnect);
      this.#open();
    });
  }

  #open() {
    if (this.socket || this.closing) return;
    const socket = net.createConnection({ host: this.host, port: this.port });
    this.socket = socket;
    socket.setNoDelay(true);
    socket.on('connect', () => {
      this.connected = true;
      this.emit('connect');
    });
    socket.on('data', (chunk) => this.#onData(chunk));
    socket.on('error', (err) => {
      this.lastError = err.message;
      if (this.listenerCount('error')) this.emit('error', err);
    });
    socket.on('close', () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.socket = null;
      this.buffer = Buffer.alloc(0);
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new ModbusError('Connection closed', 'ECLOSED'));
      }
      this.pending.clear();
      for (const q of this.queue.splice(0)) q.reject(new ModbusError('Connection closed', 'ECLOSED'));
      if (wasConnected) this.emit('disconnect');
      if (!this.closing) {
        this.stats.reconnects++;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.#open(), this.reconnectMs);
      }
    });
  }

  close() {
    this.closing = true;
    clearTimeout(this.reconnectTimer);
    if (this.socket) this.socket.destroy();
  }

  #onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const { frames, rest } = splitFrames(this.buffer);
    this.buffer = rest;
    for (const frame of frames) {
      const p = this.pending.get(frame.transactionId);
      if (!p) continue;
      this.pending.delete(frame.transactionId);
      clearTimeout(p.timer);
      const latency = Date.now() - p.sent;
      this.consecutiveTimeouts = 0;
      this.stats.responses++;
      this.stats.lastLatencyMs = latency;
      this.stats.avgLatencyMs = this.stats.avgLatencyMs * 0.95 + latency * 0.05;
      const fc = frame.pdu[0];
      if (fc & 0x80) {
        this.stats.errors++;
        const code = frame.pdu[1];
        p.reject(new ModbusError(`Modbus exception ${code}: ${EXCEPTION_TEXT[code] || 'unknown'}`, code));
      } else {
        p.resolve(frame.pdu);
      }
    }
    this.#drain();
  }

  #drain() {
    while (this.queue.length && this.pending.size < this.maxInFlight && this.connected) {
      const q = this.queue.shift();
      this.#send(q.pdu).then(q.resolve, q.reject);
    }
  }

  request(pdu) {
    if (!this.connected || !this.socket) {
      this.stats.errors++;
      return Promise.reject(new ModbusError(`Not connected to ${this.host}:${this.port}`, 'ENOTCONN'));
    }
    if (this.pending.size >= this.maxInFlight) {
      return new Promise((resolve, reject) => this.queue.push({ pdu, resolve, reject }));
    }
    return this.#send(pdu);
  }

  #send(pdu) {
    this.tid = (this.tid + 1) & 0xffff;
    const tid = this.tid;
    this.stats.requests++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(tid)) {
          this.stats.timeouts++;
          reject(new ModbusError(`Timeout after ${this.timeoutMs} ms`, 'ETIMEDOUT'));
          if (++this.consecutiveTimeouts >= this.reconnectAfterTimeouts && this.socket) {
            this.consecutiveTimeouts = 0;
            this.socket.destroy(); // 'close' reconnects
            return;
          }
          this.#drain();
        }
      }, this.timeoutMs);
      this.pending.set(tid, { resolve, reject, timer, sent: Date.now() });
      this.socket.write(buildFrame(tid, this.unitId, pdu));
    });
  }

  async #readBits(fc, address, quantity) {
    const pdu = Buffer.alloc(5);
    pdu[0] = fc;
    pdu.writeUInt16BE(address, 1);
    pdu.writeUInt16BE(quantity, 3);
    const res = await this.request(pdu);
    return unpackBits(res.subarray(2), quantity);
  }

  async #readRegs(fc, address, quantity) {
    const pdu = Buffer.alloc(5);
    pdu[0] = fc;
    pdu.writeUInt16BE(address, 1);
    pdu.writeUInt16BE(quantity, 3);
    const res = await this.request(pdu);
    const out = new Array(quantity);
    for (let i = 0; i < quantity; i++) out[i] = res.readUInt16BE(2 + i * 2);
    return out;
  }

  readCoils(address, quantity) {
    return this.#readBits(FC.READ_COILS, address, quantity);
  }

  readDiscreteInputs(address, quantity) {
    return this.#readBits(FC.READ_DISCRETE_INPUTS, address, quantity);
  }

  readHoldingRegisters(address, quantity) {
    return this.#readRegs(FC.READ_HOLDING_REGISTERS, address, quantity);
  }

  readInputRegisters(address, quantity) {
    return this.#readRegs(FC.READ_INPUT_REGISTERS, address, quantity);
  }

  async writeSingleCoil(address, value) {
    const pdu = Buffer.alloc(5);
    pdu[0] = FC.WRITE_SINGLE_COIL;
    pdu.writeUInt16BE(address, 1);
    pdu.writeUInt16BE(value ? 0xff00 : 0x0000, 3);
    await this.request(pdu);
  }

  async writeSingleRegister(address, value) {
    const pdu = Buffer.alloc(5);
    pdu[0] = FC.WRITE_SINGLE_REGISTER;
    pdu.writeUInt16BE(address, 1);
    pdu.writeUInt16BE(value & 0xffff, 3);
    await this.request(pdu);
  }

  async writeMultipleCoils(address, values) {
    const bits = packBits(values);
    const pdu = Buffer.alloc(6 + bits.length);
    pdu[0] = FC.WRITE_MULTIPLE_COILS;
    pdu.writeUInt16BE(address, 1);
    pdu.writeUInt16BE(values.length, 3);
    pdu[5] = bits.length;
    bits.copy(pdu, 6);
    await this.request(pdu);
  }

  async writeMultipleRegisters(address, values) {
    const pdu = Buffer.alloc(6 + values.length * 2);
    pdu[0] = FC.WRITE_MULTIPLE_REGISTERS;
    pdu.writeUInt16BE(address, 1);
    pdu.writeUInt16BE(values.length, 3);
    pdu[5] = values.length * 2;
    values.forEach((v, i) => pdu.writeUInt16BE(v & 0xffff, 6 + i * 2));
    await this.request(pdu);
  }

  /** Reads an arbitrarily long range of an area, splitting into protocol-sized chunks. */
  async readArea(area, start, count) {
    if (count <= 0) return [];
    const isBits = area === 'co' || area === 'di';
    const max = isBits ? LIMITS.MAX_READ_BITS : LIMITS.MAX_READ_REGS;
    const fn = {
      co: (a, q) => this.readCoils(a, q),
      di: (a, q) => this.readDiscreteInputs(a, q),
      hr: (a, q) => this.readHoldingRegisters(a, q),
      ir: (a, q) => this.readInputRegisters(a, q),
    }[area];
    const jobs = [];
    for (let off = 0; off < count; off += max) jobs.push(fn(start + off, Math.min(max, count - off)));
    return (await Promise.all(jobs)).flat();
  }

  /** Writes an arbitrarily long block of coils or holding registers. */
  async writeArea(area, start, values) {
    if (!values.length) return;
    const max = area === 'co' ? LIMITS.MAX_WRITE_BITS : LIMITS.MAX_WRITE_REGS;
    const jobs = [];
    for (let off = 0; off < values.length; off += max) {
      const chunk = values.slice(off, off + max);
      jobs.push(area === 'co' ? this.writeMultipleCoils(start + off, chunk) : this.writeMultipleRegisters(start + off, chunk));
    }
    await Promise.all(jobs);
  }
}
