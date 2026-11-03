import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataStore } from '../src/common/modbus/dataStore.js';
import { ModbusServer } from '../src/common/modbus/server.js';
import { ModbusClient } from '../src/common/modbus/client.js';
import { buildFrame, splitFrames, packBits, unpackBits } from '../src/common/modbus/protocol.js';

describe('protocol helpers', () => {
  it('packs and unpacks bits LSB first', () => {
    const bits = [1, 0, 1, 1, 0, 0, 0, 0, 1];
    const packed = packBits(bits);
    expect([...packed]).toEqual([0b00001101, 0b00000001]);
    expect(unpackBits(packed, 9)).toEqual(bits);
  });

  it('splits a stream into MBAP frames and keeps partial data', () => {
    const f1 = buildFrame(1, 1, Buffer.from([3, 0, 0, 0, 2]));
    const f2 = buildFrame(2, 1, Buffer.from([4, 0, 10, 0, 1]));
    const stream = Buffer.concat([f1, f2.subarray(0, 4)]);
    const { frames, rest } = splitFrames(stream);
    expect(frames).toHaveLength(1);
    expect(frames[0].transactionId).toBe(1);
    expect(rest.length).toBe(4);
  });
});

describe('Modbus TCP server and client', () => {
  let store;
  let server;
  let client;

  beforeAll(async () => {
    store = new DataStore({ co: 3000, di: 100, hr: 400, ir: 400 });
    server = new ModbusServer(store, { unitId: 7 });
    const { port } = await server.listen(0, '127.0.0.1');
    client = new ModbusClient({ port, unitId: 7, timeoutMs: 1000 });
    await client.connect();
  });

  afterAll(async () => {
    client.close();
    await server.close();
  });

  it('reads and writes holding registers (FC3/FC6/FC16)', async () => {
    await client.writeSingleRegister(10, 1234);
    await client.writeMultipleRegisters(20, [1, 2, 3]);
    expect(await client.readHoldingRegisters(10, 1)).toEqual([1234]);
    expect(await client.readHoldingRegisters(20, 3)).toEqual([1, 2, 3]);
  });

  it('reads input registers containing a float32 (FC4)', async () => {
    store.setF32('ir', 5, 16.7);
    const [hi, lo] = await client.readInputRegisters(5, 2);
    const dv = new DataView(new ArrayBuffer(4));
    dv.setUint16(0, hi);
    dv.setUint16(2, lo);
    expect(dv.getFloat32(0)).toBeCloseTo(16.7, 5);
  });

  it('reads and writes coils and discrete inputs (FC1/FC2/FC5/FC15)', async () => {
    await client.writeSingleCoil(3, true);
    await client.writeMultipleCoils(100, [true, false, true, true]);
    expect(await client.readCoils(100, 4)).toEqual([1, 0, 1, 1]);
    expect((await client.readCoils(3, 1))[0]).toBe(1);
    store.setBit('di', 9, true);
    expect((await client.readDiscreteInputs(8, 2))).toEqual([0, 1]);
  });

  it('splits long reads into protocol-sized chunks', async () => {
    for (let i = 0; i < 300; i++) store.hr[i] = i;
    const values = await client.readArea('hr', 0, 300);
    expect(values).toHaveLength(300);
    expect(values[299]).toBe(299);
    const bits = await client.readArea('co', 0, 2500);
    expect(bits).toHaveLength(2500);
  });

  it('returns an illegal data address exception', async () => {
    await expect(client.readHoldingRegisters(399, 5)).rejects.toMatchObject({ code: 2 });
  });

  it('emits write events for the owning application', async () => {
    const seen = [];
    server.on('write', (w) => seen.push(w));
    await client.writeMultipleRegisters(50, [9, 9]);
    expect(seen.at(-1)).toMatchObject({ area: 'hr', address: 50, quantity: 2 });
  });
});
