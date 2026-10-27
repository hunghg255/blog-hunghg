/**
 * Smart Compose: gợi ý phần còn lại của câu bằng chữ mờ (ghost text).
 * Ý tưởng từ SmartComposeTypeaheadHelper của Facebook (hộp thư Pages Manager):
 * - chỉ hỏi server khi người dùng vừa gõ xong một từ (text kết thúc bằng "từ + khoảng trắng"),
 *   các phím sau đó lọc ứng viên ngay ở client;
 * - chỉ hiện gợi ý khi phần còn thiếu đủ dài (≥ 6 ký tự) và người dùng gõ chậm (≥ 100ms/phím);
 * - gợi ý đã hiện một lần thì giữ, không chớp tắt theo tốc độ gõ.
 */

export interface Candidate {
  /** phần chữ server đoán sẽ đến SAU đoạn text đã gửi đi */
  text: string;
  confidence: number;
}

export type FetchCandidates = (text: string, signal: AbortSignal) => Promise<Candidate[]>;

export type SmartComposeEvent =
  | { type: 'query'; text: string; warmUp: boolean }
  | { type: 'query-done'; text: string; count: number; ms: number }
  | { type: 'query-cancelled'; text: string }
  | { type: 'displayed'; suggestion: string; keyIntervalMs: number }
  | { type: 'accepted'; suggestion: string }
  | { type: 'typed-it-all'; candidate: string };

export interface SmartComposeOptions {
  fetchCandidates: FetchCandidates;
  /** phần còn thiếu phải dài ít nhất bấy nhiêu ký tự mới đáng hiện (FB: 6) */
  minRemaining?: number;
  /** khoảng cách giữa hai phím phải ít nhất bấy nhiêu ms (FB: 100) */
  minKeyIntervalMs?: number;
  onSuggestionChange?: (suggestion: string) => void;
  onEvent?: (event: SmartComposeEvent) => void;
  now?: () => number;
}

const ENDS_WITH_WORD_AND_SPACE = /\S+\s$/;

export class SmartCompose {
  private text = '';
  private prevText = '';
  private cursorAtEnd = true;
  /** text của request đang bay (hoặc vừa gửi) */
  private queryText: string | null = null;
  /** text đã dùng để lấy bộ ứng viên hiện tại: gợi ý = phần ứng viên còn lại sau `baseText` */
  private baseText = '';
  private candidates: Candidate[] = [];
  /** ứng viên đã từng hiện: được giữ dù tốc độ gõ thay đổi */
  private shown = new Set<string>();
  private suggestion = '';
  private warmedUp = false;
  private accepting = false;
  private inFlight: AbortController | null = null;
  private lastKeyAt = -1;
  private keyIntervalMs = -1;
  private readonly opts: Required<Omit<SmartComposeOptions, 'onSuggestionChange' | 'onEvent'>> &
    Pick<SmartComposeOptions, 'onSuggestionChange' | 'onEvent'>;

  constructor(options: SmartComposeOptions) {
    this.opts = { minRemaining: 6, minKeyIntervalMs: 100, now: () => performance.now(), ...options };
  }

  getSuggestion() {
    return this.suggestion;
  }

  /** Gọi ở mỗi lần nội dung đổi do người dùng gõ. */
  update(text: string, cursorAtEnd: boolean) {
    const now = this.opts.now();
    this.keyIntervalMs = this.lastKeyAt < 0 ? -1 : now - this.lastKeyAt;
    this.lastKeyAt = now;
    this.setText(text.normalize('NFC'), cursorAtEnd);
  }

  /** Con trỏ di chuyển (click, phím mũi tên): không tính là một lần gõ. */
  setCursorAtEnd(cursorAtEnd: boolean) {
    this.setText(this.text, cursorAtEnd);
  }

  /** Người dùng bấm Tab/→: trả về đoạn cần chèn ('' nếu không có gợi ý). */
  accept(): string {
    const suggestion = this.suggestion;
    if (!suggestion) return '';
    this.opts.onEvent?.({ type: 'accepted', suggestion });
    // nội dung mới = text + gợi ý; không tính là một lần gõ phím
    this.accepting = true;
    try {
      this.setText(this.text + suggestion, true);
    } finally {
      this.accepting = false;
    }
    return suggestion;
  }

  dispose() {
    this.inFlight?.abort();
    this.inFlight = null;
  }

  private setText(text: string, cursorAtEnd: boolean) {
    if (text === this.text && cursorAtEnd === this.cursorAtEnd) return;
    this.prevText = this.text;
    this.text = text;
    this.cursorAtEnd = cursorAtEnd;
    this.refreshSuggestion();
    this.maybeQuery();
  }

  private isDeleting() {
    return this.text.length < this.prevText.length;
  }

  /** Tính gợi ý từ bộ ứng viên đang có, không gọi mạng. */
  private computeSuggestion(candidates = this.candidates): { candidate: Candidate; rest: string } | null {
    if (candidates.length === 0 || !this.cursorAtEnd || this.isDeleting()) return null;
    // Khác bản gốc: FB dùng indexOf(base) >= 0 (base nằm ở đâu cũng được). Sửa đoạn đầu câu
    // thì substring(base.length) cắt sai chỗ. Ở đây đòi base phải là tiền tố.
    if (!this.text.startsWith(this.baseText)) return null;
    const typed = this.text.slice(this.baseText.length).toLowerCase();
    // vừa gõ xong từ (typed rỗng) thì chưa hiện: chờ chữ cái đầu của từ tiếp theo
    if (typed.length === 0) return null;
    const candidate = candidates.find((c) => c.text.toLowerCase().startsWith(typed));
    if (!candidate) return null;

    const remaining = candidate.text.length - typed.length;
    if (remaining <= 0) {
      // người dùng tự gõ hết đúng câu đã gợi ý: tín hiệu "gợi ý đúng" cho model.
      // Khác bản gốc: FB cũng log sự kiện này ngay sau khi người dùng bấm Tab nhận gợi ý.
      if (this.shown.has(candidate.text) && !this.accepting) this.opts.onEvent?.({ type: 'typed-it-all', candidate: candidate.text });
      return null;
    }
    const tooShort = remaining < this.opts.minRemaining;
    const typingFast = this.keyIntervalMs !== -1 && this.keyIntervalMs < this.opts.minKeyIntervalMs;
    if (!this.shown.has(candidate.text) && (tooShort || typingFast)) return null;
    return { candidate, rest: candidate.text.slice(typed.length) };
  }

  private refreshSuggestion() {
    const next = this.computeSuggestion();
    const rest = next?.rest ?? '';
    if (next && !this.shown.has(next.candidate.text)) {
      this.shown.add(next.candidate.text);
      this.opts.onEvent?.({ type: 'displayed', suggestion: rest, keyIntervalMs: Math.round(this.keyIntervalMs) });
    }
    if (rest !== this.suggestion) {
      this.suggestion = rest;
      this.opts.onSuggestionChange?.(rest);
    }
  }

  private maybeQuery() {
    // phím đầu tiên: bắn một query rỗng để "làm ấm" kết nối, bỏ kết quả
    if (!this.warmedUp && this.text.length > 0) {
      this.warmedUp = true;
      void this.query('', true);
      return;
    }
    if (
      this.text.trim() === '' ||
      !ENDS_WITH_WORD_AND_SPACE.test(this.text) ||
      this.text === this.queryText ||
      this.text === this.baseText ||
      this.isDeleting() ||
      this.suggestion !== '' // đang có gợi ý dùng được thì khỏi hỏi lại
    ) {
      return;
    }
    void this.query(this.text, false);
  }

  private async query(text: string, warmUp: boolean) {
    this.inFlight?.abort(); // request cũ hết giá trị: người dùng đã gõ thêm
    const controller = new AbortController();
    this.inFlight = controller;
    this.queryText = text;
    const started = this.opts.now();
    this.opts.onEvent?.({ type: 'query', text, warmUp });
    try {
      const result = await this.opts.fetchCandidates(text, controller.signal);
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      this.opts.onEvent?.({ type: 'query-done', text, count: result.length, ms: Math.round(this.opts.now() - started) });
      if (warmUp || result.length === 0) return;
      // Chỉ thay bộ ứng viên nếu chưa có gợi ý, hoặc bộ mới cho ra gợi ý.
      const previousBase = this.baseText;
      this.baseText = text;
      if (this.suggestion !== '' && this.computeSuggestion(result) == null) {
        this.baseText = previousBase;
        return;
      }
      this.candidates = result;
      this.shown = new Set();
      this.refreshSuggestion();
    } catch (error) {
      if ((error as Error).name === 'AbortError') this.opts.onEvent?.({ type: 'query-cancelled', text });
      else throw error;
    } finally {
      if (this.inFlight === controller) this.inFlight = null;
    }
  }
}
