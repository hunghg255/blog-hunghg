/**
 * Mô phỏng logic bản gốc (không phải mã của Udemy) để so sánh trong demo.
 *
 * replyToThread: tin tạm có id = id tin cuối + 1, nhớ VỊ TRÍ trong mảng; lỗi thì
 * splice(vị trí, 1) và khôi phục last_message đã chụp lúc gửi; thành công thì ghi đè messages[vị trí].
 *
 * Slack autocomplete: cache theo ký tự đầu; đang có request cho ký tự đó thì bỏ qua;
 * đã từng lỗi thì không gọi API nữa cho tới khi ô nhập bị xoá trắng; `sort((_) => _.value)`.
 */
import type { Suggestion } from '../lib/udMessaging';

export interface UdMessage {
  id: number;
  content: string;
  temp: boolean;
}

export function createUdemyStyleThread(
  initial: UdMessage[],
  post: (content: string) => Promise<{ id: number }>,
  onChange: () => void,
) {
  const thread = { muted: false, messages: [...initial], lastMessage: initial[initial.length - 1] };
  return {
    thread,
    async reply(content: string) {
      const lastMessage = thread.lastMessage;
      const newMessage: UdMessage = { id: lastMessage.id + 1, content, temp: true };
      const wasMuted = thread.muted;
      thread.muted = false;
      thread.messages.push(newMessage);
      thread.lastMessage = newMessage;
      const lastMessageIndex = thread.messages.length - 1;
      onChange();
      try {
        const saved = await post(content);
        thread.lastMessage = { id: saved.id, content, temp: false };
        thread.messages[lastMessageIndex] = thread.lastMessage;
      } catch {
        thread.muted = wasMuted;
        thread.lastMessage = lastMessage;
        thread.messages.splice(lastMessageIndex, 1);
      }
      onChange();
    },
  };
}

export function createUdemyStyleSlack(fetchUsers: (q: string) => Promise<Suggestion[]>, fetchChannels: (q: string) => Promise<Suggestion[]>) {
  const cached: Record<string, Suggestion[]> = {};
  const inProgress = new Set<string>();
  let usersError = false;
  let channelsError = false;
  let suggestions: Suggestion[] = [];
  let message = '';
  let calls = 0;
  let latestInput = ''; // như `this.inputValue`: lọc theo giá trị lúc response về

  const clean = (input: string) => input.replace('#', '').replace('@', '').toLowerCase();
  const filter = (input: string, list: Suggestion[]) =>
    list.filter((s) => {
      const v = s.value.toLowerCase();
      if (input.startsWith('#')) return v.includes(clean(input)) && s.kind === 'channel';
      if (input.startsWith('@')) return v.includes(clean(input)) && s.kind === 'user';
      return v.includes(clean(input));
    });

  return {
    async onInput(input: string) {
      latestInput = input;
      if (!input) {
        usersError = channelsError = false;
        message = '';
        suggestions = [];
        return;
      }
      const q = clean(input).slice(0, 1);
      if (inProgress.has(q)) return;
      if (q in cached) {
        suggestions = filter(input, cached[q]);
        return;
      }
      if (usersError || channelsError) return; // giữ nguyên gợi ý cũ
      inProgress.add(q);
      calls++;
      const results = await Promise.all([
        fetchUsers(q).catch(() => ((usersError = true), null)),
        fetchChannels(q).catch(() => ((channelsError = true), null)),
      ]);
      if (usersError) message = 'Không lấy được danh sách người dùng. Thử gõ lại.';
      let all: Suggestion[] = [];
      results.forEach((r) => {
        if (r) all = all.concat(r);
      });
      // @ts-expect-error: giống bản gốc, hàm so sánh trả về chuỗi nên không sắp gì cả
      all.sort((_) => _.value);
      suggestions = filter(latestInput, all);
      if (!usersError && !channelsError) cached[q] = all;
      inProgress.delete(q);
    },
    view: () => ({ suggestions, message, calls }),
  };
}
