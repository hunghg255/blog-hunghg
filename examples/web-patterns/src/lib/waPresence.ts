/**
 * Presence, "đang gõ" và chặn bớt thông báo nhóm — viết lại từ ý tưởng của WhatsApp Web 2020
 * (module igjghefdb, bbehjhfdfe, dgjifchfde). Không phải mã gốc.
 */

export type ChatStateType = 'available' | 'unavailable' | 'composing' | 'recording';
/** Server còn gửi `paused` = vừa ngừng gõ. */
export type IncomingType = ChatStateType | 'paused';

export interface ChatState {
  type: ChatStateType;
  /** lần cuối nhận composing/recording (chỉ dùng trong nhóm) */
  updateTime: number;
}

const isActive = (t: ChatStateType) => t === 'composing' || t === 'recording';

/**
 * Áp một update vào trạng thái hiện tại.
 * `paused` chỉ có nghĩa khi người đó ĐANG gõ/ghi âm: khi đó chuyển về `available`.
 * Nếu họ đang `unavailable` thì bỏ qua, để một gói `paused` đến trễ không làm họ "online" lại.
 */
export function applyChatState(current: ChatState, incoming: IncomingType, now: number): ChatState {
  if (incoming === 'paused') {
    return isActive(current.type) ? { type: 'available', updateTime: current.updateTime } : current;
  }
  return { type: incoming, updateTime: isActive(incoming) ? now : current.updateTime };
}

/** Trong nhóm: hiện người gõ gần nhất; nhóm "online" nếu có ai khác unavailable. */
export function summarizeGroup(states: Map<string, ChatState>) {
  let typist: { id: string; state: ChatState } | null = null;
  let online = false;
  for (const [id, state] of states) {
    if (isActive(state.type) && (!typist || typist.state.updateTime < state.updateTime)) {
      typist = { id, state };
    }
    online ||= state.type !== 'unavailable';
  }
  return { typist, online };
}

/**
 * Bộ hẹn giờ cho composing: server không gửi "ngừng gõ" nếu mạng rớt,
 * nên client tự hạ về available sau một khoảng.
 */
export function createComposingExpiry(timeoutMs: number, onExpire: (id: string) => void) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    touch(id: string, type: ChatStateType) {
      clearTimeout(timers.get(id));
      timers.delete(id);
      if (isActive(type)) timers.set(id, setTimeout(() => (timers.delete(id), onExpire(id)), timeoutMs));
    },
    dispose() {
      timers.forEach(clearTimeout);
      timers.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Dòng trạng thái ở header: tránh nháy "last seen…" rồi đổi ngay sang "online"

export type HeaderMode = 'placeholder' | 'status' | 'empty';

export interface DisplayGateOptions {
  /** giữ placeholder tối đa bao lâu khi mở chat mà chưa có dữ liệu presence */
  withholdMs?: number;
  /** sau mốc này, chưa có gì để hiện thì để trống thay vì placeholder */
  forceMs?: number;
  /**
   * Bản gốc chỉ thả placeholder sớm nếu dữ liệu ĐÃ có lúc mở chat; dữ liệu về sau đó vẫn phải
   * chờ đủ withholdMs. Bật cờ này để thả ngay khi dữ liệu đầu tiên tới.
   */
  releaseOnData?: boolean;
}

export function createDisplayGate(
  onChange: (mode: HeaderMode) => void,
  { withholdMs = 1500, forceMs = 2000, releaseOnData = true }: DisplayGateOptions = {},
) {
  let hasData = false;
  let withhold = true;
  let force = false;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let hasStatus = false;

  const emit = () => onChange(withhold ? 'placeholder' : hasStatus ? 'status' : force ? 'empty' : 'placeholder');
  const clear = () => (timers.forEach(clearTimeout), (timers = []));

  return {
    open() {
      clear();
      withhold = !hasData;
      force = false;
      if (withhold) timers.push(setTimeout(() => ((withhold = false), emit()), withholdMs));
      timers.push(setTimeout(() => ((force = true), emit()), forceMs));
      emit();
    },
    data(statusText: string | null) {
      hasData = true;
      hasStatus = Boolean(statusText);
      if (releaseOnData) withhold = false;
      emit();
    },
    close: clear,
  };
}

// ---------------------------------------------------------------------------
// Thông báo desktop: nhóm đông thì im lâu hơn, mention xuyên qua mute

export interface IncomingMessage {
  chatId: string;
  isGroup: boolean;
  /** tin nhắc tên hoặc trả lời chính mình */
  mentionsMe: boolean;
  senderMuted: boolean;
  chatMuted: boolean;
}

export interface NotifyPolicyOptions {
  now: () => number;
  /** lấy số thành viên; có thể chậm (gọi server) */
  participants: (chatId: string) => Promise<number>;
  /** bản gốc: false — mention cũng bị chặn nếu đang trong khoảng im */
  mentionBypassesSquelch?: boolean;
  /** bản gốc: false — đặt khoảng im SAU khi lấy xong số thành viên, nên 2 tin sát nhau đều kêu */
  reserveSynchronously?: boolean;
}

/** Khoảng im sau mỗi thông báo nhóm: min(120, 30 + 5×n) giây. */
export const squelchSeconds = (participants: number) => Math.min(120, 30 + 5 * participants);

export function createNotifyPolicy({
  now,
  participants,
  mentionBypassesSquelch = true,
  reserveSynchronously = true,
}: NotifyPolicyOptions) {
  const squelchUntil = new Map<string, number>();

  return function shouldNotify(msg: IncomingMessage): { notify: boolean; reason: string } {
    if (msg.chatMuted) {
      // chat đã mute: chỉ báo khi được nhắc tên, trừ khi người gửi cũng bị mute
      if (!msg.isGroup || !msg.mentionsMe || msg.senderMuted) return { notify: false, reason: 'muted' };
    }
    if (!msg.isGroup) return { notify: true, reason: 'direct' };
    if (msg.mentionsMe && mentionBypassesSquelch) return { notify: true, reason: 'mention' };

    const t = now();
    const until = squelchUntil.get(msg.chatId);
    if (until !== undefined && t < until) return { notify: false, reason: 'squelched' };

    // giữ chỗ ngay (60 s) để tin thứ hai đến trong lúc chờ server cũng bị chặn
    if (reserveSynchronously) squelchUntil.set(msg.chatId, t + 60_000);
    participants(msg.chatId).then(
      (n) => squelchUntil.set(msg.chatId, now() + squelchSeconds(n) * 1000),
      () => squelchUntil.set(msg.chatId, now() + 60_000),
    );
    return { notify: true, reason: 'group' };
  };
}

/** Body bắt đầu bằng ký tự ngoài ASCII (emoji, chữ RTL) thì thêm một dấu cách, như bản gốc. */
export const padNotificationBody = (body: string) => (body.charCodeAt(0) >= 128 ? ` ${body}` : body);
