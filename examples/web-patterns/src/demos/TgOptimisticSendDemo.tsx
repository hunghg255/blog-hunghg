import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applySendUpdate,
  createMessageSender,
  type MessageSender,
  type OutgoingMessage,
  type SendTransport,
} from '../lib/tgOptimisticSend';
import { Log, Stat, sleep, useLog } from './shared';
import './TgOptimisticSendDemo.css';

interface ServerMessage {
  id: number;
  text: string;
}

interface NetSettings {
  latency: number;
  lostResponse: number;
}

/** Server giả: nhớ randomId đã thấy, gửi trùng thì trả lại id cũ (idempotency). */
function createFakeServer(settings: { current: NetSettings }, onChange: () => void, log: (t: string, tone?: 'ok' | 'warn' | 'err') => void) {
  const byRandomId = new Map<string, ServerMessage>();
  const order: ServerMessage[] = [];
  let nextId = 501;
  let duplicates = 0;

  const jitter = () => settings.current.latency * (0.6 + Math.random() * 0.8);

  const transport: SendTransport = {
    async upload(file, onProgress) {
      // ~2MB/s
      const total = Math.max(300, (file.size / 2_000_000) * 1000);
      for (let t = 0; t < total; t += 100) {
        await sleep(100);
        onProgress(Math.min(1, (t + 100) / total));
      }
      return `media:${file.name}`;
    },
    async send({ randomId, text, media }) {
      await sleep(jitter() / 2);
      let message = byRandomId.get(randomId);
      if (message) {
        duplicates++;
        log(`server: randomId ${randomId.slice(0, 6)}… đã có, trả lại #${message.id}`, 'warn');
      } else {
        message = { id: nextId++, text: media ? `🖼 ${text}` : text };
        byRandomId.set(randomId, message);
        order.push(message);
        onChange();
      }
      await sleep(jitter() / 2);
      if (Math.random() < settings.current.lostResponse) {
        throw new Error('mất response (server đã lưu)');
      }
      return { id: message.id };
    },
  };

  return { transport, order, getDuplicates: () => duplicates };
}

const SCENARIOS = {
  photo: 'Ảnh 4MB rồi 2 tin chữ',
  burst: '5 tin liên tiếp',
};

export default function TgOptimisticSendDemo() {
  const { lines, add, clear } = useLog(40);
  const [messages, setMessages] = useState<OutgoingMessage[]>([]);
  const [serverOrder, setServerOrder] = useState<ServerMessage[]>([]);
  const [latency, setLatency] = useState(600);
  const [lostResponse, setLostResponse] = useState(0);
  const [keepOrder, setKeepOrder] = useState(true);
  const [delayClock, setDelayClock] = useState(true);
  const [clockShown, setClockShown] = useState(0);
  const [draft, setDraft] = useState('Xin chào!');
  const settings = useRef<NetSettings>({ latency, lostResponse });
  settings.current = { latency, lostResponse };

  const server = useMemo(
    () => createFakeServer(settings, () => setServerOrder([...serverRef.current!.order]), add),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const serverRef = useRef(server);
  serverRef.current = server;

  const senderRef = useRef<MessageSender | null>(null);
  useEffect(() => {
    const sender = createMessageSender({
      transport: server.transport,
      pendingDelayMs: delayClock ? 1000 : 0,
      keepOrder,
      onUpdate: (update) => {
        if (update.type === 'pending') setClockShown((n) => n + 1);
        if (update.type === 'failed') add(`tin #${update.localId}: ${update.error}`, 'err');
        if (update.type === 'succeeded') add(`tin tạm ${update.localId} → id thật #${update.id}`, 'ok');
        setMessages((list) => applySendUpdate(list, update));
      },
    });
    senderRef.current = sender;
    return () => sender.destroy();
  }, [server, keepOrder, delayClock, add]);

  const send = (text: string, attachment?: { name: string; size: number }) => {
    void senderRef.current?.send(text, attachment);
  };

  const runScenario = (name: keyof typeof SCENARIOS) => {
    if (name === 'photo') {
      send('ảnh chuyến đi', { name: 'beach.jpg', size: 4_000_000 });
      send('Ảnh hôm qua nè');
      send('Đẹp không?');
    } else {
      for (let i = 1; i <= 5; i++) send(`Tin số ${i}`);
    }
  };

  const reset = () => {
    setMessages([]);
    setClockShown(0);
    server.order.length = 0;
    setServerOrder([]);
    clear();
  };

  const orderBroken = useMemo(() => {
    const clientTexts = messages.map((m) => (m.attachment ? `🖼 ${m.text}` : m.text));
    const serverTexts = serverOrder.map((m) => m.text);
    const common = clientTexts.filter((t) => serverTexts.includes(t));
    const serverCommon = serverTexts.filter((t) => common.includes(t));
    return common.some((t, i) => serverCommon[i] !== t);
  }, [messages, serverOrder]);

  return (
    <div className='page tg-send'>
      <h1>Gửi tin lạc quan</h1>
      <p className='hint'>
        Tin hiện ngay với id tạm (≥ 1e9). Icon 🕓 chỉ hiện nếu sau 1 giây server chưa xác nhận. Upload chạy song song, lệnh
        gửi đi đúng thứ tự. Bật "mất response" để thấy nút gửi lại dùng cùng <code>randomId</code> nên server không tạo tin
        trùng.
      </p>

      <div className='toolbar'>
        <label>
          Độ trễ mạng: <b>{latency}ms</b>
          <input type='range' min={100} max={3000} step={100} value={latency} onChange={(e) => setLatency(+e.target.value)} />
        </label>
        <label>
          Mất response: <b>{Math.round(lostResponse * 100)}%</b>
          <input type='range' min={0} max={0.6} step={0.1} value={lostResponse} onChange={(e) => setLostResponse(+e.target.value)} />
        </label>
      </div>
      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={delayClock} onChange={(e) => setDelayClock(e.target.checked)} /> Chờ 1s mới hiện 🕓
        </label>
        <label className='switch'>
          <input type='checkbox' checked={keepOrder} onChange={(e) => setKeepOrder(e.target.checked)} /> Giữ thứ tự gửi
        </label>
      </div>

      <div className='stats'>
        <Stat label='lần hiện 🕓' value={clockShown} />
        <Stat label='tin trên server' value={serverOrder.length} />
        <Stat label='gửi trùng bị bỏ qua' value={server.getDuplicates()} />
        <Stat label='thứ tự' value={orderBroken ? <span className='err'>lệch</span> : <span className='ok'>đúng</span>} />
      </div>

      <div className='split tg-send-split'>
        <div className='card'>
          <h3>Màn hình người gửi</h3>
          <ol className='tg-send-chat'>
            {messages.map((m) => (
              // key = localId: khi id đổi sang id thật, React không remount bong bóng
              <li key={m.localId} className={`tg-send-bubble ${m.state ?? ''}`}>
                <span>{m.attachment ? `🖼 ${m.text}` : m.text}</span>
                {m.attachment && m.state !== 'sent' && m.progress !== undefined && (
                  <progress max={1} value={m.progress} aria-label='tiến độ upload' />
                )}
                <small>
                  {m.id >= 1e9 ? `tạm ${m.id}` : `#${m.id}`}{' '}
                  {m.state === 'pending' && <span title='đang gửi'>🕓</span>}
                  {m.state === 'sent' && <span title='đã gửi'>✓</span>}
                  {m.state === 'failed' && (
                    <button type='button' onClick={() => void senderRef.current?.retry(m.localId)}>
                      ⚠ Gửi lại
                    </button>
                  )}
                </small>
              </li>
            ))}
          </ol>
          <form
            className='tg-send-form'
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) send(draft.trim());
            }}
          >
            <input type='text' value={draft} onChange={(e) => setDraft(e.target.value)} aria-label='Nội dung tin' />
            <button className='primary' type='submit'>
              Gửi
            </button>
          </form>
        </div>
        <div className='card'>
          <h3>Thứ tự trên server</h3>
          <ol className='tg-send-server'>
            {serverOrder.map((m) => (
              <li key={m.id}>
                #{m.id} {m.text}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className='toolbar'>
        <button type='button' onClick={() => runScenario('photo')}>
          {SCENARIOS.photo}
        </button>
        <button type='button' onClick={() => runScenario('burst')}>
          {SCENARIOS.burst}
        </button>
        <button type='button' onClick={reset}>
          Xoá
        </button>
      </div>
      <Log lines={lines} />
    </div>
  );
}
