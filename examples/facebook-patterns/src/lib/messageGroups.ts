/**
 * Gom tin nhắn thành cụm, chèn vạch thời gian / vạch "chưa đọc",
 * và tính avatar "đã xem" của từng người.
 * Ý tưởng học từ MWLSMessageGroupsParser.bs của Messenger web, viết lại từ đầu.
 */

export interface ChatMessage {
  id: string;
  senderId: string;
  /** epoch ms */
  timestamp: number;
  text?: string;
  hasAttachment?: boolean;
  /** id tin được trả lời */
  replyTo?: string;
  forwarded?: boolean;
  /** tin hệ thống: "An đã đổi tên nhóm" */
  admin?: boolean;
  /** tin của người bị chặn: không hiện, không nhận avatar đã xem */
  blocked?: boolean;
}

export interface Reader {
  id: string;
  name: string;
  /** tin có timestamp <= mốc này coi như người đó đã đọc */
  readWatermark: number;
}

export type ChatItem =
  | { kind: 'time'; timestamp: number }
  | { kind: 'unread' }
  | { kind: 'admin'; message: ChatMessage }
  | { kind: 'group'; senderId: string; messages: ChatMessage[] };

export interface GroupOptions {
  /** hai tin cùng người gửi cách nhau quá ngưỡng này thì tách cụm. Messenger: 5 phút */
  groupGapMs?: number;
  /** cách tin trước quá ngưỡng này thì chèn vạch thời gian. Messenger: 1 giờ */
  timeBreakMs?: number;
  /** chữ dài hơn ngưỡng này thì đứng riêng một cụm. Messenger: 280 */
  maxCharsInGroup?: number;
  /** mốc đã đọc của người đang xem; tin đầu tiên mới hơn mốc này có vạch "chưa đọc" phía trên */
  viewerReadAt?: number;
  /** thêm vạch khi sang ngày mới (giờ địa phương) dù chưa đủ timeBreakMs. Bản gốc không có */
  breakOnNewDay?: boolean;
}

const DEFAULTS = { groupGapMs: 5 * 60_000, timeBreakMs: 60 * 60_000, maxCharsInGroup: 280 };

/** Tin "đứng riêng": không dính vào cụm trước hay sau. */
export function isStandalone(m: ChatMessage, maxChars = DEFAULTS.maxCharsInGroup): boolean {
  return Boolean(
    m.admin || m.replyTo || m.hasAttachment || (m.text && [...m.text].length > maxChars),
  );
}

function crosses(mark: number | undefined, prev: ChatMessage, next: ChatMessage) {
  return mark !== undefined && prev.timestamp <= mark && next.timestamp > mark;
}

function sameDay(a: number, b: number) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** Có cần chèn vạch thời gian phía trên `m` không. */
export function needsTimeBreak(m: ChatMessage, prev: ChatMessage | undefined, o: GroupOptions = {}) {
  if (!prev) return true;
  const gap = m.timestamp - prev.timestamp;
  return gap > (o.timeBreakMs ?? DEFAULTS.timeBreakMs) || (!!o.breakOnNewDay && !sameDay(prev.timestamp, m.timestamp));
}

/** `m` có bắt đầu cụm mới so với `prev` không. Thứ tự luật giống bản gốc. */
export function startsNewGroup(m: ChatMessage, prev: ChatMessage | undefined, o: GroupOptions = {}) {
  if (!prev) return true;
  const max = o.maxCharsInGroup ?? DEFAULTS.maxCharsInGroup;
  return (
    m.senderId !== prev.senderId ||
    m.timestamp - prev.timestamp > (o.groupGapMs ?? DEFAULTS.groupGapMs) ||
    !!m.forwarded ||
    isStandalone(m, max) ||
    isStandalone(prev, max) ||
    crosses(o.viewerReadAt, prev, m) ||
    needsTimeBreak(m, prev, o) // bản gốc dựa vào việc 1 giờ > 5 phút; ở đây nói thẳng ra
  );
}

/** Duyệt một lượt theo thời gian, trả danh sách item để render. */
export function groupMessages(messages: readonly ChatMessage[], o: GroupOptions = {}): ChatItem[] {
  const items: ChatItem[] = [];
  let current: ChatMessage[] = [];
  let prev: ChatMessage | undefined;

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0];
    items.push(
      first.admin
        ? { kind: 'admin', message: first }
        : { kind: 'group', senderId: first.senderId, messages: current },
    );
    current = [];
  };

  for (const m of messages) {
    if (m.blocked) continue;
    if (startsNewGroup(m, prev, o)) {
      flush();
      if (needsTimeBreak(m, prev, o)) items.push({ kind: 'time', timestamp: m.timestamp });
      if (prev && crosses(o.viewerReadAt, prev, m)) items.push({ kind: 'unread' });
    }
    current.push(m);
    prev = m;
  }
  flush();
  return items;
}

/**
 * Mỗi người (trừ người đang xem) gắn vào tin MỚI NHẤT họ đã thấy:
 * tin do chính họ gửi, hoặc tin có timestamp <= readWatermark.
 * Trả Map messageId -> danh sách người.
 */
export function seenHeads(
  messages: readonly ChatMessage[],
  readers: readonly Reader[],
  viewerId: string,
): Map<string, Reader[]> {
  const heads = new Map<string, Reader[]>();
  for (const r of readers) {
    if (r.id === viewerId) continue;
    // đi ngược từ cuối: gặp tin thoả điều kiện đầu tiên là xong, O(n) mỗi người
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.blocked) continue;
      if (m.senderId === r.id || m.timestamp <= r.readWatermark) {
        const list = heads.get(m.id) ?? [];
        list.push(r);
        heads.set(m.id, list);
        break;
      }
    }
  }
  return heads;
}

/** Vị trí của tin trong cụm, để bo góc bong bóng: chỉ có một tin, đầu, giữa, cuối. */
export function bubblePosition(index: number, size: number): 'single' | 'first' | 'middle' | 'last' {
  if (size === 1) return 'single';
  if (index === 0) return 'first';
  return index === size - 1 ? 'last' : 'middle';
}
