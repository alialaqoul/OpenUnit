/**
 * Tag database / Modbus register map builder.
 *
 * Every node (plant I/O and each controller) declares its tags in src/maps/<node>.js.
 * Addresses are allocated sequentially in declaration order, so the same module gives
 * servers and clients an identical map without hand-maintained address tables.
 *
 * Types:  bool (co/di)  |  f32, u32, i32 (2 registers)  |  u16, i16 (1 register)
 *
 * Layouts:
 *  native  - the four Modbus areas, allocated from address 0 (simulated controllers, plant).
 *  openplc - the OpenPLC Runtime register model: every bit is a coil (%QX) and every number a
 *            32-bit holding register pair in the %MD area (HR 2048+, high word first), because
 *            an OpenPLC program can only publish to those. 16-bit tags become DINT. Each tag
 *            records its IEC location (t.plc) for the generated Structured Text declarations.
 */
const WORDS = { f32: 2, u32: 2, i32: 2, u16: 1, i16: 1, bool: 1 };
const OPENPLC_MD_BASE = 2048;
const OPENPLC_MAX_MD = 1024;
const OPENPLC_MAX_COILS = 8192;
const IEC_TYPE = { bool: 'BOOL', f32: 'REAL', i32: 'DINT', u32: 'UDINT' };

export const PID_MODE = Object.freeze({ MAN: 0, AUTO: 1, CAS: 2 });
export const PID_STS = Object.freeze({ INTERLOCK: 1, TRACK: 2, HI_LIM: 4, LO_LIM: 8, CAS_OK: 16 });

/** Structured Text identifier for a tag name (LIC_HW.MODE -> LIC_HW_MODE). */
export const stIdent = (name) => name.replace(/\./g, '_');

export class TagMap {
  constructor(node, title = node, { layout = 'native' } = {}) {
    this.node = node;
    this.title = title;
    this.layout = layout;
    this.tags = new Map();
    this.base = { co: 0, di: 0, hr: layout === 'openplc' ? OPENPLC_MD_BASE : 0, ir: 0 };
    this.next = { ...this.base };
    this.owners = {};
    this.loops = [];
    this.stations = [];
    this.devices = [];
    this.currentOwner = null;
  }

  add(name, def) {
    if (this.tags.has(name)) throw new Error(`${this.node}: duplicate tag ${name}`);
    let area = def.area;
    let type = def.type || (area === 'co' || area === 'di' ? 'bool' : 'f32');
    // Status values (input registers / discrete inputs) are read-only for the HMI and peers.
    const ro = area === 'ir' || area === 'di';
    let plc;
    if (this.layout === 'openplc') {
      if (type === 'bool') area = 'co';
      else {
        area = 'hr';
        if (type === 'u16' || type === 'i16') type = 'i32';
      }
    }
    const words = WORDS[type];
    if (!words) throw new Error(`${this.node}.${name}: bad type ${type}`);
    const address = this.next[area];
    this.next[area] += words;
    if (this.layout === 'openplc') {
      if (area === 'co') {
        if (address >= OPENPLC_MAX_COILS) throw new Error(`${this.node}: out of OpenPLC coils at ${name}`);
        plc = { loc: `%QX${Math.floor(address / 8)}.${address % 8}`, iec: 'BOOL', ident: stIdent(name) };
      } else {
        const md = (address - OPENPLC_MD_BASE) / 2;
        if (md >= OPENPLC_MAX_MD) throw new Error(`${this.node}: out of OpenPLC %MD memory at ${name}`);
        plc = { loc: `%MD${md}`, iec: IEC_TYPE[type], ident: stIdent(name) };
      }
    }
    const owner = def.owner ?? this.currentOwner;
    const tag = {
      name,
      node: this.node,
      area,
      address,
      type,
      ro,
      plc,
      units: def.units || '',
      desc: def.desc || name,
      dp: def.dp ?? (type === 'f32' ? 1 : 0),
      min: def.min,
      max: def.max,
      init: def.init,
      alarm: def.alarm,
      owner,
      enum: def.enum,
      pulse: def.pulse || false,
    };
    this.tags.set(name, tag);
    if (owner) {
      const o = (this.owners[owner] ||= {});
      const r = (o[area] ||= { start: address, count: 0 });
      if (address !== r.start + r.count) throw new Error(`${this.node}: owner ${owner} block in ${area} is not contiguous at ${name}`);
      r.count += words;
    }
    return tag;
  }

  ir(name, units, desc, opts = {}) {
    return this.add(name, { area: 'ir', units, desc, ...opts });
  }

  hr(name, units, desc, opts = {}) {
    return this.add(name, { area: 'hr', units, desc, ...opts });
  }

  di(name, desc, opts = {}) {
    return this.add(name, { area: 'di', desc, ...opts });
  }

  co(name, desc, opts = {}) {
    return this.add(name, { area: 'co', desc, ...opts });
  }

  /** Groups the tags declared inside fn under an owner so the owner can write them as one block. */
  section(owner, fn) {
    const prev = this.currentOwner;
    this.currentOwner = owner;
    fn();
    this.currentOwner = prev;
  }

  ownerRange(owner, area) {
    return this.owners[owner]?.[area] || { start: 0, count: 0 };
  }

  /**
   * PID controller faceplate tags.
   * opts: desc, pvUnits, outUnits, pvMin, pvMax, outMin, outMax, sp, kp, ti, td, mode, cas
   */
  pid(name, opts) {
    const o = { outUnits: '%', outMin: 0, outMax: 100, kp: 1, ti: 30, td: 0, mode: PID_MODE.MAN, ...opts };
    this.ir(`${name}.PV`, o.pvUnits, `${o.desc} - process value`, { dp: o.dp ?? 1 });
    this.hr(`${name}.SP`, o.pvUnits, `${o.desc} - setpoint`, { init: o.sp ?? 0, dp: o.dp ?? 1 });
    this.hr(`${name}.OUT`, o.outUnits, `${o.desc} - output`, { init: o.out ?? 0 });
    this.hr(`${name}.MODE`, '', `${o.desc} - mode`, { type: 'u16', init: o.mode, enum: ['MAN', 'AUTO', 'CAS'] });
    this.hr(`${name}.KP`, '', `${o.desc} - proportional gain`, { init: o.kp, dp: 3 });
    this.hr(`${name}.TI`, 's', `${o.desc} - integral time`, { init: o.ti, dp: 1 });
    this.hr(`${name}.TD`, 's', `${o.desc} - derivative time`, { init: o.td, dp: 1 });
    this.ir(`${name}.CSP`, o.pvUnits, `${o.desc} - cascade/remote setpoint`, { dp: o.dp ?? 1 });
    this.ir(`${name}.STS`, '', `${o.desc} - status bits`, { type: 'u16' });
    this.loops.push({
      name,
      desc: o.desc,
      pvUnits: o.pvUnits,
      outUnits: o.outUnits,
      pvMin: o.pvMin,
      pvMax: o.pvMax,
      outMin: o.outMin,
      outMax: o.outMax,
      cas: !!o.cas,
      dp: o.dp ?? 1,
      group: o.group || '',
    });
    return name;
  }

  /** Manual/auto loading station (analog output without its own PID). */
  station(name, opts) {
    const o = { units: '%', outMin: 0, outMax: 100, mode: PID_MODE.MAN, ...opts };
    this.hr(`${name}.OUT`, o.units, `${o.desc} - output`, { init: o.out ?? 0 });
    this.hr(`${name}.MODE`, '', `${o.desc} - mode`, { type: 'u16', init: o.mode, enum: ['MAN', 'AUTO'] });
    this.hr(`${name}.BIAS`, o.units, `${o.desc} - bias`, { init: 0 });
    this.ir(`${name}.IN`, o.units, `${o.desc} - auto demand`);
    this.ir(`${name}.FB`, o.units, `${o.desc} - position feedback`);
    this.ir(`${name}.STS`, '', `${o.desc} - status bits`, { type: 'u16' });
    this.stations.push({ name, desc: o.desc, units: o.units, outMin: o.outMin, outMax: o.outMax, group: o.group || '' });
    return name;
  }

  /** Motor / pump / fan device block. */
  motor(name, opts = {}) {
    this.co(`${name}.START`, `${opts.desc} - start command`, { pulse: true });
    this.co(`${name}.STOP`, `${opts.desc} - stop command`, { pulse: true });
    this.hr(`${name}.MODE`, '', `${opts.desc} - mode`, { type: 'u16', init: opts.mode ?? 0, enum: ['MAN', 'AUTO'] });
    this.di(`${name}.RUN`, `${opts.desc} - running`);
    this.di(`${name}.TRIP`, `${opts.desc} - tripped`, { alarm: opts.tripAlarm === false ? undefined : { on: true, pri: opts.pri ?? 2, text: `${opts.desc} TRIPPED` } });
    this.di(`${name}.PERM`, `${opts.desc} - start permissive`);
    this.di(`${name}.ILK`, `${opts.desc} - protective interlock active`);
    this.devices.push({ name, type: 'motor', desc: opts.desc, group: opts.group || '', plant: opts.plant || name });
    return name;
  }

  /** On/off valve or breaker device block. */
  valve(name, opts = {}) {
    this.co(`${name}.OPEN`, `${opts.desc} - open/close command`, { pulse: true });
    this.co(`${name}.CLOSE`, `${opts.desc} - close/open command`, { pulse: true });
    this.hr(`${name}.MODE`, '', `${opts.desc} - mode`, { type: 'u16', init: opts.mode ?? 0, enum: ['MAN', 'AUTO'] });
    this.di(`${name}.OPENED`, `${opts.desc} - open`);
    this.di(`${name}.CLOSED`, `${opts.desc} - closed`);
    this.di(`${name}.PERM`, `${opts.desc} - permissive`);
    this.di(`${name}.ILK`, `${opts.desc} - interlock active`);
    this.devices.push({
      name,
      type: 'valve',
      desc: opts.desc,
      group: opts.group || '',
      labels: opts.labels || ['OPEN', 'CLOSE'],
    });
    return name;
  }

  get(name) {
    const t = this.tags.get(name);
    if (!t) throw new Error(`${this.node}: unknown tag ${name}`);
    return t;
  }

  has(name) {
    return this.tags.has(name);
  }

  /** Address span in use in one area: { start, count } (OpenPLC maps start holding registers at 2048). */
  range(area) {
    return { start: this.base[area], count: this.next[area] - this.base[area] };
  }

  sizes() {
    const pad = (n) => Math.max(16, n + 8);
    return { co: pad(this.next.co), di: pad(this.next.di), hr: pad(this.next.hr), ir: pad(this.next.ir) };
  }

  /** Writes declared initial values into a store. */
  applyInit(store) {
    for (const t of this.tags.values()) if (t.init !== undefined) writeTag(store, t, t.init);
  }

  catalog() {
    return {
      node: this.node,
      title: this.title,
      layout: this.layout,
      sizes: this.next,
      base: this.base,
      tags: [...this.tags.values()],
      loops: this.loops,
      stations: this.stations,
      devices: this.devices,
      owners: this.owners,
    };
  }
}

export function readTag(store, tag) {
  switch (tag.type) {
    case 'bool':
      return store.getBit(tag.area, tag.address);
    case 'f32':
      return store.getF32(tag.area, tag.address);
    case 'u32':
      return store.getU32(tag.area, tag.address);
    case 'i32':
      return store.getI32(tag.area, tag.address);
    case 'u16':
      return store.getU16(tag.area, tag.address);
    case 'i16':
      return store.getI16(tag.area, tag.address);
    default:
      throw new Error(`bad type ${tag.type}`);
  }
}

export function writeTag(store, tag, value) {
  switch (tag.type) {
    case 'bool':
      return store.setBit(tag.area, tag.address, !!value);
    case 'f32':
      return store.setF32(tag.area, tag.address, Number(value));
    case 'u32':
      return store.setU32(tag.area, tag.address, Number(value));
    case 'i32':
      return store.setI32(tag.area, tag.address, Number(value));
    case 'u16':
      return store.setU16(tag.area, tag.address, Number(value));
    case 'i16':
      return store.setI16(tag.area, tag.address, Number(value));
    default:
      throw new Error(`bad type ${tag.type}`);
  }
}

/** Encodes a value into the raw words/bits that a Modbus write would carry. */
export function encodeTag(tag, value) {
  if (tag.type === 'bool') return [value ? 1 : 0];
  const dv = new DataView(new ArrayBuffer(4));
  switch (tag.type) {
    case 'f32':
      dv.setFloat32(0, Number(value));
      return [dv.getUint16(0), dv.getUint16(2)];
    case 'u32': {
      const n = Math.max(0, Math.min(4294967295, Math.floor(Number(value))));
      return [Math.floor(n / 65536) & 0xffff, n & 0xffff];
    }
    case 'i32': {
      const v = Math.max(-2147483648, Math.min(2147483647, Math.round(Number(value))));
      const n = v < 0 ? v + 4294967296 : v;
      return [Math.floor(n / 65536) & 0xffff, n & 0xffff];
    }
    case 'u16':
      return [Math.max(0, Math.min(65535, Math.round(Number(value))))];
    case 'i16': {
      const n = Math.max(-32768, Math.min(32767, Math.round(Number(value))));
      return [n < 0 ? n + 65536 : n];
    }
    default:
      throw new Error(`bad type ${tag.type}`);
  }
}

/** Convenience accessor binding a TagMap to a DataStore. */
export class TagIO {
  constructor(map, store) {
    this.map = map;
    this.store = store;
  }

  get(name) {
    return readTag(this.store, this.map.get(name));
  }

  set(name, value) {
    writeTag(this.store, this.map.get(name), value);
  }

  has(name) {
    return this.map.has(name);
  }

  /** Returns every tag value as a plain object (used by the HMI). */
  dump() {
    const out = {};
    for (const t of this.map.tags.values()) out[t.name] = readTag(this.store, t);
    return out;
  }
}
