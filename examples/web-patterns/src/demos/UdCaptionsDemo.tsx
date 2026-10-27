import { useEffect, useMemo, useRef, useState } from 'react';
import {
  EDITOR_KEYMAP,
  autoSelectCaption,
  commandFromKey,
  createPauseWhenTyping,
  cueIndexAt,
  isLowQuality,
  type CaptionTrack,
  type EditableCue,
} from '../lib/udCaptions';
import { Log, Stat, useLog } from './shared';
import './UdCaptionsDemo.css';

const TRACKS: CaptionTrack[] = [
  { id: 't-en', locale: 'en_US', label: 'English' },
  { id: 't-vi', locale: 'vi_VN', label: 'Tiếng Việt' },
  { id: 't-zhcn', locale: 'zh_CN', label: '中文（简体）' },
  { id: 't-zhtw', locale: 'zh_TW', label: '中文（繁體）' },
  { id: 't-fi', locale: 'fi_FI', label: 'Suomi' },
];

const LOCALES = ['vi_VN', 'en_US', 'zh_CN', 'zh_TW', 'fil_PH', 'ja_JP'];

/**
 * Mô phỏng cách chọn của bản gốc (không phải mã của Udemy): ngôn ngữ = 2 ký tự đầu của
 * locale, duyệt cả danh sách và giữ track khớp CUỐI CÙNG.
 */
function udemyStyleSelect(saved: string | undefined, userLocale: string, defaultOn: boolean) {
  if (saved === '') return null;
  const cookieLang = saved ? saved.slice(0, 2) : undefined;
  const userLang = userLocale.slice(0, 2);
  const useUser = userLang !== 'en' || defaultOn;
  let cookieTrack: CaptionTrack | undefined;
  let userTrack: CaptionTrack | undefined;
  let enTrack: CaptionTrack | undefined;
  for (const track of TRACKS) {
    const lang = track.locale.slice(0, 2);
    if (cookieLang && lang === cookieLang) cookieTrack = track;
    else if (useUser && lang === userLang) userTrack = track;
    else if (useUser && lang === 'en') enTrack = track;
  }
  return cookieTrack ?? userTrack ?? enTrack ?? null;
}

const CUES: EditableCue[] = [
  { id: 1, start: 0, end: 3, text: 'xin chào các bạn đến với khoá học' },
  { id: 2, start: 3, end: 6, text: 'hôm nay chúng ta học về react hút' },
  { id: 3, start: 6, end: 9, text: 'trước hết hãy cài đặt node gs' },
  { id: 4, start: 9, end: 12, text: 'sau đó tạo một dự án mới bằng vite' },
  { id: 5, start: 12, end: 15, text: 'mở thư mục src và tìm file main' },
  { id: 6, start: 15, end: 18, text: 'chạy lệnh npm run dev để xem kết quả' },
];
const DURATION = 18;

export default function UdCaptionsDemo() {
  // ---- phần 1: tự chọn phụ đề ----
  const [userLocale, setUserLocale] = useState('zh_CN');
  const [saved, setSaved] = useState<string | undefined>(undefined);
  const [defaultOn, setDefaultOn] = useState(false);
  const ours = useMemo(
    () => autoSelectCaption({ captions: TRACKS, saved, userLocale, defaultOn }),
    [saved, userLocale, defaultOn],
  );
  const theirs = useMemo(() => udemyStyleSelect(saved, userLocale, defaultOn), [saved, userLocale, defaultOn]);

  // ---- phần 2: editor ----
  const [cues, setCues] = useState(CUES);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [editingId, setEditingId] = useState(1);
  const [pauseWhenTyping, setPauseWhenTyping] = useState(true);
  const [autoResume, setAutoResume] = useState(false);
  const [confidence, setConfidence] = useState(0.41);
  const log = useLog(30);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  // "video" giả: đồng hồ chạy bằng requestAnimationFrame
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function frame(now) {
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => (t + dt >= DURATION ? 0 : t + dt));
      raf = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const typing = useMemo(
    () =>
      createPauseWhenTyping({
        pause: () => {
          setPlaying(false);
          log.add('Đang gõ → dừng video', 'warn');
        },
        resume: autoResume
          ? () => {
              setPlaying(true);
              log.add('Ngừng gõ 1,5 giây → phát tiếp', 'ok');
            }
          : undefined,
      }),
    [autoResume, log.add],
  );
  useEffect(() => () => typing.dispose(), [typing]);

  const editingIndex = cues.findIndex((c) => c.id === editingId);
  const playingIndex = cueIndexAt(cues, time);

  const selectCue = (index: number) => {
    const cue = cues[index];
    if (!cue) return;
    setEditingId(cue.id);
    // chỉ tua khi câu đó chưa đang phát, giống selectCue của Udemy
    if (cueIndexAt(cues, time) !== index) setTime(cue.start);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const command = commandFromKey(event.nativeEvent);
    if (!command) return;
    event.preventDefault();
    log.add(`Phím tắt: ${command}`);
    if (command === 'toggle-play') {
      typing.onManualToggle();
      setPlaying((p) => !p);
    } else if (command === 'seek-back') setTime((t) => Math.max(0, t - 1));
    else if (command === 'seek-forward') setTime((t) => Math.min(DURATION - 0.01, t + 1));
    else if (command === 'prev-cue') selectCue(editingIndex - 1);
    else if (command === 'next-cue') selectCue(editingIndex + 1);
  };

  const onChange = (text: string) => {
    setCues((list) => list.map((c) => (c.id === editingId ? { ...c, text } : c)));
    if (pauseWhenTyping) typing.onInput(playingRef.current);
  };

  const editing = cues[editingIndex];

  return (
    <div className='page ud-captions'>
      <h1>Phụ đề: tự chọn ngôn ngữ và editor có phím tắt</h1>

      <section className='card'>
        <h2>1. Mở video lần đầu: bật phụ đề nào?</h2>
        <p className='hint'>
          Video có 5 track: en_US, vi_VN, zh_CN, zh_TW, fi_FI. Đổi ngôn ngữ giao diện và lựa chọn đã lưu để xem hai
          cách chọn khác nhau ở đâu.
        </p>
        <div className='toolbar'>
          <label>
            Giao diện{' '}
            <select value={userLocale} onChange={(e) => setUserLocale(e.target.value)} data-testid='locale'>
              {LOCALES.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label>
            Đã lưu{' '}
            <select
              value={saved === undefined ? '__none' : saved === '' ? '__off' : saved}
              onChange={(e) =>
                setSaved(e.target.value === '__none' ? undefined : e.target.value === '__off' ? '' : e.target.value)
              }
              data-testid='saved'
            >
              <option value='__none'>chưa từng chọn</option>
              <option value='__off'>đã tắt phụ đề</option>
              <option value='zh_CN'>zh_CN</option>
              <option value='vi_VN'>vi_VN</option>
            </select>
          </label>
          <label>
            <input type='checkbox' checked={defaultOn} onChange={(e) => setDefaultOn(e.target.checked)} /> bật mặc
            định cả với tiếng Anh
          </label>
        </div>
        <div className='stats'>
          <Stat label='kiểu bản gốc (2 ký tự, giữ track cuối)' value={<bdi data-testid='theirs'>{theirs?.locale ?? 'tắt'}</bdi>} />
          <Stat
            label={`bản viết lại (${ours.reason})`}
            value={<bdi data-testid='ours'>{ours.caption?.locale ?? 'tắt'}</bdi>}
          />
        </div>
      </section>

      <section className='card'>
        <h2>2. Editor phụ đề</h2>
        {isLowQuality(confidence) && (
          <p className='ud-cap-warn' role='status' data-testid='low-quality'>
            Phụ đề này được tạo tự động (độ tin cậy {confidence.toFixed(2)} ≤ 0.43), có thể sai nhiều. Hãy rà lại.
          </p>
        )}
        <div className='toolbar'>
          <label>
            Độ tin cậy ASR{' '}
            <input
              type='range'
              min={0}
              max={1}
              step={0.01}
              value={confidence}
              onChange={(e) => setConfidence(+e.target.value)}
            />{' '}
            {confidence.toFixed(2)}
          </label>
          <label>
            <input type='checkbox' checked={pauseWhenTyping} onChange={(e) => setPauseWhenTyping(e.target.checked)} />{' '}
            dừng khi gõ
          </label>
          <label>
            <input type='checkbox' checked={autoResume} onChange={(e) => setAutoResume(e.target.checked)} /> tự phát lại
            (thêm, bản gốc không có)
          </label>
        </div>

        <div className='ud-cap-player' aria-label='Video giả'>
          <div className='ud-cap-screen'>
            <span className='ud-cap-overlay'>{playingIndex >= 0 ? cues[playingIndex].text : ''}</span>
          </div>
          <div className='ud-cap-bar'>
            <button
              onClick={() => {
                typing.onManualToggle();
                setPlaying((p) => !p);
              }}
              data-testid='play'
            >
              {playing ? '⏸' : '▶'}
            </button>
            <progress value={time} max={DURATION} />
            <span data-testid='time'>{time.toFixed(1)}s</span>
          </div>
        </div>

        <div className='split'>
          <ol className='ud-cap-list'>
            {cues.map((cue, i) => (
              <li key={cue.id}>
                <button
                  className={[i === editingIndex ? 'editing' : '', i === playingIndex ? 'playing' : ''].join(' ')}
                  onClick={() => selectCue(i)}
                >
                  <small>
                    {cue.start}s–{cue.end}s
                  </small>{' '}
                  {cue.text}
                </button>
              </li>
            ))}
          </ol>
          <div>
            <label htmlFor='ud-cap-edit'>
              Đang sửa câu #{editing?.id} ({editing?.start}s–{editing?.end}s)
            </label>
            <textarea
              id='ud-cap-edit'
              ref={textareaRef}
              rows={3}
              value={editing?.text ?? ''}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              data-testid='editor'
            />
            <ul className='ud-cap-keys'>
              {EDITOR_KEYMAP.map((k) => (
                <li key={k.key}>
                  <kbd>{k.key.replace('arrow', '')}</kbd> {k.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Log lines={log.lines} />
      </section>
    </div>
  );
}
