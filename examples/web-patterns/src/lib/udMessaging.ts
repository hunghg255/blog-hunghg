/**
 * Trả lời tin nhắn lạc quan (optimistic) có rollback, và autocomplete cache hai tầng
 * (ý tưởng từ messaging.mobx-store và slack-autocomplete.mobx-store của Udemy).
 *
 * Khác bản gốc:
 * - Tin tạm có id riêng (tiền tố "tmp-"), tìm lại theo id chứ không theo vị trí trong mảng,
 *   nên gửi nhiều tin cùng lúc rồi một tin lỗi không làm hỏng tin khác.
 * - Tin lỗi ở lại với trạng thái "failed" để người dùng gửi lại, thay vì biến mất.
 * - `lastMessage` tính lại từ danh sách thay vì khôi phục ảnh chụp cũ.
 * - Autocomplete: lỗi của một tiền tố không làm khoá mọi lần gõ sau; request đang chạy được dùng
 *   chung thay vì bỏ qua; kết quả sắp xếp đúng.
 */

export type SendStatus = 'sending' | 'sent' | 'failed';

export interface Message {
  id: string;
  content: string;
  outgoing: boolean;
  status: SendStatus;
}

export interface Thread {
  id: string;
  muted: boolean;
  messages: Message[];
}

let tmpSeq = 0;

export function createThreadStore(
  thread: Thread,
  post: (content: string) => Promise<{ id: string }>,
  onChange: () => void,
) {
  // thread bị tắt tiếng thì gửi tin sẽ bật lại; nhớ giá trị cũ để khôi phục khi TẤT CẢ tin đang gửi đều lỗi
  let mutedBeforeSend: boolean | null = null;

  const pending = () => thread.messages.filter((m) => m.status === 'sending').length;
  const replace = (id: string, patch: Partial<Message>) => {
    thread.messages = thread.messages.map((m) => (m.id === id ? { ...m, ...patch } : m));
    onChange();
  };

  async function send(tempId: string, content: string) {
    try {
      const saved = await post(content);
      replace(tempId, { id: saved.id, status: 'sent' });
      mutedBeforeSend = null;
    } catch {
      replace(tempId, { status: 'failed' });
      // chỉ khôi phục "tắt tiếng" khi không còn tin nào đang gửi và chưa tin nào gửi được
      if (pending() === 0 && mutedBeforeSend !== null) {
        thread.muted = mutedBeforeSend;
        mutedBeforeSend = null;
        onChange();
      }
    }
  }

  return {
    get thread() {
      return thread;
    },
    /** Tin cuối cùng không phải tin lỗi (để hiện trong danh sách hội thoại). */
    get lastMessage() {
      return [...thread.messages].reverse().find((m) => m.status !== 'failed');
    },
    reply(content: string) {
      const tempId = `tmp-${++tmpSeq}`;
      if (mutedBeforeSend === null) mutedBeforeSend = thread.muted;
      thread.muted = false;
      thread.messages = [...thread.messages, { id: tempId, content, outgoing: true, status: 'sending' }];
      onChange();
      return send(tempId, content);
    },
    retry(tempId: string) {
      const msg = thread.messages.find((m) => m.id === tempId);
      if (!msg || msg.status !== 'failed') return Promise.resolve();
      replace(tempId, { status: 'sending' });
      return send(tempId, msg.content);
    },
    discard(tempId: string) {
      thread.messages = thread.messages.filter((m) => m.id !== tempId);
      onChange();
    },
  };
}

// ---------------------------------------------------------------- autocomplete hai tầng

export interface Suggestion {
  value: string;
  kind: 'user' | 'channel';
}

export interface PrefixAutocompleteOptions {
  /** Server trả mọi gợi ý khớp tiền tố (Udemy: 1 ký tự đầu). */
  fetchPrefix: (prefix: string) => Promise<Suggestion[]>;
  prefixLength?: number;
  /** Sau lỗi, chờ bao lâu thì cho thử lại tiền tố đó. */
  retryAfterMs?: number;
}

export function createPrefixAutocomplete({ fetchPrefix, prefixLength = 1, retryAfterMs = 2000 }: PrefixAutocompleteOptions) {
  const cache = new Map<string, Suggestion[]>(); // tầng 1: kết quả API theo tiền tố
  const inflight = new Map<string, Promise<Suggestion[]>>();
  const failedAt = new Map<string, number>();
  let calls = 0;

  /** "#gen" → chỉ kênh, "@an" → chỉ người, còn lại cả hai. */
  function parse(input: string) {
    const kind = input.startsWith('#') ? 'channel' : input.startsWith('@') ? 'user' : null;
    const term = input.replace(/^[#@]/, '').toLowerCase();
    return { kind, term, prefix: term.slice(0, prefixLength) };
  }

  // tầng 2: lọc theo toàn bộ chuỗi trên client, sắp tên khớp ở đầu lên trước
  function filter(list: Suggestion[], kind: string | null, term: string) {
    return list
      .filter((s) => (!kind || s.kind === kind) && s.value.toLowerCase().includes(term))
      .sort((a, b) => {
        const aStarts = a.value.toLowerCase().startsWith(term) ? 0 : 1;
        const bStarts = b.value.toLowerCase().startsWith(term) ? 0 : 1;
        return aStarts - bStarts || a.value.localeCompare(b.value);
      });
  }

  return {
    /** Trả gợi ý cho chuỗi đang gõ; ném lỗi nếu API lỗi (lần sau gõ tiếp sẽ thử lại). */
    async suggest(input: string): Promise<Suggestion[]> {
      const { kind, term, prefix } = parse(input);
      if (!prefix) return [];
      const cached = cache.get(prefix);
      if (cached) return filter(cached, kind, term);
      const failed = failedAt.get(prefix);
      if (failed && Date.now() - failed < retryAfterMs) throw new Error('Vừa lỗi, chờ chút rồi thử lại');
      let p = inflight.get(prefix);
      if (!p) {
        calls++;
        p = fetchPrefix(prefix).finally(() => inflight.delete(prefix));
        inflight.set(prefix, p);
      }
      try {
        const list = await p;
        cache.set(prefix, list);
        failedAt.delete(prefix);
        return filter(list, kind, term);
      } catch (err) {
        failedAt.set(prefix, Date.now());
        throw err;
      }
    },
    stats: () => ({ calls, cachedPrefixes: [...cache.keys()] }),
  };
}
