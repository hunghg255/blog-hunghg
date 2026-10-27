import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { SmartCompose, type Candidate, type SmartComposeEvent } from '../lib/smartCompose';
import { Log, Stat, useLog } from './shared';
import './SmartComposeDemo.css';

// "Server" giả: các câu trả lời hay dùng của một shop trên Messenger.
const PHRASES = [
  'cảm ơn bạn đã quan tâm đến sản phẩm của shop',
  'cảm ơn bạn đã đặt hàng, shop sẽ giao trong 2 ngày',
  'shop xin phép kiểm tra đơn hàng và phản hồi bạn ngay',
  'shop xin lỗi vì sự bất tiện này',
  'bạn vui lòng gửi giúp shop mã đơn hàng nhé',
  'bạn vui lòng chờ shop một chút nhé',
  'sản phẩm hiện còn đủ size từ S đến XL',
  'phí giao hàng nội thành là 20.000đ',
];

function makeServer(latencyRef: { current: number }, onCall: () => void) {
  return (text: string, signal: AbortSignal) =>
    new Promise<Candidate[]>((resolve, reject) => {
      onCall();
      const timer = setTimeout(() => {
        const q = text.toLowerCase();
        resolve(
          PHRASES.filter((p) => p.startsWith(q) && p.length > q.length).map((p, i) => ({
            text: p.slice(q.length),
            confidence: 0.9 - i * 0.1,
          })),
        );
      }, latencyRef.current);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
}

const SCRIPT = 'cảm ơn bạn đã đặt';

export default function SmartComposeDemo() {
  const [text, setText] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [latency, setLatency] = useState(250);
  const [minRemaining, setMinRemaining] = useState(6);
  const [minInterval, setMinInterval] = useState(100);
  const [generation, setGeneration] = useState(0);
  const [stats, setStats] = useState({ keys: 0, queries: 0, cancelled: 0, displayed: 0, accepted: 0 });
  const { lines, add } = useLog(40);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const latencyRef = useRef(latency);
  latencyRef.current = latency;
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bump = (key: keyof typeof stats) => setStats((s) => ({ ...s, [key]: s[key] + 1 }));

  // tạo lại engine khi đổi ngưỡng (giống đổi cấu hình ở server)
  const engine = useMemo(() => {
    const onEvent = (e: SmartComposeEvent) => {
      if (e.type === 'query') add(e.warmUp ? 'query rỗng để làm ấm kết nối' : `query "${e.text}"`, 'muted');
      if (e.type === 'query-done') add(`↳ ${e.count} ứng viên sau ${e.ms}ms`, 'muted');
      if (e.type === 'query-cancelled') {
        add(`↳ huỷ query "${e.text}" (đã có query mới)`, 'warn');
        bump('cancelled');
      }
      if (e.type === 'displayed') {
        add(`hiện gợi ý "${e.suggestion}" (phím cách ${e.keyIntervalMs}ms)`, 'ok');
        bump('displayed');
      }
      if (e.type === 'accepted') {
        add(`nhận gợi ý bằng Tab`, 'ok');
        bump('accepted');
      }
      if (e.type === 'typed-it-all') add('người dùng tự gõ hết đúng câu đã gợi ý', 'ok');
    };
    return new SmartCompose({
      fetchCandidates: makeServer(latencyRef, () => bump('queries')),
      minRemaining,
      minKeyIntervalMs: minInterval,
      onSuggestionChange: setSuggestion,
      onEvent,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minRemaining, minInterval, generation]);
  const engineRef = useRef(engine);
  engineRef.current = engine;

  useEffect(() => () => engine.dispose(), [engine]);
  useEffect(() => () => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
  }, []);

  const reset = () => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    setText('');
    setSuggestion('');
    setStats({ keys: 0, queries: 0, cancelled: 0, displayed: 0, accepted: 0 });
    setGeneration((g) => g + 1); // engine mới, state sạch
  };

  const change = (value: string, el: HTMLTextAreaElement | null) => {
    setText(value);
    bump('keys');
    const atEnd = !el || (el.selectionStart === value.length && el.selectionEnd === value.length);
    engineRef.current.update(value, atEnd);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.key === 'Tab' || event.key === 'ArrowRight') && suggestion) {
      event.preventDefault();
      const inserted = engineRef.current.accept();
      setText((t) => t + inserted);
    }
  };

  const autoType = (delay: number) => {
    reset();
    let i = 0;
    let current = '';
    const step = () => {
      if (i >= SCRIPT.length) return;
      current += SCRIPT[i++];
      change(current, null);
      autoTimer.current = setTimeout(step, delay);
    };
    autoTimer.current = setTimeout(step, 300);
  };

  return (
    <div className='page smart-compose'>
      <h1>Smart Compose: gợi ý chữ mờ</h1>
      <p className='hint'>
        Gõ một câu trả lời khách (thử "<b>cảm ơn bạn đã </b>" rồi chữ "<b>đ</b>"). Gợi ý chỉ hiện khi phần còn thiếu đủ
        dài và bạn gõ không quá nhanh. Bấm <kbd>Tab</kbd> hoặc <kbd>→</kbd> để nhận.
      </p>

      <div className='toolbar'>
        <button onClick={() => autoType(160)}>Gõ tự động, chậm (160ms/phím)</button>
        <button onClick={() => autoType(50)}>Gõ tự động, nhanh (50ms/phím)</button>
        <button onClick={reset}>Xoá</button>
      </div>

      <div className='sc-editor'>
        <div className='sc-mirror' aria-hidden='true'>
          <span className='sc-typed'>{text}</span>
          <span className='sc-ghost'>{suggestion}</span>
        </div>
        <textarea
          ref={inputRef}
          className='sc-input'
          value={text}
          placeholder='Nhập tin nhắn…'
          rows={3}
          spellCheck={false}
          onChange={(e) => change(e.target.value, e.target)}
          onKeyDown={onKeyDown}
          onSelect={(e) => {
            const el = e.currentTarget;
            engineRef.current.setCursorAtEnd(el.selectionStart === el.value.length && el.selectionEnd === el.value.length);
          }}
          aria-describedby='sc-hint'
        />
      </div>
      <p id='sc-hint' className='sc-status' aria-live='polite'>
        {suggestion ? `Gợi ý: "${suggestion}" (Tab để nhận)` : 'Chưa có gợi ý'}
      </p>

      <div className='toolbar sc-controls'>
        <label>
          Độ trễ server {latency}ms
          <input type='range' min={50} max={1000} step={50} value={latency} onChange={(e) => setLatency(+e.target.value)} />
        </label>
        <label>
          Phần còn thiếu ≥ {minRemaining} ký tự
          <input type='range' min={0} max={15} value={minRemaining} onChange={(e) => setMinRemaining(+e.target.value)} />
        </label>
        <label>
          Phím cách nhau ≥ {minInterval}ms
          <input type='range' min={0} max={300} step={10} value={minInterval} onChange={(e) => setMinInterval(+e.target.value)} />
        </label>
      </div>

      <div className='stats'>
        <Stat label='lần gõ' value={stats.keys} />
        <Stat label='query gửi server' value={stats.queries} />
        <Stat label='query bị huỷ' value={stats.cancelled} />
        <Stat label='gợi ý đã hiện' value={stats.displayed} />
        <Stat label='nhận gợi ý' value={stats.accepted} />
      </div>
      <Log lines={lines} />
    </div>
  );
}
