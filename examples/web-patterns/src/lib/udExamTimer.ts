/**
 * Đồng hồ bài thi có giờ, kiểu "practice test" của Udemy:
 * - tính thời gian bằng đồng hồ thật (Date.now), không cộng dồn tick → không trôi
 * - tự tạm dừng khi người dùng không làm gì quá lâu
 * - tạm dừng khi rời trang bằng sendBeacon
 * - tự lưu đáp án khi "dấu vân tay" {câu hiện tại, đáp án đã chọn} đổi
 *
 * Ý tưởng từ `course-taking/quiz-view/practice-test/question/test-timer.mobx-model.js` và
 * `practice-test.mobx-store.js` của Udemy, viết lại từ đầu.
 */

export type IdleCharge =
  /** như bản gốc: khoảng rảnh trước khi tự dừng vẫn bị tính vào thời gian làm bài */
  | 'charge-idle'
  /** chỉ tính tới lần hoạt động cuối (+ `graceSec`) */
  | 'until-last-activity';

export interface ExamTimerOptions {
  /** tổng thời gian cho phép (giây) */
  durationSec: number;
  /** đã dùng bao nhiêu giây (lấy từ server) */
  elapsedSec?: number;
  /** rảnh bao lâu thì tự dừng, mặc định 5 phút như bản gốc */
  maxIdleSec?: number;
  idleCharge?: IdleCharge;
  /** với 'until-last-activity': cộng thêm bao nhiêu giây sau lần hoạt động cuối, mặc định 30 */
  graceSec?: number;
  /** nguồn thời gian (ms), cho phép test với đồng hồ giả */
  now?: () => number;
  onTimesUp?: () => void;
  onIdlePause?: (chargedIdleSec: number) => void;
  onChange?: () => void;
}

export function createExamTimer({
  durationSec,
  elapsedSec = 0,
  maxIdleSec = 5 * 60,
  idleCharge = 'until-last-activity',
  graceSec = 30,
  now = Date.now,
  onTimesUp,
  onIdlePause,
  onChange,
}: ExamTimerOptions) {
  let committed = elapsedSec; // đã chốt, tới lần hoạt động trước
  let sinceActivity = 0; // giây kể từ lần hoạt động gần nhất
  let lastActivity = now();
  let paused = true;
  let timesUp = false;

  const emit = () => onChange?.();

  const commit = () => {
    committed += sinceActivity;
    sinceActivity = 0;
    lastActivity = now();
  };

  const api = {
    get elapsed() {
      return committed + sinceActivity;
    },
    get remaining() {
      return durationSec - api.elapsed;
    },
    get isPaused() {
      return paused;
    },
    get isTimesUp() {
      return timesUp;
    },

    start() {
      if (!paused) return;
      paused = false;
      lastActivity = now();
      emit();
    },

    pause() {
      if (paused) return;
      paused = true;
      commit();
      emit();
    },

    /** người dùng vừa làm gì đó (chọn đáp án, chuyển câu…) */
    activity() {
      if (paused) return;
      commit();
      emit();
    },

    /** gọi đều đặn (vd mỗi 200ms như bản gốc); chỉ đọc đồng hồ, không cộng dồn */
    tick() {
      if (paused) return;
      const seconds = Math.floor((now() - lastActivity) / 1000);
      // chỉ cho tăng: đồng hồ máy bị chỉnh lùi thì giữ nguyên
      if (seconds > sinceActivity) sinceActivity = seconds;

      if (api.remaining <= 0) {
        timesUp = true;
        paused = true;
        commit();
        onTimesUp?.();
      } else if (sinceActivity >= maxIdleSec) {
        const idle = sinceActivity;
        if (idleCharge === 'until-last-activity') {
          // máy ngủ / bỏ đi: chỉ tính một khoảng ân hạn sau lần hoạt động cuối
          sinceActivity = Math.min(sinceActivity, graceSec);
        }
        paused = true;
        commit();
        onIdlePause?.(idleCharge === 'charge-idle' ? idle : Math.min(idle, graceSec));
      }
      emit();
    },
  };
  return api;
}

export type ExamTimer = ReturnType<typeof createExamTimer>;

/**
 * Báo server "tạm dừng" khi rời trang. sendBeacon vẫn gửi được khi trang đang đóng, nhưng
 * KHÔNG đặt được header: nếu API đòi header CSRF (vd X-CSRFToken của Django) thì phải đưa
 * token vào body hoặc miễn kiểm tra cho endpoint này.
 */
export function sendPauseBeacon(url: string, data: Record<string, unknown>, send = navigator.sendBeacon?.bind(navigator)) {
  const body = new Blob([JSON.stringify(data)], { type: 'application/json' });
  return send ? send(url, body) : false;
}

/** Tạm dừng khi trang bị ẩn/đóng. Trả hàm gỡ (gỡ đúng hàm đã gắn). */
export function pauseOnLeave(onLeave: () => void) {
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') onLeave();
  };
  window.addEventListener('pagehide', onLeave);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('pagehide', onLeave);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

// ---------------------------------------------------------------------------
// Tự lưu theo dấu vân tay

export interface ExamQuestion {
  id: number;
  kind: 'choice' | 'fill-in';
  selected: number[];
  /** với câu điền vào chỗ trống */
  text?: string;
}

/**
 * Dấu vân tay của trạng thái cần lưu. Bản gốc chỉ gồm số câu + id đáp án đã chọn, nên chữ
 * gõ vào câu điền vào chỗ trống không làm đổi dấu vân tay; bản này thêm cả nội dung đó.
 */
export const answerFingerprint = (questionIndex: number, q: ExamQuestion) =>
  `${questionIndex}|${[...q.selected].sort((a, b) => a - b).join(',')}|${q.kind === 'fill-in' ? q.text ?? '' : ''}`;

/**
 * Gọi `save` mỗi khi dấu vân tay đổi. Đổi câu thì lưu ngay; chỉ đổi chữ thì chờ `debounceMs`.
 */
export function createAutoSave(save: (reason: 'question-change' | 'answer-change') => void, debounceMs = 800) {
  let lastFingerprint: string | null = null;
  let lastQuestion: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    observe(questionIndex: number, q: ExamQuestion) {
      const fp = answerFingerprint(questionIndex, q);
      if (lastFingerprint === null) {
        lastFingerprint = fp;
        lastQuestion = questionIndex;
        return;
      }
      if (fp === lastFingerprint) return;
      const questionChanged = questionIndex !== lastQuestion;
      lastFingerprint = fp;
      lastQuestion = questionIndex;
      clearTimeout(timer);
      if (questionChanged) save('question-change');
      else timer = setTimeout(() => save('answer-change'), q.kind === 'fill-in' ? debounceMs : 0);
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
