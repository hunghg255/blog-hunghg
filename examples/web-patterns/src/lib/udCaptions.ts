/**
 * Phụ đề video kiểu Udemy: tự chọn ngôn ngữ phụ đề lúc mở video, và editor phụ đề
 * có phím tắt + tự dừng video khi đang gõ.
 *
 * Ý tưởng từ `shaka-video-player/captions/captions.mobx-store.ts` và
 * `caption-editor/caption-edit.mobx-store.js` của Udemy, viết lại từ đầu.
 */

export interface CaptionTrack {
  id: string;
  /** locale đầy đủ, vd 'vi_VN', 'zh_TW', 'fil_PH' */
  locale: string;
  label: string;
}

export interface AutoSelectInput {
  captions: CaptionTrack[];
  /**
   * Giá trị đã lưu khi người dùng TỰ chọn phụ đề:
   * - undefined: chưa từng chọn
   * - '': đã chủ động tắt phụ đề
   * - 'vi_VN' / 'vi'…: đã chọn ngôn ngữ đó
   */
  saved: string | undefined;
  /** locale giao diện của người dùng, vd 'vi_VN' */
  userLocale: string;
  /** bật phụ đề mặc định kể cả khi giao diện là tiếng Anh */
  defaultOn?: boolean;
}

export type AutoSelectReason = 'saved-off' | 'saved' | 'user-locale' | 'fallback-en' | 'none';

export interface AutoSelectResult {
  caption: CaptionTrack | null;
  reason: AutoSelectReason;
}

/** 'zh_TW' -> 'zh', 'fil_PH' -> 'fil' (cắt theo dấu gạch, KHÔNG cắt 2 ký tự). */
export const languageOf = (locale: string) => locale.split(/[_-]/)[0].toLowerCase();

const normalize = (locale: string) => locale.replace('-', '_').toLowerCase();

/** Tìm track khớp locale: khớp đầy đủ trước (zh_TW), rồi mới khớp theo ngôn ngữ (zh). */
export function findTrack(captions: CaptionTrack[], wanted: string): CaptionTrack | null {
  const full = normalize(wanted);
  const exact = captions.find((c) => normalize(c.locale) === full);
  if (exact) return exact;
  const lang = languageOf(wanted);
  return captions.find((c) => languageOf(c.locale) === lang) ?? null;
}

/**
 * Thứ tự ưu tiên: lựa chọn đã lưu → ngôn ngữ của người dùng (nếu không phải tiếng Anh,
 * hoặc khi `defaultOn`) → tiếng Anh. Đã chủ động tắt thì tôn trọng, không tự bật lại.
 */
export function autoSelectCaption({
  captions,
  saved,
  userLocale,
  defaultOn = false,
}: AutoSelectInput): AutoSelectResult {
  if (saved === '') return { caption: null, reason: 'saved-off' };
  if (saved) {
    const track = findTrack(captions, saved);
    if (track) return { caption: track, reason: 'saved' };
  }
  const isEnglishUi = languageOf(userLocale) === 'en';
  if (isEnglishUi && !defaultOn) return { caption: null, reason: 'none' };
  if (!isEnglishUi) {
    const track = findTrack(captions, userLocale);
    if (track) return { caption: track, reason: 'user-locale' };
  }
  const en = findTrack(captions, 'en_US');
  return en ? { caption: en, reason: 'fallback-en' } : { caption: null, reason: 'none' };
}

/** Sắp menu phụ đề: ngôn ngữ người dùng lên đầu, còn lại theo nhãn. Không sửa mảng gốc. */
export function sortCaptions(captions: CaptionTrack[], userLocale: string): CaptionTrack[] {
  const lang = languageOf(userLocale);
  return [...captions].sort((a, b) => {
    const pa = languageOf(a.locale) === lang ? 0 : 1;
    const pb = languageOf(b.locale) === lang ? 0 : 1;
    return pa - pb || a.label.localeCompare(b.label);
  });
}

// ---------------------------------------------------------------------------
// Editor phụ đề

export interface EditableCue {
  id: number;
  start: number;
  end: number;
  text: string;
}

/** Ngưỡng Udemy dùng cho phụ đề sinh tự động (ASR): độ tin cậy ≤ 0.43 thì cảnh báo. */
export const LOW_CONFIDENCE_THRESHOLD = 0.43;

export const isLowQuality = (confidence: number | null | undefined) =>
  confidence != null && confidence <= LOW_CONFIDENCE_THRESHOLD;

export type EditorCommand = 'toggle-play' | 'seek-back' | 'seek-forward' | 'prev-cue' | 'next-cue';

/** Phím tắt của editor: luôn đi kèm Shift để không đụng việc gõ chữ trong ô nhập. */
export const EDITOR_KEYMAP: ReadonlyArray<{ key: string; command: EditorCommand; label: string }> = [
  { key: 'shift+space', command: 'toggle-play', label: 'Phát / dừng' },
  { key: 'shift+arrowleft', command: 'seek-back', label: 'Lùi 1 giây' },
  { key: 'shift+arrowright', command: 'seek-forward', label: 'Tới 1 giây' },
  { key: 'shift+arrowup', command: 'prev-cue', label: 'Sửa câu trước' },
  { key: 'shift+arrowdown', command: 'next-cue', label: 'Sửa câu sau' },
];

const keyName = (event: KeyboardEvent) => (event.key === ' ' ? 'space' : event.key.toLowerCase());

/** Đổi KeyboardEvent thành lệnh của editor, hoặc null nếu không phải phím tắt. */
export function commandFromKey(event: KeyboardEvent): EditorCommand | null {
  // Đang gõ bằng bộ gõ IME (tiếng Việt Telex trên một số bộ gõ, tiếng Nhật…): bỏ qua.
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || !event.shiftKey) {
    return null;
  }
  const combo = `shift+${keyName(event)}`;
  return EDITOR_KEYMAP.find((entry) => entry.key === combo)?.command ?? null;
}

/** Vị trí câu đang phát tại thời điểm `time` (giây), -1 nếu không có. */
export const cueIndexAt = (cues: EditableCue[], time: number) =>
  cues.findIndex((cue) => time >= cue.start && time < cue.end);

export interface PauseWhenTypingOptions {
  /** gọi khi cần dừng video */
  pause: () => void;
  /** gọi khi cần phát lại; không truyền thì không tự phát lại (giống Udemy) */
  resume?: () => void;
  /** im lặng bao lâu (ms) thì phát lại, mặc định 1500 */
  resumeAfterMs?: number;
}

/**
 * Dừng video ngay khi người dùng gõ vào ô phụ đề. Udemy dừng và để người dùng tự bấm
 * phát lại; bản này có thêm tuỳ chọn tự phát lại sau một lúc không gõ.
 */
export function createPauseWhenTyping({ pause, resume, resumeAfterMs = 1500 }: PauseWhenTypingOptions) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pausedByTyping = false;
  return {
    onInput(isPlaying: boolean) {
      if (isPlaying) {
        pause();
        pausedByTyping = true;
      }
      if (!resume) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        // chỉ phát lại nếu chính việc gõ đã dừng video, không phát lại video người dùng tự dừng
        if (pausedByTyping) resume();
        pausedByTyping = false;
      }, resumeAfterMs);
    },
    /** người dùng tự bấm phát/dừng: huỷ mọi lịch phát lại */
    onManualToggle() {
      clearTimeout(timer);
      pausedByTyping = false;
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
