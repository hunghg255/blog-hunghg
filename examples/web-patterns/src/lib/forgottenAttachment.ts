/**
 * Cảnh báo "hình như bạn quên đính kèm file" trước khi gửi.
 * Ý tưởng từ owa-mail-forgotten-attachments + owa-editor-forgotten-attachments-plugin của Outlook Web.
 */

/**
 * Từ khoá theo ngôn ngữ, gồm cả danh từ lẫn động từ. Outlook lấy hai chuỗi đã dịch
 * (attachNounsTriggers, attachVerbsTriggers) rồi tách theo dấu phẩy, nên người dịch tự quyết từ nào.
 */
export const TRIGGERS: Record<string, string[]> = {
  // tránh cụm chồng nhau ("tệp đính kèm" chứa "đính kèm") kẻo một chỗ bị đếm hai lần
  vi: ['đính kèm', 'gửi kèm', 'kèm theo', 'tệp kèm'],
  en: ['attach', 'attached', 'attaching', 'attachment', 'attachments', 'enclosed'],
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Bản của Outlook: (^|\s)từ(\s|$). Giữ lại để so sánh trong demo và bài viết.
 * Hụt 3 trường hợp: từ đứng trước dấu câu ("xem file đính kèm."), hai từ liền nhau dùng chung
 * một khoảng trắng, và chữ tiếng Việt gõ ở dạng tổ hợp (NFD).
 */
export function countTriggersNaive(text: string, triggers: string[]): number {
  return triggers.reduce((sum, t) => {
    const re = new RegExp(`(^|\\s)${escapeRegExp(t)}(\\s|$)`, 'gi');
    return sum + (text.match(re) ?? []).length;
  }, 0);
}

/**
 * Đếm số lần xuất hiện của các từ khoá, theo ranh giới chữ Unicode:
 * - lookbehind/lookahead không "ăn" ký tự xung quanh, nên "attached, attached" đếm đủ 2;
 * - \p{L}\p{N}\p{M}: chữ, số và dấu thanh, để "đính kèmm" hay "reattach" không tính;
 * - chuẩn hoá NFC: macOS/iOS có thể gửi tiếng Việt dạng NFD, "ề" là "e" + 2 dấu rời.
 */
export function countTriggers(text: string, triggers: string[]): number {
  const normalized = text.normalize('NFC');
  return triggers.reduce((sum, t) => {
    const re = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${escapeRegExp(t.normalize('NFC'))}(?![\\p{L}\\p{N}\\p{M}])`, 'giu');
    return sum + (normalized.match(re) ?? []).length;
  }, 0);
}

export interface Draft {
  /** phần người dùng tự gõ */
  content: string;
  /** thư cũ được trích dẫn khi trả lời/chuyển tiếp (rỗng nếu là thư mới) */
  quoted: string;
  attachmentCount: number;
}

export interface Verdict {
  warn: boolean;
  inContent: number;
  inQuoted: number;
  reason: string;
}

/**
 * Quy tắc của Outlook: khi trả lời, chỉ cảnh báo nếu phần MỚI gõ có NHIỀU từ khoá hơn phần trích dẫn.
 * Thư cũ ghi "file đính kèm" và đã có file, giờ trả lời "ok cảm ơn" thì không được làm phiền.
 */
export function checkForgottenAttachment(draft: Draft, triggers: string[], count = countTriggers): Verdict {
  const inContent = count(draft.content, triggers);
  const inQuoted = draft.quoted ? count(draft.quoted, triggers) : 0;
  if (draft.attachmentCount > 0) return { warn: false, inContent, inQuoted, reason: 'đã có file đính kèm' };
  if (draft.quoted) {
    const warn = inContent > inQuoted;
    return {
      warn,
      inContent,
      inQuoted,
      reason: warn ? `phần mới có ${inContent} từ khoá > ${inQuoted} trong thư cũ` : `phần mới (${inContent}) không nhiều hơn thư cũ (${inQuoted})`,
    };
  }
  return { warn: inContent > 0, inContent, inQuoted, reason: inContent > 0 ? `có ${inContent} từ khoá, chưa có file` : 'không có từ khoá' };
}

// ---- Chuỗi kiểm tra trước khi gửi ----

export interface SendCheck<T> {
  id: string;
  /** true = qua; false = cần hỏi người dùng */
  validate: (draft: T) => boolean | Promise<boolean>;
  /** câu hỏi xác nhận; không có thì check fail là chặn luôn */
  confirm?: { title: string; body: string; okText: string; cancelText: string };
}

export type Confirm = (dialog: NonNullable<SendCheck<unknown>['confirm']>, checkId: string) => Promise<boolean>;

/**
 * Chạy lần lượt từng kiểm tra (người nhận, add-in đang chạy, quên đính kèm…), giống validateSend của
 * Outlook. Kiểm tra fail mà có `confirm` thì hỏi; người dùng đồng ý thì đi tiếp, không thì dừng.
 * Trả về id của kiểm tra đã chặn việc gửi, hoặc null nếu được gửi.
 */
export async function runSendChecks<T>(draft: T, checks: SendCheck<T>[], confirm: Confirm): Promise<string | null> {
  for (const check of checks) {
    if (await check.validate(draft)) continue;
    if (!check.confirm) return check.id;
    const ok = await confirm(check.confirm, check.id);
    if (!ok) return check.id;
  }
  return null;
}
