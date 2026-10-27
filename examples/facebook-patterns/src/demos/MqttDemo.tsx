import { useMemo, useState } from 'react';
import { MqttStreamDecoder, decodeMessages, encodePublish, payloadText, type WireMessage } from '../lib/mqttCodec';
import { backoffDelay, shouldLongPoll } from '../lib/mqttTransport';
import { Stat } from './shared';
import './MqttDemo.css';

const hex = (n: number) => n.toString(16).padStart(2, '0');

// ---------- A. Mổ xẻ một gói PUBLISH ----------

function PacketAnatomy() {
  const [text, setText] = useState('Chào bạn 👋');
  const [qos, setQos] = useState<0 | 1>(1);
  const topic = '/t_ms';
  const bytes = useMemo(() => encodePublish(topic, JSON.stringify({ text }), qos, 42), [text, qos]);
  const decoded = decodeMessages(bytes).messages[0];

  // tô màu từng đoạn byte
  let lenBytes = 1;
  while (bytes[lenBytes] & 0x80) lenBytes++;
  const parts: { label: string; cls: string; from: number; to: number }[] = [];
  let at = 0;
  parts.push({ label: 'header', cls: 'p-head', from: at, to: (at += 1) });
  parts.push({ label: 'độ dài', cls: 'p-len', from: at, to: (at += lenBytes) });
  parts.push({ label: 'độ dài topic', cls: 'p-tlen', from: at, to: (at += 2) });
  parts.push({ label: 'topic', cls: 'p-topic', from: at, to: (at += topic.length) });
  if (qos === 1) parts.push({ label: 'message id', cls: 'p-id', from: at, to: (at += 2) });
  parts.push({ label: 'payload', cls: 'p-body', from: at, to: bytes.length });

  return (
    <section className='card'>
      <h2>1. Một gói PUBLISH trông như thế nào</h2>
      <div className='toolbar'>
        <input value={text} onChange={(e) => setText(e.target.value)} aria-label='Nội dung tin' />
        <label className='switch'>
          <input type='checkbox' checked={qos === 1} onChange={(e) => setQos(e.target.checked ? 1 : 0)} /> QoS 1 (cần
          PUBACK)
        </label>
      </div>
      <div className='mq-bytes' aria-label='Các byte của gói'>
        {parts.map((p) => (
          <span key={p.label} className={`mq-part ${p.cls}`} title={p.label}>
            <small>{p.label}</small>
            <code>{Array.from(bytes.subarray(p.from, p.to), hex).join(' ')}</code>
          </span>
        ))}
      </div>
      <p className='hint'>
        Byte đầu <code>0x{hex(bytes[0])}</code> = loại 3 (PUBLISH) ở 4 bit cao, QoS {qos} ở bit 1–2. Tổng{' '}
        {bytes.length} byte; độ dài còn lại dùng {lenBytes} byte varint.
      </p>
      {decoded?.type === 'PUBLISH' && (
        <p className='ok'>
          Giải ngược: topic <code>{decoded.topic}</code>, QoS {decoded.qos}, id {String(decoded.messageId)}, payload{' '}
          <code>{payloadText(decoded.payload)}</code>
        </p>
      )}
    </section>
  );
}

// ---------- B. Luồng byte bị cắt ngẫu nhiên giữa các chunk ----------

function makeStreamBytes(count: number) {
  const frames: Uint8Array[] = [];
  for (let i = 1; i <= count; i++) {
    // vài tin dài hơn 127 byte để varint độ dài cần 2 byte
    const body = JSON.stringify({ seq: i, text: i % 4 === 0 ? 'tin dài '.repeat(25) : `tin số ${i}` });
    frames.push(encodePublish('/t_ms', body, 0));
  }
  const total = frames.reduce((n, f) => n + f.length, 0);
  const all = new Uint8Array(total);
  let at = 0;
  for (const f of frames) {
    all.set(f, at);
    at += f.length;
  }
  return all;
}

/** Cắt mảng thành chunk ngẫu nhiên, đóng gói thành ReadableStream như response.body của fetch. */
function chunkedBody(bytes: Uint8Array, maxChunk: number, seed: number) {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff);
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; ) {
    const size = Math.max(1, Math.round(rand() * maxChunk));
    chunks.push(bytes.slice(at, at + size));
    at += size;
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(c));
      controller.close();
    },
  });
  return { body: new Response(stream).body!, chunkCount: chunks.length };
}

async function readAll(reader: ReadableStreamDefaultReader<Uint8Array>, onChunk: (c: Uint8Array) => WireMessage[]) {
  const got: WireMessage[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return got;
    got.push(...onChunk(value));
  }
}

function StreamSplit() {
  const COUNT = 20;
  const [maxChunk, setMaxChunk] = useState(60);
  const [result, setResult] = useState<{ chunks: number; naive: number[]; fixed: number[]; errors: number } | null>(null);

  const run = async () => {
    const bytes = makeStreamBytes(COUNT);
    const seed = Math.floor(Math.random() * 1e6);
    const seqOf = (m: WireMessage) => (m.type === 'PUBLISH' ? JSON.parse(payloadText(m.payload)).seq : -1);

    // Cách của MqttFetchClient: giải từng chunk độc lập, bỏ qua `remaining`
    const a = chunkedBody(bytes, maxChunk, seed);
    let errors = 0;
    const naive = await readAll(a.body.getReader(), (chunk) => {
      try {
        return decodeMessages(chunk).messages;
      } catch {
        // chunk bắt đầu giữa gói: byte rác bị đọc như header. FB gặp lỗi này thì đóng kết nối.
        errors++;
        return [];
      }
    });

    // Bản sửa: giữ phần dư và ghép với chunk sau
    const b = chunkedBody(bytes, maxChunk, seed);
    const decoder = new MqttStreamDecoder();
    const fixed = await readAll(b.body.getReader(), (chunk) => decoder.push(chunk));

    const safeSeq = (m: WireMessage) => {
      try {
        return seqOf(m);
      } catch {
        return -1;
      }
    };
    setResult({ chunks: a.chunkCount, naive: naive.map(safeSeq).filter((n) => n > 0), fixed: fixed.map(safeSeq), errors });
  };

  return (
    <section className='card'>
      <h2>2. Luồng fetch bị cắt giữa gói</h2>
      <p className='hint'>
        Server gửi {COUNT} gói nối liền nhau qua một response streaming. Mạng cắt luồng thành các chunk dài ngẫu nhiên, không
        theo ranh giới gói.
      </p>
      <div className='toolbar'>
        <label>
          Chunk dài tối đa {maxChunk} byte{' '}
          <input type='range' min={10} max={2000} step={10} value={maxChunk} onChange={(e) => setMaxChunk(+e.target.value)} />
        </label>
        <button className='primary' onClick={run}>
          Phát luồng
        </button>
      </div>
      {result && (
        <>
          <div className='stats'>
            <Stat label='chunk nhận được' value={result.chunks} />
            <Stat label='giải từng chunk (kiểu FB)' value={`${result.naive.length}/${COUNT}`} />
            <Stat label='lỗi giải mã (kiểu FB)' value={result.errors} />
            <Stat label='ghép phần dư (bản sửa)' value={`${result.fixed.length}/${COUNT}`} />
          </div>
          <div className='mq-seq' aria-label='Tin nhận được'>
            {Array.from({ length: COUNT }, (_, i) => i + 1).map((n) => (
              <span key={n} className={result.naive.includes(n) ? 'ok' : 'lost'} title={`tin ${n}`}>
                {n}
              </span>
            ))}
          </div>
          <p className='hint'>
            Ô đỏ: tin mất khi giải từng chunk riêng. Bản có <code>remaining</code> nhận đủ {result.fixed.length} tin.
          </p>
        </>
      )}
    </section>
  );
}

// ---------- C. Khi nào chuyển sang long-poll ----------

type WsMode = 'ok' | 'hang' | 'fail-fast';

function simulate(mode: WsMode, lastLp: boolean, wsSupported: boolean) {
  const log: { t: number; text: string; tone?: 'ok' | 'warn' | 'err' }[] = [];
  let failures = 0;
  let connected = false;
  // các mốc FB đánh giá lại: lúc start, 1100ms, 3100ms và mỗi lần connect lỗi
  const checks = new Set([0, 1100, 3100]);
  const failTimes: number[] = [];
  if (mode === 'fail-fast') {
    let t = 0;
    for (let n = 0; n < 6; n++) {
      t += 400; // mỗi lần connect lỗi sau 400ms
      failTimes.push(t);
      t += backoffDelay(n, () => 0.5);
    }
    failTimes.forEach((t) => checks.add(t));
  }
  if (mode === 'ok') checks.add(300);
  for (const t of [...checks].sort((a, b) => a - b)) {
    if (mode === 'ok' && t >= 300 && !connected) {
      connected = true;
      log.push({ t: 300, text: 'WebSocket kết nối thành công', tone: 'ok' });
    }
    if (failTimes.includes(t)) {
      failures++;
      log.push({ t, text: `WebSocket lỗi lần ${failures}`, tone: 'warn' });
    }
    const d = shouldLongPoll({
      wsSupported,
      wsFatal: false,
      wsConnected: connected,
      wsFailures: failures,
      elapsedMs: t,
      lastSessionUsedLongPoll: lastLp,
    });
    if (d.longPoll) {
      log.push({ t, text: `→ chuyển sang long-poll (${d.reason})`, tone: 'err' });
      return { log, switchAt: t };
    }
    log.push({ t, text: `kiểm tra: ${d.reason}` });
  }
  return { log, switchAt: null as number | null };
}

function TransportPicker() {
  const [mode, setMode] = useState<WsMode>('hang');
  const [lastLp, setLastLp] = useState(false);
  const [wsSupported, setWsSupported] = useState(true);
  const sim = simulate(mode, lastLp, wsSupported);

  return (
    <section className='card'>
      <h2>3. Khi nào bỏ WebSocket</h2>
      <div className='toolbar'>
        <select value={mode} onChange={(e) => setMode(e.target.value as WsMode)} aria-label='Tình trạng WebSocket'>
          <option value='ok'>WebSocket chạy bình thường</option>
          <option value='hang'>WebSocket treo (proxy nuốt kết nối)</option>
          <option value='fail-fast'>WebSocket lỗi ngay mỗi lần thử</option>
        </select>
        <label className='switch'>
          <input type='checkbox' checked={lastLp} onChange={(e) => setLastLp(e.target.checked)} /> Phiên trước đã phải
          long-poll
        </label>
        <label className='switch'>
          <input type='checkbox' checked={!wsSupported} onChange={(e) => setWsSupported(!e.target.checked)} /> Trình duyệt
          không có WebSocket
        </label>
      </div>
      <ol className='mq-timeline'>
        {sim.log.map((l, i) => (
          <li key={i} className={l.tone}>
            <b>{l.t}ms</b> {l.text}
          </li>
        ))}
      </ol>
      <p className='hint'>
        {sim.switchAt == null ? 'Không chuyển: vẫn dùng WebSocket.' : `Người dùng chờ ${sim.switchAt}ms trước khi có kênh realtime.`}
      </p>
      <details>
        <summary>Lịch thử lại (exponential backoff, random = 0.5)</summary>
        <table className='mq-table'>
          <tbody>
            {Array.from({ length: 8 }, (_, n) => (
              <tr key={n}>
                <td>lần {n}</td>
                <td>{Math.round(backoffDelay(n, () => 0.5))}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

export default function MqttDemo() {
  return (
    <div className='page mqtt-demo'>
      <h1>MQTT ngay trong trình duyệt</h1>
      <p className='hint'>
        Messenger trên web nói chuyện với server bằng MQTT nhị phân qua WebSocket, và lùi về long-poll bằng fetch streaming
        khi WebSocket không chạy.
      </p>
      <PacketAnatomy />
      <StreamSplit />
      <TransportPicker />
    </div>
  );
}
