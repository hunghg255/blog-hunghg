import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  createAutoSave,
  createExamTimer,
  pauseOnLeave,
  sendPauseBeacon,
  type ExamQuestion,
  type ExamTimer,
} from '../lib/udExamTimer';
import { Log, Stat, useLog } from './shared';
import './UdExamTimerDemo.css';

const QUESTIONS: Array<{ title: string; kind: ExamQuestion['kind']; options?: string[] }> = [
  { title: 'useEffect chạy khi nào?', kind: 'choice', options: ['Trước khi render', 'Sau khi commit', 'Chỉ một lần'] },
  { title: 'Hook nào giữ giá trị qua các lần render mà không gây render lại?', kind: 'choice', options: ['useState', 'useRef', 'useMemo'] },
  { title: 'Điền tên API gửi request khi trang đang đóng:', kind: 'fill-in' },
  { title: 'key trong danh sách dùng để làm gì?', kind: 'choice', options: ['Style', 'Nhận diện phần tử', 'Sắp xếp'] },
];

const fmt = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Mô phỏng dấu vân tay gốc (không phải mã của Udemy): số câu + id đáp án theo thứ tự chọn. */
const originalFingerprint = (index: number, q: ExamQuestion) => `${index}|${q.selected.join(',')}`;

export default function UdExamTimerDemo() {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [speed, setSpeed] = useState(60);
  const clock = useRef({ virtual: 0, lastReal: performance.now(), speed: 60 });
  clock.current.speed = speed;
  const now = () => clock.current.virtual;
  const log = useLog(40);

  const timers = useMemo(() => {
    const make = (idleCharge: 'charge-idle' | 'until-last-activity', label: string) =>
      createExamTimer({
        durationSec: 60 * 60,
        idleCharge,
        now: () => now(),
        onIdlePause: (charged) => log.add(`${label}: rảnh quá 5 phút → tự dừng, tính thêm ${fmt(charged)}`, 'warn'),
        onTimesUp: () => log.add(`${label}: hết giờ`, 'err'),
      });
    return {
      original: make('charge-idle', 'Kiểu gốc'),
      ours: make('until-last-activity', 'Viết lại'),
    } satisfies Record<string, ExamTimer>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // đồng hồ giả: thời gian ảo chạy nhanh gấp `speed` lần
  useEffect(() => {
    const id = setInterval(() => {
      const real = performance.now();
      clock.current.virtual += (real - clock.current.lastReal) * clock.current.speed;
      clock.current.lastReal = real;
      timers.original.tick();
      timers.ours.tick();
      rerender();
    }, 200);
    return () => clearInterval(id);
  }, [timers]);

  const both = (fn: (t: ExamTimer) => void) => {
    fn(timers.original);
    fn(timers.ours);
    rerender();
  };

  // ---- câu hỏi + tự lưu ----
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<ExamQuestion[]>(() =>
    QUESTIONS.map((q, i) => ({ id: i + 1, kind: q.kind, selected: [], text: '' })),
  );
  const [saves, setSaves] = useState({ original: 0, ours: 0 });
  const ourAutoSave = useMemo(
    () =>
      createAutoSave((reason) => {
        setSaves((s) => ({ ...s, ours: s.ours + 1 }));
        log.add(`Viết lại: lưu (${reason})`, 'ok');
      }),
    [log.add],
  );
  const lastOriginal = useRef<string | null>(null);

  useEffect(() => {
    const q = answers[index];
    ourAutoSave.observe(index, q);
    const fp = originalFingerprint(index, q);
    if (lastOriginal.current !== null && fp !== lastOriginal.current) {
      setSaves((s) => ({ ...s, original: s.original + 1 }));
      log.add('Kiểu gốc: lưu', 'muted');
    }
    lastOriginal.current = fp;
  }, [answers, index, ourAutoSave, log.add]);

  useEffect(() => () => ourAutoSave.dispose(), [ourAutoSave]);

  // rời trang thật (đóng tab, chuyển app trên mobile) cũng tạm dừng
  useEffect(
    () =>
      pauseOnLeave(() => {
        both((t) => t.pause());
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const choose = (option: number) => {
    setAnswers((list) => list.map((q, i) => (i === index ? { ...q, selected: [option] } : q)));
    both((t) => t.activity());
  };
  const type = (text: string) => {
    setAnswers((list) => list.map((q, i) => (i === index ? { ...q, text } : q)));
    both((t) => t.activity());
  };
  const go = (next: number) => {
    setIndex(next);
    both((t) => t.activity());
  };

  const simulateLeave = () => {
    both((t) => t.pause());
    const sent = sendPauseBeacon('/api/attempts/1/pause/', { is_paused: true }, (url, body) => {
      log.add(`sendBeacon ${url} (${(body as Blob).size} byte)`, 'ok');
      return true;
    });
    log.add(`Rời trang → tạm dừng, beacon ${sent ? 'đã xếp hàng gửi' : 'không gửi được'}`);
  };

  const sleep = (minutes: number) => {
    clock.current.virtual += minutes * 60_000;
    log.add(`Gập máy ${minutes} phút (đồng hồ nhảy, không có tick nào trong lúc đó)`, 'warn');
  };

  const q = QUESTIONS[index];
  const a = answers[index];
  const { original, ours } = timers;

  return (
    <div className='page ud-exam'>
      <h1>Bài thi có giờ: tự dừng khi rảnh, lưu theo dấu vân tay</h1>
      <p className='hint'>
        Bài thi 60 phút. Đồng hồ trong demo chạy nhanh ×{speed} (5 phút rảnh ≈ {Math.round(300 / speed)} giây thật).
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={() => both((t) => t.start())} data-testid='start'>
          ▶ Bắt đầu / tiếp tục
        </button>
        <button onClick={() => both((t) => t.pause())}>⏸ Tạm dừng</button>
        <button onClick={() => sleep(30)} data-testid='sleep'>
          💤 Gập máy 30 phút
        </button>
        <button onClick={simulateLeave} data-testid='leave'>
          Giả lập rời trang
        </button>
        <label>
          Tốc độ{' '}
          <select value={speed} onChange={(e) => setSpeed(+e.target.value)} data-testid='speed'>
            <option value={1}>×1</option>
            <option value={60}>×60</option>
            <option value={300}>×300</option>
          </select>
        </label>
      </div>
      <div className='stats'>
        <Stat label={`kiểu gốc ${original.isPaused ? '(dừng)' : '(đang chạy)'}`} value={<bdi data-testid='orig-left'>{fmt(original.remaining)}</bdi>} />
        <Stat label={`viết lại ${ours.isPaused ? '(dừng)' : '(đang chạy)'}`} value={<bdi data-testid='ours-left'>{fmt(ours.remaining)}</bdi>} />
        <Stat label='lần lưu kiểu gốc' value={<bdi data-testid='orig-saves'>{saves.original}</bdi>} />
        <Stat label='lần lưu viết lại' value={<bdi data-testid='ours-saves'>{saves.ours}</bdi>} />
      </div>

      <section className='card ud-exam-q'>
        <p className='muted'>
          Câu {index + 1}/{QUESTIONS.length}
        </p>
        <h2>{q.title}</h2>
        {q.kind === 'choice' ? (
          <div role='radiogroup' className='ud-exam-options'>
            {q.options!.map((opt, i) => (
              <label key={opt}>
                <input type='radio' name={`q${index}`} checked={a.selected[0] === i + 1} onChange={() => choose(i + 1)} /> {opt}
              </label>
            ))}
          </div>
        ) : (
          <input
            className='ud-exam-input'
            value={a.text}
            onChange={(e) => type(e.target.value)}
            placeholder='Gõ câu trả lời…'
            data-testid='fill-in'
          />
        )}
        <div className='toolbar'>
          <button disabled={index === 0} onClick={() => go(index - 1)}>
            ← Câu trước
          </button>
          <button disabled={index === QUESTIONS.length - 1} onClick={() => go(index + 1)} data-testid='next'>
            Câu sau →
          </button>
        </div>
      </section>
      <Log lines={log.lines} />
    </div>
  );
}
