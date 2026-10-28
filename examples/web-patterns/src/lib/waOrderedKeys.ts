/**
 * Khoá dạng chuỗi giữ đúng thứ tự số khi so sánh từ điển, kiểu WhatsApp Web (module `bigeebbfbi`).
 *
 * Chuỗi "10" < "9" khi so như chuỗi. WhatsApp thêm MỘT ký tự hex đứng đầu cho biết số chữ số hex
 * (trừ 1), nên số nhiều chữ số hơn luôn đứng sau: 9 → "09", 15 → "0f", 16 → "110", 255 → "1ff", 256 → "2100".
 * Khoá tin nhắn: `${chatId}_${loại}_${encode(counter)}`; cả một chat nằm trong khoảng `${chatId}_/` … `${chatId}_g`
 * vì '/' đứng ngay trước '0' và 'g' đứng ngay sau 'f' trong bảng mã.
 */

export const MAX_HEX_DIGITS = 16;

/** Mã hoá số nguyên không âm (tối đa 16 chữ số hex = 2^64 − 1). */
export function encodeOrderedHex(value: number | bigint): string {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new RangeError(`Cần số nguyên không âm an toàn, nhận ${value}`);
  }
  if (typeof value === 'bigint' && value < 0n) throw new RangeError('Cần số không âm');
  const hex = value.toString(16);
  if (hex.length > MAX_HEX_DIGITS) throw new RangeError('Quá 16 chữ số hex: tiền tố 1 ký tự không đủ');
  return (hex.length - 1).toString(16) + hex;
}

/** Giải mã về bigint để không mất chính xác khi vượt 2^53 (bản gốc dùng parseInt). */
export function decodeOrderedHex(encoded: string): bigint {
  const digits = parseInt(encoded[0], 16) + 1;
  const hex = encoded.slice(1);
  if (hex.length !== digits || !/^[0-9a-f]+$/.test(hex)) throw new Error(`Khoá không hợp lệ: ${encoded}`);
  return BigInt(`0x${hex}`);
}

export const MessageKind = { incoming: '1', outgoing: '2', system: '3' } as const;
export type MessageKind = (typeof MessageKind)[keyof typeof MessageKind];

function assertChatId(chatId: string) {
  // Khoảng `${chat}_/`..`${chat}_g` chỉ đúng khi chatId không chứa '_' (nếu không, chat "a" sẽ ôm luôn chat "a_b").
  if (chatId.includes('_')) throw new Error(`chatId không được chứa '_': ${chatId}`);
}

export function messageKey(chatId: string, kind: MessageKind, counter: number | bigint) {
  assertChatId(chatId);
  return `${chatId}_${kind}_${encodeOrderedHex(counter)}`;
}

export interface KeyRangeBounds {
  lower: string;
  upper: string;
}

/** Mọi khoá của một chat, mọi loại tin. */
export function chatBounds(chatId: string): KeyRangeBounds {
  assertChatId(chatId);
  return { lower: `${chatId}_/`, upper: `${chatId}_g` };
}

/** Khoá của một loại tin trong chat, tuỳ chọn bắt đầu từ một counter. */
export function kindBounds(chatId: string, kind: MessageKind, fromCounter?: number | bigint): KeyRangeBounds {
  assertChatId(chatId);
  const start = fromCounter === undefined ? '' : encodeOrderedHex(fromCounter);
  return { lower: `${chatId}_${kind}_${start}`, upper: `${chatId}_${kind}_g` };
}

export function toKeyRange({ lower, upper }: KeyRangeBounds): IDBKeyRange {
  return IDBKeyRange.bound(lower, upper);
}
