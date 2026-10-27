import { useEffect, useMemo, useRef, useState } from 'react';
import {
  classifyFailure,
  createAutosave,
  decodePayload,
  gradeWithRealtime,
  gzipJson,
  type GradeResult,
  type RealtimeClient,
} from '../lib/udGrading';
import { Log, Stat, useLog } from './shared';
import './UdGradingDemo.css';

// ---- Giả lập: kênh realtime kiểu Pusher + server chấm bài ----
// Tin bắn vào kênh lúc chưa ai nghe thì mất luôn (giống Pusher và đa số pub/sub).

type Listener = (data: unknown) => void;

class FakeRealtime implements RealtimeClient {
  private listeners = new Map<string, Listener>();
  constructor(public cfg: { subscribeMs: number; down: boolean }) {}

  subscribe(channel: string, h: Parameters<RealtimeClient['subscribe']>[1]) {
    let active = true;
    const id = setTimeout(() => {
      if (!active) return;
      if (this.cfg.down) return; // không bao giờ subscribe được, không báo lỗi gì (giống mất mạng im lặng)
      this.listeners.set(channel, h.onMessage);
      h.onSubscribed();
    }, this.cfg.subscribeMs);
    return () => {
      active = false;
      clearTimeout(id);
      this.listeners.delete(channel);
    };
  }

  /** server gọi: bắn tin vào kênh; không có ai nghe thì trả false (tin bị mất) */
  publish(channel: string, data: unknown) {
    const listener = this.listeners.get(channel);
    if (!listener) return false;
    listener(data);
    return true;
  }
}

interface ServerState {
  graded: GradeResult | null;
}

function createFakeServer(realtime: FakeRealtime, opts: { gradeMs: number; code: () => string }) {
  const state: ServerState = { graded: null };
  return {
    state,
    async submit(channel: string | null, onEvent: (text: string) => void) {
      state.graded = null;
      const code = opts.code();
      onEvent(`server: nhận bài (${code.length} ký tự), bắt đầu chấm…`);
      setTimeout(async () => {
        const compileError = code.includes('{{');
        const passed = !compileError && !code.includes('bug');
        state.graded = {
          passed,
          compileLogs: compileError ? 'SyntaxError: Unexpected token' : '',
          testLogs: compileError ? 'không chạy được test' : passed ? '3/3 test qua' : '1/3 test qua',
        };
        if (!channel) return;
        const delivered = realtime.publish(channel, await gzipJson(state.graded));
        onEvent(
          delivered ? 'server: đã bắn kết quả (gzip) vào kênh' : 'server: bắn kết quả nhưng KHÔNG ai nghe kênh → mất tin',
        );
      }, opts.gradeMs);
    },
  };
}

type Order = 'subscribe-first' | 'post-first';
type Fallback = 'retry' | 'udemy';

export default function UdGradingDemo() {
  const [code, setCode] = useState('function sum(a, b) {\n  return a + b;\n}');
  const codeRef = useRef(code);
  codeRef.current = code;

  const [order, setOrder] = useState<Order>('subscribe-first');
  const [down, setDown] = useState(false);
  const [gradeMs, setGradeMs] = useState(300);
  const [fallbackMode, setFallbackMode] = useState<Fallback>('retry');
  const [subscribeMs] = useState(600);
  const idleMs = 1500;

  const [status, setStatus] = useState<string>('—');
  const [busy, setBusy] = useState(false);
  const { lines, add, clear } = useLog();

  const realtime = useMemo(() => new FakeRealtime({ subscribeMs, down }), [subscribeMs, down]);
  const server = useMemo(
    () => createFakeServer(realtime, { gradeMs, code: () => codeRef.current }),
    [realtime, gradeMs],
  );

  // ---- autosave: so sánh cách của Udemy (clearTimeout sau khi gán null) với bản sửa ----
  const [saves, setSaves] = useState({ udemy: 0, fixed: 0 });
  const udemyAutosave = useRef<{ id: ReturnType<typeof setTimeout> | null; requested: boolean }>({
    id: null,
    requested: false,
  });
  const fixedAutosave = useMemo(
    () =>
      createAutosave(async () => {
        setSaves((s) => ({ ...s, fixed: s.fixed + 1 }));
      }, 1200),
    [],
  );

  // mô phỏng lại đúng thứ tự trong coding-exercise.mobx-store.js (bản cũ)
  const udemySave = () => {
    setSaves((s) => ({ ...s, udemy: s.udemy + 1 }));
    return Promise.resolve().finally(() => {
      udemyAutosave.current.id = null;
      clearTimeout(udemyAutosave.current.id as unknown as number); // id đã là null: không huỷ được gì
      if (udemyAutosave.current.requested) {
        udemyAutosave.current.requested = false;
        udemyScheduleAutoSave();
      }
    });
  };
  const udemyScheduleAutoSave = () => {
    if (udemyAutosave.current.id) {
      udemyAutosave.current.requested = true;
      return;
    }
    udemyAutosave.current.id = setTimeout(udemySave, 1200);
  };

  useEffect(() => () => fixedAutosave.cancel(), [fixedAutosave]);

  const onType = (value: string) => {
    setCode(value);
    udemyScheduleAutoSave();
    fixedAutosave.schedule();
  };

  async function evaluate() {
    if (busy) return;
    setBusy(true);
    setStatus('đang chấm…');
    // Bấm "Kiểm tra" cũng là một lần lưu (bài gửi kèm code)
    udemySave(); // Udemy: lượt autosave đang hẹn vẫn còn
    fixedAutosave.cancel(); // bản sửa: huỷ lượt đang hẹn
    setSaves((s) => ({ ...s, fixed: s.fixed + 1 }));
    const started = performance.now();
    try {
      if (order === 'subscribe-first') {
        const { result, source } = await gradeWithRealtime({
          client: realtime,
          submit: (channel) => server.submit(channel, (t) => add(t, 'muted')),
          fetchResult: fallbackMode === 'retry' ? fetchRetry : fetchUdemy,
          idleMs,
          fallbackAttempts: fallbackMode === 'retry' ? 6 : 1,
          fallbackIntervalMs: 500,
        });
        report(result, source, started);
      } else {
        // Cách ngây thơ: gửi bài trước, subscribe sau
        const channel = `grade-${crypto.randomUUID()}`;
        await server.submit(channel, (t) => add(t, 'muted'));
        const { result, source } = await new Promise<{ result: GradeResult; source: 'realtime' | 'fallback' }>(
          (resolve, reject) => {
            let done = false;
            const off = realtime.subscribe(channel, {
              onSubscribed: () => add('client: đã subscribe (sau khi gửi bài)', 'muted'),
              onMessage: (raw) =>
                decodePayload(raw).then((r) => {
                  done = true;
                  off();
                  resolve({ result: r as GradeResult, source: 'realtime' });
                }, reject),
              onError: () => {},
            });
            setTimeout(async () => {
              if (done) return;
              off();
              add(`client: ${idleMs}ms không có tin → hỏi lại qua HTTP`, 'warn');
              const r = await (fallbackMode === 'retry' ? pollRetry() : fetchUdemy());
              r ? resolve({ result: r, source: 'fallback' }) : reject(new Error('server chưa chấm xong'));
            }, idleMs);
          },
        );
        report(result, source, started);
      }
    } catch (e) {
      setStatus('lỗi: ' + (e as Error).message);
      add('client: ' + (e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  // Udemy: GET một lần, đọc `score === 1` ngay. Chưa chấm xong thì coi như sai.
  async function fetchUdemy(): Promise<GradeResult | null> {
    add('client: GET kết quả (một lần, kiểu Udemy)', 'warn');
    const g = server.state.graded;
    return g ?? { passed: false, compileLogs: '', testLogs: '(server chưa chấm xong, score=null → hiểu là sai)' };
  }
  // Bản sửa: `null` = chưa chấm xong, gradeWithRealtime sẽ hỏi lại
  async function fetchRetry(): Promise<GradeResult | null> {
    add(`client: GET kết quả → ${server.state.graded ? 'đã chấm' : 'chưa chấm xong, hỏi lại sau'}`, 'warn');
    return server.state.graded;
  }
  async function pollRetry() {
    for (let i = 0; i < 6; i++) {
      const r = await fetchRetry();
      if (r) return r;
      await new Promise((res) => setTimeout(res, 500));
    }
    return null;
  }

  function report(result: GradeResult, source: string, started: number) {
    const kind = classifyFailure(result);
    const ms = Math.round(performance.now() - started);
    const text = `${kind === 'passed' ? '✅ Đạt' : kind === 'compile_error' ? '❌ Lỗi biên dịch' : '❌ Sai test'} — qua ${source}, ${ms}ms — ${result.testLogs}`;
    setStatus(text);
    add('client: ' + text, kind === 'passed' ? 'ok' : 'err');
  }

  return (
    <div className='page udg'>
      <h1>Chấm code qua kênh realtime</h1>
      <p className='hint'>
        Server chấm bài rồi bắn kết quả vào một kênh realtime. Kênh mất <b>{subscribeMs}ms</b> mới subscribe xong; tin
        bắn vào kênh lúc chưa ai nghe thì mất. Không nhận được gì sau <b>{idleMs}ms</b> thì hỏi lại qua HTTP. Thêm chữ{' '}
        <code>bug</code> vào code để bài sai, <code>{'{{'}</code> để lỗi biên dịch.
      </p>

      <textarea
        className='udg-code'
        value={code}
        spellCheck={false}
        onChange={(e) => onType(e.target.value)}
        aria-label='Code của học viên'
      />

      <div className='toolbar' role='group' aria-label='Thứ tự'>
        <button className={order === 'subscribe-first' ? 'primary' : ''} onClick={() => setOrder('subscribe-first')}>
          Subscribe trước, gửi sau (Udemy)
        </button>
        <button className={order === 'post-first' ? 'primary' : ''} onClick={() => setOrder('post-first')}>
          Gửi trước, subscribe sau
        </button>
      </div>
      <div className='toolbar'>
        <label>
          <input type='checkbox' checked={down} onChange={(e) => setDown(e.target.checked)} /> Kênh realtime chết
        </label>
        <label>
          Server chấm mất{' '}
          <select value={gradeMs} onChange={(e) => setGradeMs(Number(e.target.value))}>
            <option value={300}>300ms</option>
            <option value={2500}>2500ms (chậm hơn hạn chờ)</option>
          </select>
        </label>
        <label>
          Hỏi lại{' '}
          <select value={fallbackMode} onChange={(e) => setFallbackMode(e.target.value as Fallback)}>
            <option value='retry'>đến khi chấm xong (bản sửa)</option>
            <option value='udemy'>một lần, đọc score ngay (Udemy)</option>
          </select>
        </label>
      </div>
      <div className='toolbar'>
        <button className='primary' onClick={evaluate} disabled={busy} data-testid='evaluate'>
          ▶ Kiểm tra
        </button>
        <button onClick={clear}>Xoá log</button>
      </div>

      <div className='stats'>
        <Stat label='kết quả' value={<output data-testid='status'>{status}</output>} />
        <Stat label='số lần lưu, kiểu Udemy' value={<output data-testid='saves-udemy'>{saves.udemy}</output>} />
        <Stat label='số lần lưu, bản sửa' value={<output data-testid='saves-fixed'>{saves.fixed}</output>} />
      </div>
      <p className='hint'>
        Gõ một ký tự rồi bấm <b>Kiểm tra</b> ngay (trong vòng 1,2s): kiểu Udemy lưu 2 lần vì lượt autosave đang hẹn không
        bị huỷ; bản sửa lưu 1 lần. Gõ nhiều ký tự thì kiểu Udemy còn lưu thừa thêm một lượt nữa.
      </p>
      <Log lines={lines} />
    </div>
  );
}
