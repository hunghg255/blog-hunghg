import { useRef, useState } from 'react';
import { deriveMediaKeys, encryptMedia, type Bytes, type MediaKeys } from '../lib/waProgressiveJpeg';
import {
  blockSpan,
  buildStreamingSidecar,
  RangeBuffer,
  RangeSet,
  readyBlocks,
  STREAM_BLOCK,
  verifyBlock,
} from '../lib/waRangeMerge';
import { Log, Stat, sleep, useLog } from './shared';
import './WaRangeMergeDemo.css';

const REQ = 96 * 1024;
const PLAIN = 20 * STREAM_BLOCK - 3000;
const kb = (n: number) => `${Math.round(n / 1024)} KB`;

interface Run {
  keys: MediaKeys;
  file: Bytes;
  sidecar: Bytes;
  buf: RangeBuffer;
  requested: RangeSet;
  inflight: [number, number][];
  blocks: ('wait' | 'ok' | 'bad')[];
  cursor: number;
  /** bản gốc giữ mọi đoạn nhận được trong một mảng */
  listBytes: number;
  corruptAt: number;
  stop: boolean;
}

/** Byte giả cho "video": getRandomValues chỉ nhận tối đa 64 KB mỗi lần. */
function fakeVideo(n: number): Bytes {
  const out = new Uint8Array(n);
  for (let at = 0; at < n; at += 65536) crypto.getRandomValues(out.subarray(at, at + 65536));
  return out;
}

export default function WaRangeMergeDemo() {
  const log = useLog(40);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const [corrupt, setCorrupt] = useState(true);
  const run = useRef<Run | null>(null);
  const [busy, setBusy] = useState(false);

  async function fetchRange(r: Run, s: number, e: number): Promise<Bytes> {
    await sleep(80 + Math.random() * 260);
    const data = r.file.slice(s, e + 1);
    if (r.corruptAt >= s && r.corruptAt <= e) {
      data[r.corruptAt - s] ^= 0x40;
      r.corruptAt = -1; // chỉ hỏng ở lần tải đầu
    }
    return data;
  }

  async function receive(r: Run, s: number, data: Bytes) {
    r.inflight = r.inflight.filter(([a]) => a !== s);
    r.listBytes += data.byteLength;
    const fresh = r.buf.write(s, data);
    const dup = data.byteLength - fresh;
    log.add(`← ${kb(s)}–${kb(s + data.byteLength)}${dup ? `, ${kb(dup)} trùng` : ''}`, dup ? 'warn' : undefined);
    for (const k of readyBlocks(r.buf)) {
      // Kiểm lại: trong lúc chờ HMAC của khối trước, một khối hỏng có thể vừa bị bỏ khỏi tập khoảng.
      if (r.blocks[k] !== 'wait' || !r.buf.ranges.covers(...blockSpan(k, r.buf.size))) continue;
      if (await verifyBlock(r.buf, k, r.keys.iv, r.sidecar, r.keys.macKey)) r.blocks[k] = 'ok';
      else {
        r.blocks[k] = 'bad';
        log.add(`✘ khối ${k} sai MAC: bỏ ${kb(STREAM_BLOCK)} của khối, xin tải lại`, 'err');
        const own: [number, number] = [k * STREAM_BLOCK, Math.min(r.buf.size, (k + 1) * STREAM_BLOCK) - 1];
        r.buf.ranges.remove(...own);
        r.requested.remove(...own);
        setTimeout(() => {
          r.blocks[k] = 'wait';
          rerender();
        }, 400);
      }
    }
    rerender();
  }

  function nextRequest(r: Run): [number, number] | null {
    const holes = r.requested.missing(r.buf.size);
    if (!holes.length) return null;
    const hole = holes.find(([, e]) => e >= r.cursor) ?? holes[0];
    const s = hole[0] <= r.cursor && r.cursor <= hole[1] ? r.cursor : hole[0];
    const e = Math.min(hole[1], s + REQ - 1);
    r.requested.add(s, e);
    r.cursor = e + 1;
    return [s, e];
  }

  async function start() {
    if (run.current) run.current.stop = true;
    setBusy(true);
    log.clear();
    const keys = await deriveMediaKeys(crypto.getRandomValues(new Uint8Array(32)), 'WhatsApp Video Keys');
    const file = await encryptMedia(fakeVideo(PLAIN), keys);
    const sidecar = await buildStreamingSidecar(keys.iv, file, keys.macKey);
    const count = Math.ceil(file.byteLength / STREAM_BLOCK);
    const r: Run = {
      keys,
      file,
      sidecar,
      buf: new RangeBuffer(file.byteLength),
      requested: new RangeSet(),
      inflight: [],
      blocks: new Array(count).fill('wait'),
      cursor: 0,
      listBytes: 0,
      corruptAt: corrupt ? 9 * STREAM_BLOCK + 777 : -1,
      stop: false,
    };
    run.current = r;
    log.add(`File ${kb(file.byteLength)} → ${count} khối 64 KB, sidecar ${sidecar.byteLength} byte`);
    rerender();
    // Hai request song song, về không theo thứ tự.
    const worker = async () => {
      for (;;) {
        if (r.stop) return;
        const next = nextRequest(r);
        if (!next) {
          if (r.buf.complete && r.blocks.every((b) => b === 'ok')) return;
          await sleep(100);
          continue;
        }
        r.inflight.push(next);
        rerender();
        await receive(r, next[0], await fetchRange(r, ...next));
      }
    };
    await Promise.all([worker(), worker()]);
    if (!r.stop) log.add(`Đủ file, mọi khối khớp MAC. Byte trùng: ${kb(r.buf.received - r.buf.size)}`, 'ok');
    setBusy(false);
  }

  async function seek() {
    const r = run.current;
    if (!r) return;
    const at = Math.floor(r.buf.size * 0.6);
    // Player xin lùi một chút trước điểm tua: dễ chồng lên phần đã có.
    const s = Math.max(0, at - 40 * 1024);
    const e = Math.min(r.buf.size - 1, at + REQ);
    r.cursor = e + 1;
    r.requested.add(s, e);
    r.inflight.push([s, e]);
    log.add(`Tua tới 60%: xin ${kb(s)}–${kb(e)}`);
    rerender();
    await receive(r, s, await fetchRange(r, s, e));
  }

  const r = run.current;
  const size = r?.buf.size ?? 1;
  const pct = (n: number) => `${(n / size) * 100}%`;
  const verified = r?.blocks.filter((b) => b === 'ok').length ?? 0;

  return (
    <div className='page wa-range'>
      <h1>WhatsApp #2: ghép khoảng byte cho video streaming</h1>
      <p className='hint'>
        Player xin từng Range, hai request chạy song song nên về không theo thứ tự. Bộ đệm ghép khoảng, chỉ xin phần
        còn thiếu, và kiểm HMAC từng khối 64 KB ngay khi khối đó đủ byte.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={start} data-testid='start'>
          {busy ? 'Phát lại từ đầu' : 'Phát video'}
        </button>
        <button onClick={seek} disabled={!busy} data-testid='seek'>
          Tua tới 60%
        </button>
        <label className='switch'>
          <input type='checkbox' checked={corrupt} onChange={(e) => setCorrupt(e.target.checked)} />
          Hỏng 1 byte ở khối 9 (lần tải đầu)
        </label>
      </div>
      <div className='stats'>
        <Stat label='đã nhận qua mạng' value={r ? kb(r.buf.received) : '–'} />
        <Stat label='khoảng rời' value={r?.buf.ranges.ranges.length ?? '–'} />
        <Stat label='khối đã kiểm' value={r ? `${verified}/${r.blocks.length}` : '–'} />
        <Stat label='RAM kiểu gốc (mảng đoạn + serialize)' value={r ? kb(r.listBytes + (r.buf.complete ? r.buf.size : 0)) : '–'} />
        <Stat label='RAM bản viết lại' value={r ? kb(r.buf.size) : '–'} />
      </div>
      <div className='wa-range-bar' aria-label='Khoảng đã tải'>
        {r?.buf.ranges.ranges.map(([s, e]) => (
          <i key={s} style={{ left: pct(s), width: pct(e - s + 1) }} />
        ))}
        {r?.inflight.map(([s, e]) => (
          <u key={`f${s}`} style={{ left: pct(s), width: pct(e - s + 1) }} />
        ))}
      </div>
      <div className='wa-range-blocks'>
        {r?.blocks.map((b, k) => (
          <span key={k} className={b} title={`khối ${k}: ${blockSpan(k, size).join('–')}`}>
            {k}
          </span>
        ))}
      </div>
      <Log lines={log.lines} />
    </div>
  );
}
