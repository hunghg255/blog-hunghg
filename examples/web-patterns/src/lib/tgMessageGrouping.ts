/**
 * Ô nhập tự giãn, tin chỉ có emoji phóng to, gom tin theo ngày/người gửi/album (Telegram #16).
 */

// ---------- Ô nhập tự giãn ----------

/** Hệ số của bản gốc: thời lượng = 50 · ln(|Δh|) ms. */
export const TRANSITION_DURATION_FACTOR = 50;

/**
 * Thời lượng animation tỉ lệ log theo quãng đường: nhảy 20px mất ~150ms, nhảy 400px chỉ ~300ms.
 * Bản gốc gọi Math.log thẳng nên |Δh| = 1 cho 0ms và |Δh| < 1 cho số âm; ở đây kẹp ≥ 0.
 */
export function growDuration(delta: number, factor = TRANSITION_DURATION_FACTOR) {
  const distance = Math.abs(delta);
  if (distance < 1) return 0;
  return Math.max(0, Math.round(factor * Math.log(distance)));
}

export interface GrowResult {
  height: number;
  duration: number;
  overflown: boolean;
}

/**
 * Đo chiều cao bằng một bản sao ẩn (cùng font, cùng bề rộng) thay vì chính ô nhập:
 * đặt `height: auto` lên ô thật để đo sẽ làm khung nhảy một frame và mất vị trí cuộn.
 */
export function measureGrow(clone: HTMLElement, currentHeight: number, maxHeight: number): GrowResult | undefined {
  const next = Math.min(clone.scrollHeight, maxHeight);
  if (next === currentHeight) return undefined;
  return { height: next, duration: growDuration(next - currentHeight), overflown: clone.scrollHeight > maxHeight };
}

// ---------- Tin chỉ có emoji ----------

const EMOJI_ONLY_MAX = 3;
// Một "emoji" có thể là chuỗi ZWJ nhiều code point (👨‍👩‍👧) hoặc cờ (🇻🇳): đếm theo grapheme
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : undefined;

/**
 * Trả về số emoji (1–3) nếu chuỗi CHỈ gồm emoji, ngược lại false.
 * Bản gốc dùng regex twemoji (~10KB) với cờ `g` dùng chung giữa các lần gọi và phải tự reset lastIndex.
 */
export function countEmojiOnly(text: string, max = EMOJI_ONLY_MAX): number | false {
  const trimmed = text.trim();
  // thoát sớm. Bản gốc cho 8 đơn vị UTF-16 mỗi emoji (3 × 8 = 24), hụt với emoji gia đình ZWJ dài 11
  if (!trimmed || trimmed.length > max * 11) return false;
  const graphemes = segmenter
    ? Array.from(segmenter.segment(trimmed), (s) => s.segment)
    : Array.from(trimmed);
  const emojis = graphemes.filter((g) => !/^\s+$/.test(g));
  if (emojis.length === 0 || emojis.length > max) return false;
  return emojis.every((g) => PICTOGRAPHIC.test(g)) ? emojis.length : false;
}

// ---------- Gom tin ----------

export interface ChatMessage {
  id: number;
  senderId: string;
  /** giây (unix) như API Telegram */
  date: number;
  text?: string;
  isOutgoing?: boolean;
  isService?: boolean;
  albumId?: string;
  forwardFrom?: string;
  hasButtons?: boolean;
}

export interface Album {
  albumId: string;
  messages: ChatMessage[];
  /** tin có caption, nếu không có thì tin đầu */
  main: ChatMessage;
}

export type GroupItem = ChatMessage | Album;
export interface SenderGroup {
  items: GroupItem[];
}
export interface DateGroup {
  dayStart: number;
  senderGroups: SenderGroup[];
}

export const GROUP_INTERVAL_SECONDS = 600;

export const isAlbum = (item: GroupItem): item is Album => 'albumId' in item && 'messages' in item;

/** Mốc 0h theo giờ địa phương của người xem (Telegram cũng chia ngày theo máy người xem). */
export function dayStart(seconds: number) {
  const d = new Date(seconds * 1000);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Có cần cắt nhóm người gửi giữa a và b (tin liền sau) không. */
export function shouldBreakGroup(a: ChatMessage, b: ChatMessage, firstUnreadId?: number) {
  return (
    b.id === firstUnreadId ||
    a.senderId !== b.senderId ||
    Boolean(a.isOutgoing) !== Boolean(b.isOutgoing) ||
    Boolean(a.isService) ||
    Boolean(b.isService) ||
    // chỉ cắt khi CẢ HAI đều là tin chuyển tiếp và từ hai nguồn khác nhau
    (a.forwardFrom !== undefined && b.forwardFrom !== undefined && a.forwardFrom !== b.forwardFrom) ||
    Boolean(a.hasButtons) ||
    Boolean(b.hasButtons) ||
    b.date - a.date > GROUP_INTERVAL_SECONDS
  );
}

/**
 * Một lượt duyệt: chia ngày → nhóm người gửi → album.
 * Album được gắn vào nhóm ngay ở ảnh ĐẦU và không bao giờ cắt nhóm giữa hai ảnh cùng album,
 * nên album luôn nằm trọn trong nhóm chứa ảnh đầu của nó.
 */
export function groupMessages(messages: ChatMessage[], firstUnreadId?: number): DateGroup[] {
  if (messages.length === 0) return []; // bản gốc đọc messages[0] nên ném lỗi với mảng rỗng

  const dateGroups: DateGroup[] = [];
  let dateGroup: DateGroup | undefined;
  let senderGroup: SenderGroup | undefined;
  let album: Album | undefined;

  messages.forEach((message, index) => {
    const prev = messages[index - 1];
    const day = dayStart(message.date);

    if (!dateGroup || dateGroup.dayStart !== day) {
      dateGroup = { dayStart: day, senderGroups: [] };
      dateGroups.push(dateGroup);
      senderGroup = undefined;
    } else if (
      prev &&
      // không cắt giữa một album: các ảnh cùng album luôn nằm chung một nhóm
      !(message.albumId && prev.albumId === message.albumId) &&
      shouldBreakGroup(prev, message, firstUnreadId)
    ) {
      senderGroup = undefined;
    }

    if (!senderGroup) {
      senderGroup = { items: [] };
      dateGroup.senderGroups.push(senderGroup);
    }

    if (message.albumId) {
      if (album && album.albumId === message.albumId) {
        album.messages.push(message);
        if (message.text && !album.main.text) album.main = message;
      } else {
        album = { albumId: message.albumId, messages: [message], main: message };
        senderGroup.items.push(album);
      }
    } else {
      album = undefined;
      senderGroup.items.push(message);
    }
  });

  return dateGroups;
}

/**
 * Hiệu ứng hiện tin kiểu Telegram: tin dưới cùng hiện trước, mỗi tin trễ thêm 10ms.
 * Trả về delay (ms) cho phần tử thứ `index` trong danh sách có `count` phần tử.
 */
export const appearanceDelay = (index: number, count: number, step = 10) => (count - 1 - index) * step;
