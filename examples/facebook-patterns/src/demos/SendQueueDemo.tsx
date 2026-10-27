import { useEffect, useMemo, useRef, useState } from 'react';
import { createPausableSync, createSendQueue, guardUnsentOnUnload, type FailReason } from '../lib/sendQueue';
import { Log, Stat, sleep, useLog } from './shared';
import './SendQueueDemo.css';

type Mode = 'parallel' | 'queue';

interface ChatMessage {
  clientId: string;
  text: string;
  index: number;
  status: 'queued' | 'sending' | 'sent' | 'failed';
  serverId?: number;
  /** tin được thêm từ luồng đồng bộ, không phải do mình gõ */
  fromSync?: boolean;
  reason?: FailReason;
}

interface Delta {
  serverId: number;
  clientId: string;
  text: string;
}

/**
 * Độ trễ upload cố định theo thứ tự (để kết quả lặp lại được): tin 1 chậm, tin 2 nhanh…
 * Gửi song song thì server nhận theo thứ tự upload xong, không theo thứ tự gõ.
 */
const UPLOAD_MS = [520, 180, 400, 90, 260];
const DELTA_AFTER_MS = 40; // kênh push nhanh hơn response HTTP
const RESPONSE_AFTER_MS = 260;

export default function SendQueueDemo() {
  // "Làm lại" = remount toàn bộ: hàng đợi, server giả và luồng sync đều tạo mới
  const [run, setRun] = useState(0);
  return <SendQueueChat key={run} onReset={() => setRun((n) => n + 1)} />;
}

function SendQueueChat({ onReset }: { onReset: () => void }) {
  const { lines, add, clear } = useLog(40);
  const [mode, setMode] = useState<Mode>('queue');
  const [pauseSync, setPauseSync] = useState(true);
  const [failThird, setFailThird] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [serverLog, setServerLog] = useState<Array<{ serverId: number; text: string }>>([]);
  const counterRef = useRef(0);
  const nextServerIdRef = useRef(100);
  const serverSeenRef = useRef(new Map<string, number>()); // clientId → serverId (idempotency)
  const failedOnceRef = useRef(new Set<string>());
  const pausedByQueueRef = useRef(false);
  const optsRef = useRef({ mode, pauseSync, failThird });
  optsRef.current = { mode, pauseSync, failThird };

  // Luồng đồng bộ: delta về mà chưa thấy serverId nào khớp thì coi là tin mới.
  // Đây chính là chỗ sinh ra tin trùng khi delta tới trước response.
  const sync = useMemo(
    () =>
      createPausableSync<Delta>((delta) => {
        setMessages((prev) =>
          prev.some((m) => m.serverId === delta.serverId)
            ? prev
            : [...prev, { clientId: `sync-${delta.serverId}`, text: delta.text, index: -1, status: 'sent', serverId: delta.serverId, fromSync: true }],
        );
      }),
    [],
  );

  // "Server" giả: nhận tin (bỏ qua tin trùng theo clientId), đẩy delta qua kênh realtime,
  // rồi mới trả response cho request HTTP.
  const fakeServerSend = useMemo(
    () =>
      async (message: ChatMessage, signal?: AbortSignal): Promise<{ serverId: number }> => {
        await sleep(UPLOAD_MS[(message.index - 1) % UPLOAD_MS.length]);
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        if (optsRef.current.failThird && message.index === 3 && !failedOnceRef.current.has(message.clientId)) {
          failedOnceRef.current.add(message.clientId);
          throw new Error('500 Internal Server Error');
        }
        let serverId = serverSeenRef.current.get(message.clientId);
        if (serverId == null) {
          serverId = nextServerIdRef.current++;
          serverSeenRef.current.set(message.clientId, serverId);
          const id = serverId;
          setServerLog((log) => [...log, { serverId: id, text: message.text }]);
          setTimeout(() => sync.push({ serverId: id, clientId: message.clientId, text: message.text }), DELTA_AFTER_MS);
        }
        await sleep(RESPONSE_AFTER_MS);
        return { serverId };
      },
    [sync],
  );

  const update = (clientId: string, patch: Partial<ChatMessage>) =>
    setMessages((prev) => prev.map((m) => (m.clientId === clientId ? { ...m, ...patch } : m)));

  const onSent = (message: ChatMessage, { serverId }: { serverId: number }) => {
    update(message.clientId, { status: 'sent', serverId, reason: undefined });
    add(`"${message.text}" → server #${serverId}`, 'ok');
  };
  const onFailed = (message: ChatMessage, reason: FailReason) => {
    update(message.clientId, { status: 'failed', reason });
    add(
      reason === 'cascade'
        ? `"${message.text}" bị đánh dấu lỗi theo tin trước (giữ thứ tự)`
        : `"${message.text}" gửi lỗi (${reason})`,
      'err',
    );
  };

  const queue = useMemo(
    () =>
      createSendQueue<ChatMessage, { serverId: number }>({
        send: (m, signal) => {
          update(m.clientId, { status: 'sending' });
          return fakeServerSend(m, signal);
        },
        timeoutMs: 5000,
        onSent,
        onFailed,
        sync: {
          pause: () => {
            if (!optsRef.current.pauseSync) return;
            pausedByQueueRef.current = true;
            sync.pause();
          },
          resume: () => {
            if (!pausedByQueueRef.current) return;
            pausedByQueueRef.current = false;
            sync.resume();
          },
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fakeServerSend, sync],
  );
  useEffect(() => guardUnsentOnUnload(queue), [queue]);
  useEffect(() => () => queue.destroy(), [queue]);

  // Gửi song song: mỗi tin một request độc lập
  const sendParallel = async (message: ChatMessage) => {
    const paused = optsRef.current.pauseSync;
    if (paused) sync.pause();
    update(message.clientId, { status: 'sending' });
    try {
      onSent(message, await fakeServerSend(message));
    } catch {
      onFailed(message, 'error');
    } finally {
      if (paused) sync.resume();
    }
  };

  const send = (text: string) => {
    const index = ++counterRef.current;
    const message: ChatMessage = { clientId: `c-${index}-${Date.now().toString(36)}`, text, index, status: 'queued' };
    setMessages((prev) => [...prev, message]);
    if (optsRef.current.mode === 'queue') queue.enqueue(message);
    else void sendParallel(message);
  };

  const burst = () => {
    for (let i = 1; i <= 5; i++) send(`Tin ${counterRef.current + 1}`);
  };

  const retry = () => {
    if (optsRef.current.mode === 'queue') {
      queue.retryFailed();
    } else {
      messages.filter((m) => m.status === 'failed').forEach((m) => void sendParallel(m));
    }
  };

  const sentOrder = messages.filter((m) => !m.fromSync).map((m) => m.text);
  const serverOrder = serverLog.map((s) => s.text);
  const outOfOrder = serverOrder.some((t, i) => sentOrder[i] !== t);
  const duplicates = messages.filter((m) => m.fromSync).length;
  const failedCount = messages.filter((m) => m.status === 'failed').length;

  return (
    <div className='page sq-demo'>
      <h1>Hàng đợi gửi tin giữ thứ tự</h1>
      <p className='hint'>
        Bấm "Gửi nhanh 5 tin". Gửi song song thì server nhận theo thứ tự upload xong (tin 2 và tin 4
        upload nhanh hơn), cuộc trò chuyện bị đảo. Tắt "tạm dừng sync" thì bản vọng lại của tin
        mình gửi về trước response và hiện thành tin thứ hai.
      </p>
      <div className='toolbar'>
        <label>
          Cách gửi{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} data-testid='sq-mode'>
            <option value='queue'>hàng đợi tuần tự (Facebook)</option>
            <option value='parallel'>song song, mỗi tin một request</option>
          </select>
        </label>
        <label className='switch'>
          <input type='checkbox' checked={pauseSync} onChange={(e) => setPauseSync(e.target.checked)} data-testid='sq-pause' />
          Tạm dừng sync khi đang gửi
        </label>
        <label className='switch'>
          <input type='checkbox' checked={failThird} onChange={(e) => setFailThird(e.target.checked)} data-testid='sq-fail' />
          Server lỗi ở lần đầu gửi tin 3
        </label>
      </div>
      <div className='toolbar'>
        <button className='primary' onClick={burst}>
          Gửi nhanh 5 tin
        </button>
        <button onClick={retry} disabled={failedCount === 0}>
          Gửi lại tin lỗi ({failedCount})
        </button>
        <button
          onClick={() => {
            clear();
            onReset();
          }}
        >
          Làm lại
        </button>
      </div>

      <div className='stats'>
        <Stat label='thứ tự trên server' value={<output data-testid='sq-order'>{outOfOrder ? 'bị đảo' : 'đúng'}</output>} />
        <Stat label='tin hiện trùng' value={<output data-testid='sq-dupes'>{duplicates}</output>} />
        <Stat label='tin lỗi' value={failedCount} />
      </div>

      <div className='split'>
        <div className='card sq-chat'>
          <b>Máy mình</b>
          <div className='sq-bubbles'>
            {messages.map((m) => (
              <div key={m.clientId} className={`sq-bubble ${m.fromSync ? 'sq-dupe' : ''} sq-${m.status}`}>
                {m.text}
                <span className='sq-status'>
                  {m.fromSync
                    ? 'trùng (từ sync)'
                    : m.status === 'sent'
                      ? `✓ #${m.serverId}`
                      : m.status === 'failed'
                        ? m.reason === 'cascade'
                          ? '⚠ chờ tin trước'
                          : '⚠ lỗi'
                        : m.status === 'sending'
                          ? 'đang gửi…'
                          : 'trong hàng đợi'}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className='card'>
          <b>Server nhận theo thứ tự</b>
          <ol className='sq-server' data-testid='sq-server'>
            {serverLog.map((s) => (
              <li key={s.serverId}>
                {s.text} <span className='muted'>#{s.serverId}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <Log lines={lines} />
    </div>
  );
}
