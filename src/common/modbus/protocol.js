/** Modbus application protocol constants and PDU helpers shared by client and server. */

export const FC = Object.freeze({
  READ_COILS: 0x01,
  READ_DISCRETE_INPUTS: 0x02,
  READ_HOLDING_REGISTERS: 0x03,
  READ_INPUT_REGISTERS: 0x04,
  WRITE_SINGLE_COIL: 0x05,
  WRITE_SINGLE_REGISTER: 0x06,
  WRITE_MULTIPLE_COILS: 0x0f,
  WRITE_MULTIPLE_REGISTERS: 0x10,
});

export const EXCEPTION = Object.freeze({
  ILLEGAL_FUNCTION: 0x01,
  ILLEGAL_DATA_ADDRESS: 0x02,
  ILLEGAL_DATA_VALUE: 0x03,
  SERVER_DEVICE_FAILURE: 0x04,
});

export const EXCEPTION_TEXT = {
  1: 'Illegal function',
  2: 'Illegal data address',
  3: 'Illegal data value',
  4: 'Server device failure',
};

export const LIMITS = Object.freeze({
  MAX_READ_BITS: 2000,
  MAX_READ_REGS: 125,
  MAX_WRITE_BITS: 1968,
  MAX_WRITE_REGS: 123,
});

export const MBAP_LEN = 7;

export function buildFrame(transactionId, unitId, pdu) {
  const frame = Buffer.alloc(MBAP_LEN + pdu.length);
  frame.writeUInt16BE(transactionId & 0xffff, 0);
  frame.writeUInt16BE(0, 2); // protocol id: Modbus
  frame.writeUInt16BE(pdu.length + 1, 4);
  frame.writeUInt8(unitId & 0xff, 6);
  pdu.copy(frame, MBAP_LEN);
  return frame;
}

/** Extracts complete frames from a growing stream buffer. Returns { frames, rest }. */
export function splitFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= MBAP_LEN) {
    const length = buffer.readUInt16BE(offset + 4);
    if (length < 2 || length > 254) {
      // Corrupt stream: drop everything so the connection can resynchronise.
      return { frames, rest: Buffer.alloc(0), corrupt: true };
    }
    const total = 6 + length;
    if (buffer.length - offset < total) break;
    const frame = buffer.subarray(offset, offset + total);
    frames.push({
      transactionId: frame.readUInt16BE(0),
      protocolId: frame.readUInt16BE(2),
      unitId: frame.readUInt8(6),
      pdu: frame.subarray(MBAP_LEN),
    });
    offset += total;
  }
  return { frames, rest: buffer.subarray(offset) };
}

export function packBits(bits) {
  const out = Buffer.alloc(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >> 3] |= 1 << (i & 7);
  return out;
}

export function unpackBits(buf, count) {
  const out = new Array(count);
  for (let i = 0; i < count; i++) out[i] = (buf[i >> 3] >> (i & 7)) & 1;
  return out;
}
