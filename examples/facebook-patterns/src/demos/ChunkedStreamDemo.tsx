import { useRef, useState } from 'react';
import { GUARD, readJsonChunks } from '../lib/chunkedResponse';
import { ChunkParserFbStyle, END_MARKER, onReadyStateFbStyle } from './chunkedFbStyle';
import { Log, sleep, useLog } from './shared';
import './ChunkedStreamDemo.css';

const STORIES = ['Bản tin đầu', 'Ảnh mới 📷', 'Video', 'Nhóm gợi ý', 'Kết thúc'];
const DELAY = 280;

interface Item {
  at: number;
  text: string;
  tone?: 'ok' | 'err';
}
type Lane = 'text' | 'fb' | 'stream';
const LANES: { id: Lane; label: string }[] = [
  { id: 'text', label: 'await res.text()' },
  { id: 'fb', label: 'Kiểu ChunkedRequest (XHR)' },
  { id: 'stream', label: 'readJsonChunks (fetch stream)' },
];

/** body của "server": tiền tố + các mẩu JSON cách nhau bởi \r\n; mẩu cuối không có \r\n theo sau */
function body(withGuard: boolean) {
  const chunks = STORIES.map((title, i) => JSON.stringify({ story: i + 1, title }) + (i < STORIES.length - 1 ? '\r\n' : ''));
  return { head: withGuard ? GUARD : '', chunks };
}

/** Server giả: đẩy từng mẩu sau mỗi DELAY ms, mỗi mẩu lại cắt đôi để thấy dữ liệu về lẻ tẻ. */
function fakeServer(withGuard: boolean, onPiece?: (text: string, done: boolean) => void): Response {
  const { head, chunks } = body(withGuard);
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const pieces = [head + chunks[0].slice(0, 7), chunks[0].slice(7)];
      for (const c of chunks.slice(1)) pieces.push(c.slice(0, 9), c.slice(9));
      for (let i = 0; i < pieces.length; i++) {
        if (i % 2 === 0) await sleep(DELAY);
        controller.enqueue(enc.encode(pieces[i]));
        // mẩu cuối: XHR thường báo readyState 4 cùng lúc với phần dữ liệu cuối
        onPiece?.(pieces[i], i === pieces.length - 1);
      }
      controller.close();
    },
  });
  return new Response(stream);
}

export default function ChunkedStreamDemo() {
  const [withGuard, setWithGuard] = useState(true);
  const [items, setItems] = useState<Record<Lane, Item[]>>({ text: [], fb: [], stream: [] });
  const [running, setRunning] = useState(false);
  const { lines, add, clear } = useLog(20);
  const worker = useRef<Worker | null>(null);

  const push = (lane: Lane, t0: number, text: string, tone?: Item['tone']) =>
    setItems((s) => ({ ...s, [lane]: [...s[lane], { at: Math.round(performance.now() - t0), text, tone }] }));

  async function run() {
    setRunning(true);
    setItems({ text: [], fb: [], stream: [] });
    const t0 = performance.now();

    const laneText = (async () => {
      const raw = await fakeServer(withGuard).text();
      const rest = raw.replace(/^for ?\(;;\);/, '');
      for (const piece of rest.split('\r\n').filter(Boolean)) push('text', t0, JSON.parse(piece).title);
    })();

    const laneFb = new Promise<void>((resolve) => {
      // mô phỏng XHR: mỗi lần readyState 3 đưa TOÀN BỘ responseText đã nhận cho parser
      const parser = new ChunkParserFbStyle();
      let responseText = '';
      let received = 0;
      const handle = (done: boolean) => {
        for (const raw of onReadyStateFbStyle(parser, responseText.replace(/^for ?\(;;\);/, ''), done)) {
          if (raw === END_MARKER) {
            push('fb', t0, `mẩu kết thúc "{}" (đã nhận ${received} mẩu dữ liệu)`, received < STORIES.length ? 'err' : 'ok');
            continue;
          }
          received++;
          push('fb', t0, JSON.parse(raw).title);
        }
      };
      fakeServer(withGuard, (text, done) => {
        responseText += text;
        handle(done);
        if (done) resolve();
      })
        .body!.pipeTo(new WritableStream())
        .catch(() => {});
    });

    const laneStream = readJsonChunks<{ title: string }>(fakeServer(withGuard), {
      onChunk: (v) => push('stream', t0, v.title, 'ok'),
      onError: (_e, raw) => push('stream', t0, `lỗi parse ${raw}`, 'err'),
    }).catch((e: Error) => push('stream', t0, e.message, 'err'));

    await Promise.all([laneText, laneFb, laneStream]);
    setRunning(false);
  }

  /** chạy payload như một <script> của trang khác: trong Worker để có thể dừng nó */
  function hijack(guard: boolean) {
    worker.current?.terminate();
    clear();
    const payload = `${guard ? GUARD : ''}[{"email":"an@example.com"}]`;
    add(`<script src> nạp: ${payload}`);
    const url = URL.createObjectURL(new Blob([`${payload}\npostMessage('chạy hết script')`], { type: 'text/javascript' }));
    const w = new Worker(url);
    worker.current = w;
    let finished = false;
    w.onmessage = (e) => {
      finished = true;
      add(`${e.data}: mảng dữ liệu đã được thực thi như JS (trình duyệt cũ có thể bị đọc trộm)`, 'err');
      w.terminate();
    };
    setTimeout(() => {
      URL.revokeObjectURL(url);
      if (!finished) {
        add('sau 300ms script vẫn kẹt trong for (;;); → dừng worker, dữ liệu không bao giờ được thực thi', 'ok');
        w.terminate();
      }
    }, 300);
  }

  return (
    <div className='page cs'>
      <h1>Tiền tố for (;;); và response nhiều mẩu</h1>
      <p className='hint'>
        Server giả trả 5 mẩu JSON cách nhau bởi <code>\r\n</code>, mỗi mẩu cách {DELAY}ms và lại về thành hai nửa. Mẩu
        cuối không có <code>\r\n</code> theo sau (như phần lớn NDJSON).
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={run} disabled={running}>
          Gửi request
        </button>
        <label className='switch'>
          <input type='checkbox' checked={withGuard} onChange={(e) => setWithGuard(e.target.checked)} disabled={running} /> server
          gắn tiền tố
        </label>
      </div>
      <div className='cs-lanes'>
        {LANES.map((l) => (
          <section key={l.id} className='card' data-testid={`lane-${l.id}`}>
            <h2>{l.label}</h2>
            {items[l.id].length === 0 && <p className='muted'>…</p>}
            <ol>
              {items[l.id].map((it, i) => (
                <li key={i} className={it.tone}>
                  <span className='cs-at'>{it.at}ms</span> {it.text}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      <h2 className='cs-h2'>Trang khác nhúng URL này bằng &lt;script&gt;</h2>
      <div className='toolbar'>
        <button onClick={() => hijack(false)}>Không tiền tố</button>
        <button onClick={() => hijack(true)}>Có for (;;);</button>
      </div>
      <Log lines={lines} />
    </div>
  );
}
