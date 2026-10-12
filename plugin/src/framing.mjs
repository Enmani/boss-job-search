export const MAX_FRAME = 512 * 1024;

export function encodeFrame(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (!body.length || body.length > MAX_FRAME) throw new Error('Message size is outside the protocol limit');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header,body]);
}

export class FrameReader {
  constructor() { this.buffer = Buffer.alloc(0); }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer,chunk]);
    const messages = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE();
      if (!length || length > MAX_FRAME) throw new Error('Invalid frame length');
      if (this.buffer.length < length + 4) break;
      const value = JSON.parse(this.buffer.subarray(4,length+4).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid frame object');
      messages.push(value);
      this.buffer = this.buffer.subarray(length+4);
    }
    return messages;
  }
}
