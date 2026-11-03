/**
 * Modbus register memory for one node.
 *
 * Four standard data areas:
 *   co - coils             (read/write bits,  FC1 / FC5 / FC15)
 *   di - discrete inputs   (read-only bits,   FC2)
 *   hr - holding registers (read/write words, FC3 / FC6 / FC16)
 *   ir - input registers   (read-only words,  FC4)
 *
 * 32-bit values (float32, uint32) occupy two consecutive registers, high word first
 * ("big-endian / ABCD" word order, the most common convention in DCS/PLC gateways).
 */
export const AREAS = ['co', 'di', 'hr', 'ir'];

const f32buf = new DataView(new ArrayBuffer(4));

export class DataStore {
  constructor(sizes = {}) {
    this.co = new Uint8Array(sizes.co ?? 2000);
    this.di = new Uint8Array(sizes.di ?? 2000);
    this.hr = new Uint16Array(sizes.hr ?? 4000);
    this.ir = new Uint16Array(sizes.ir ?? 4000);
  }

  area(name) {
    const a = this[name];
    if (!a || !AREAS.includes(name)) throw new Error(`Unknown area ${name}`);
    return a;
  }

  getBit(area, addr) {
    return this.area(area)[addr] === 1;
  }

  setBit(area, addr, v) {
    this.area(area)[addr] = v ? 1 : 0;
  }

  getU16(area, addr) {
    return this.area(area)[addr];
  }

  setU16(area, addr, v) {
    this.area(area)[addr] = Math.max(0, Math.min(65535, Math.round(v))) & 0xffff;
  }

  getI16(area, addr) {
    const v = this.area(area)[addr];
    return v > 32767 ? v - 65536 : v;
  }

  setI16(area, addr, v) {
    const n = Math.max(-32768, Math.min(32767, Math.round(v)));
    this.area(area)[addr] = n < 0 ? n + 65536 : n;
  }

  getU32(area, addr) {
    const a = this.area(area);
    return a[addr] * 65536 + a[addr + 1];
  }

  setU32(area, addr, v) {
    const a = this.area(area);
    const n = Math.max(0, Math.min(4294967295, Math.floor(v)));
    a[addr] = Math.floor(n / 65536) & 0xffff;
    a[addr + 1] = n & 0xffff;
  }

  getI32(area, addr) {
    const v = this.getU32(area, addr);
    return v > 2147483647 ? v - 4294967296 : v;
  }

  setI32(area, addr, v) {
    const n = Math.max(-2147483648, Math.min(2147483647, Math.round(v)));
    this.setU32(area, addr, n < 0 ? n + 4294967296 : n);
  }

  getF32(area, addr) {
    const a = this.area(area);
    f32buf.setUint16(0, a[addr]);
    f32buf.setUint16(2, a[addr + 1]);
    return f32buf.getFloat32(0);
  }

  setF32(area, addr, v) {
    const a = this.area(area);
    f32buf.setFloat32(0, Number.isFinite(v) ? v : 0);
    a[addr] = f32buf.getUint16(0);
    a[addr + 1] = f32buf.getUint16(2);
  }

  /** Copies raw words/bits into an area (used by clients mirroring a remote node). */
  load(area, start, values) {
    const a = this.area(area);
    for (let i = 0; i < values.length && start + i < a.length; i++) a[start + i] = values[i];
  }

  snapshot() {
    return {
      co: Array.from(this.co),
      di: Array.from(this.di),
      hr: Array.from(this.hr),
      ir: Array.from(this.ir),
    };
  }
}
