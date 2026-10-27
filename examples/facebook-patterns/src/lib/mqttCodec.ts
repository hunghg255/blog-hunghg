/**
 * Codec nhị phân MQTT 3.1 tối giản chạy trong trình duyệt
 * (ý tưởng từ MqttProtocolCodec / MqttProtocolUtils của Facebook, dùng cho chat realtime).
 *
 * Một gói MQTT: [1 byte header][độ dài còn lại: varint 1–4 byte][phần thân]
 * Byte header: 4 bit cao = loại gói, 4 bit thấp = cờ (DUP, QoS 2 bit, RETAIN).
 */

export const MessageType = {
  CONNECT: 1,
  CONNACK: 2,
  PUBLISH: 3,
  PUBACK: 4,
  SUBSCRIBE: 8,
  SUBACK: 9,
  PINGREQ: 12,
  PINGRESP: 13,
  DISCONNECT: 14,
} as const;
export type MessageTypeName = keyof typeof MessageType;

const TYPE_NAME: Record<number, MessageTypeName> = Object.fromEntries(
  Object.entries(MessageType).map(([name, code]) => [code, name as MessageTypeName]),
);

/** Tên giao thức "MQIsdp" + protocol level 3 = MQTT 3.1 (FB dùng đúng mảng này). */
const PROTOCOL_HEADER = [0, 6, 77, 81, 73, 115, 100, 112, 3];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---- varint "độ dài còn lại": 7 bit dữ liệu mỗi byte, bit cao = còn byte nữa ----

export function encodeLength(value: number): number[] {
  if (value < 0 || value > 268_435_455) throw new RangeError(`MQTT length out of range: ${value}`);
  const out: number[] = [];
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) byte |= 0x80;
    out.push(byte);
  } while (value > 0);
  return out;
}

/** Trả null nếu mảng hết trước khi varint kết thúc: gói chưa về đủ. */
export function decodeLength(bytes: Uint8Array, offset: number): { value: number; offset: number } | null {
  let value = 0;
  let multiplier = 1;
  for (let i = 0; i < 4; i++) {
    if (offset >= bytes.length) return null;
    const byte = bytes[offset++];
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return { value, offset };
    multiplier *= 128;
  }
  throw new Error('Malformed MQTT remaining length (more than 4 bytes)');
}

function u16(value: number) {
  return [(value >> 8) & 0xff, value & 0xff];
}

function str(value: string) {
  const bytes = encoder.encode(value);
  return [...u16(bytes.length), ...bytes];
}

function frame(type: number, flags: number, body: number[] | Uint8Array): Uint8Array {
  const length = encodeLength(body.length);
  const out = new Uint8Array(1 + length.length + body.length);
  out[0] = (type << 4) | (flags & 0x0f);
  out.set(length, 1);
  out.set(body, 1 + length.length);
  return out;
}

// ---- encode ----

export function encodeConnect(clientId: string, userName: string, keepAliveSeconds = 60) {
  // cờ 0x82 = username có mặt + clean session (FB: 2 | 128). FB không dùng password:
  // userName là một chuỗi JSON (MqttUserName: user id, session, topic đã subscribe, tab có focus không…)
  return frame(MessageType.CONNECT, 0, [
    ...PROTOCOL_HEADER,
    0x82,
    ...u16(keepAliveSeconds),
    ...str(clientId),
    ...str(userName),
  ]);
}

export function encodeSubscribe(messageId: number, topic: string, qos: 0 | 1 = 0) {
  return frame(MessageType.SUBSCRIBE, 0b0010, [...u16(messageId), ...str(topic), qos]);
}

export function encodePublish(topic: string, payload: string | Uint8Array, qos: 0 | 1 = 0, messageId?: number) {
  if (qos !== 0 && qos !== 1) throw new TypeError(`Unsupported QoS ${qos}`);
  if (qos === 1 && messageId == null) throw new TypeError('QoS 1 needs a messageId');
  const data = typeof payload === 'string' ? encoder.encode(payload) : payload;
  const body = [...str(topic), ...(qos === 1 ? u16(messageId!) : [])];
  const full = new Uint8Array(body.length + data.length);
  full.set(body);
  full.set(data, body.length);
  return frame(MessageType.PUBLISH, qos << 1, full);
}

export const encodePuback = (messageId: number) => frame(MessageType.PUBACK, 0, u16(messageId));
export const encodePingreq = () => frame(MessageType.PINGREQ, 0, []);
export const encodeDisconnect = () => frame(MessageType.DISCONNECT, 0, []);

// ---- decode ----

export type WireMessage =
  | { type: 'PUBLISH'; topic: string; payload: Uint8Array; qos: number; messageId: number | null; retain: boolean; dup: boolean }
  | { type: 'CONNACK'; sessionPresent: boolean; returnCode: number }
  | { type: 'PUBACK' | 'SUBACK'; messageId: number }
  | { type: 'PINGREQ' | 'PINGRESP' | 'DISCONNECT' }
  | { type: 'CONNECT' | 'SUBSCRIBE'; raw: Uint8Array };

/** Giải một gói bắt đầu ở `start`. Gói chưa đủ byte thì trả message null và vị trí cũ. */
function decodeOne(bytes: Uint8Array, start: number): { message: WireMessage | null; next: number } {
  const header = bytes[start];
  const type = header >> 4;
  const len = decodeLength(bytes, start + 1);
  if (len == null) return { message: null, next: start };
  const bodyStart = len.offset;
  const end = bodyStart + len.value;
  if (end > bytes.length) return { message: null, next: start };
  const read16 = (at: number) => (bytes[at] << 8) | bytes[at + 1];

  switch (TYPE_NAME[type]) {
    case 'PUBLISH': {
      const flags = header & 0x0f;
      const qos = (flags >> 1) & 0b11;
      let at = bodyStart;
      const topicLength = read16(at);
      at += 2;
      const topic = decoder.decode(bytes.subarray(at, at + topicLength));
      at += topicLength;
      let messageId: number | null = null;
      if (qos > 0) {
        messageId = read16(at);
        at += 2;
      }
      return {
        message: { type: 'PUBLISH', topic, payload: bytes.slice(at, end), qos, messageId, retain: (flags & 1) === 1, dup: (flags & 8) === 8 },
        next: end,
      };
    }
    case 'CONNACK':
      return { message: { type: 'CONNACK', sessionPresent: (bytes[bodyStart] & 1) === 1, returnCode: bytes[bodyStart + 1] }, next: end };
    case 'PUBACK':
    case 'SUBACK':
      return { message: { type: TYPE_NAME[type] as 'PUBACK' | 'SUBACK', messageId: read16(bodyStart) }, next: end };
    case 'PINGREQ':
    case 'PINGRESP':
    case 'DISCONNECT':
      return { message: { type: TYPE_NAME[type] as 'PINGREQ' | 'PINGRESP' | 'DISCONNECT' }, next: end };
    case 'CONNECT':
    case 'SUBSCRIBE':
      return { message: { type: TYPE_NAME[type] as 'CONNECT' | 'SUBSCRIBE', raw: bytes.slice(start, end) }, next: end };
    default:
      throw new Error(`Invalid MQTT message type ${type}`);
  }
}

/**
 * Giải mọi gói trọn vẹn trong `bytes`. Phần đuôi chưa đủ một gói trả về trong `remaining`
 * (giống decodeByteMessages của FB) — NGƯỜI GỌI phải giữ lại và ghép với chunk sau.
 */
export function decodeMessages(bytes: Uint8Array): { messages: WireMessage[]; remaining: Uint8Array | null } {
  const messages: WireMessage[] = [];
  let at = 0;
  while (at < bytes.length) {
    const { message, next } = decodeOne(bytes, at);
    if (!message) break;
    messages.push(message);
    at = next;
  }
  return { messages, remaining: at < bytes.length ? bytes.slice(at) : null };
}

/**
 * Bộ giải cho luồng byte (WebSocket, fetch streaming): tự ghép phần dư giữa các chunk.
 * Đây là chỗ MqttFetchClient của FB bỏ sót: nó giải từng chunk riêng và vứt `remaining`.
 */
export class MqttStreamDecoder {
  private pending: Uint8Array | null = null;

  push(chunk: Uint8Array): WireMessage[] {
    let bytes = chunk;
    if (this.pending) {
      bytes = new Uint8Array(this.pending.length + chunk.length);
      bytes.set(this.pending);
      bytes.set(chunk, this.pending.length);
    }
    const { messages, remaining } = decodeMessages(bytes);
    this.pending = remaining;
    return messages;
  }

  /** số byte đang chờ ghép (để debug / hiển thị) */
  get pendingBytes() {
    return this.pending?.length ?? 0;
  }
}

export const payloadText = (payload: Uint8Array) => decoder.decode(payload);
