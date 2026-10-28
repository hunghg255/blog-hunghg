import { HEIGHTS, estimateHeight, type MsgLike } from '../lib/waRenderCursor';

/**
 * Mô phỏng lại hai biểu thức của `bdecdecede` (WhatsApp Web 2020) để demo so sánh (KHÔNG phải mã gốc).
 * Bản gốc viết `t + (w && h || 0) ? A : 330` và `t + e.isLive ? A : B`: dấu `+` được tính trước `?:`,
 * nên phần quote/caption `t` lọt vào điều kiện thay vì được cộng vào kết quả.
 */
export function estimateHeightWhatsApp2020(m: MsgLike): number {
  const t = (m.quoted ? HEIGHTS.quoted : 0) + (m.caption ? HEIGHTS.caption : 0);
  switch (m.type) {
    case 'image':
      return t + ((m.width && m.height) || 0)
        ? Math.floor(Math.min((HEIGHTS.imageMax / m.width!) * m.height!, HEIGHTS.imageMax))
        : HEIGHTS.imageMax;
    case 'location':
      return t + Number(m.isLive) ? HEIGHTS.locationLive : HEIGHTS.locationStatic;
    default:
      return estimateHeight(m);
  }
}

/** Khoảng cách 1:1 như bản gốc: `b = 2*isNotification + isSentByMe`, chỉ 2px khi b khác 0 và bằng tin trước. */
export function gapWhatsApp2020(prev: MsgLike | undefined, cur: MsgLike): number {
  const code = (m: MsgLike) => 2 * (m.type === 'notification' ? 1 : 0) + (m.fromMe ? 1 : 0);
  const b = code(cur);
  return b && prev && b === code(prev) ? HEIGHTS.sameSenderGap : HEIGHTS.otherSenderGap;
}
