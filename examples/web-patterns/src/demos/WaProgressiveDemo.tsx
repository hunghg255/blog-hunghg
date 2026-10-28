import { useEffect, useRef, useState } from 'react';
import {
  alignChunkLengths,
  buildScansSidecar,
  concat,
  deriveMediaKeys,
  encryptMedia,
  ProgressiveDecryptor,
  splitJpegScans,
  type Bytes,
} from '../lib/waProgressiveJpeg';
import { Log, Stat, sleep, useLog } from './shared';
import './WaProgressiveDemo.css';

type ChunkState = 'wait' | 'ok' | 'bad';

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

export default function WaProgressiveDemo() {
  const log = useLog(40);
  const [running, setRunning] = useState(false);
  const [corrupt, setCorrupt] = useState(false);
  const [slow, setSlow] = useState(true);
  const [url, setUrl] = useState<string>();
  const [info, setInfo] = useState({ size: 0, scans: 0, chunks: [] as number[], loaded: 0, shown: 0 });
  const [states, setStates] = useState<ChunkState[]>([]);
  const urlRef = useRef<string>(undefined);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  function show(image: Bytes) {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(new Blob([image], { type: 'image/jpeg' }));
    setUrl(urlRef.current);
  }

  async function prepare() {
    const jpeg = new Uint8Array(await (await fetch('./wa-progressive.jpg')).arrayBuffer());
    // Khoá media ngẫu nhiên, sinh ngay trong trình duyệt.
    const keys = await deriveMediaKeys(crypto.getRandomValues(new Uint8Array(32)));
    const enc = await encryptMedia(jpeg, keys);
    const scans = splitJpegScans(jpeg);
    const chunks = alignChunkLengths(scans, enc.byteLength);
    const sidecar = await buildScansSidecar(enc, chunks, keys);
    return { jpeg, keys, enc, scans, chunks, sidecar };
  }

  async function run() {
    setRunning(true);
    log.clear();
    setUrl(undefined);
    try {
      const { jpeg, keys, enc, scans, chunks, sidecar } = await prepare();
      setInfo({ size: jpeg.byteLength, scans: scans.length, chunks, loaded: 0, shown: 0 });
      setStates(chunks.map(() => 'wait'));
      log.add(`Bên gửi: ${kb(jpeg.byteLength)} JPEG, ${scans.length} scan → ${chunks.length} đoạn, sidecar ${sidecar.byteLength} byte`);
      const download = enc.slice();
      if (corrupt) {
        const at = chunks.slice(0, 4).reduce((a, b) => a + b, 0) + 7;
        download[at] ^= 0x01;
        log.add(`Mạng lật 1 bit ở byte ${at} (đoạn 4)`, 'warn');
      }
      const dec = new ProgressiveDecryptor(keys, scans, sidecar, enc.byteLength);
      const piece = slow ? 384 : 1024;
      for (let at = 0; at < download.length; at += piece) {
        await sleep(slow ? 70 : 25);
        const part = download.subarray(at, at + piece);
        setInfo((s) => ({ ...s, loaded: Math.min(at + piece, download.length) }));
        let results;
        try {
          results = await dec.push(part);
        } catch (e) {
          setStates((s) => {
            const i = s.indexOf('wait');
            return s.map((v, k) => (k === i ? 'bad' : v));
          });
          log.add(`✘ ${(e as Error).message}: dừng, giữ ảnh của đoạn trước`, 'err');
          return;
        }
        for (const r of results) {
          setStates((s) => s.map((v, k) => (k === r.index ? 'ok' : v)));
          setInfo((s) => ({ ...s, shown: r.scans }));
          show(r.image);
          log.add(`Đoạn ${r.index}: MAC khớp, giải mã → ${r.scans}/${scans.length} scan, ảnh ${kb(r.image.byteLength)}`, 'ok');
        }
      }
      log.add('Đủ file: ảnh cuối trùng từng byte với JPEG gốc', 'ok');
    } catch (e) {
      log.add(`Lỗi: ${(e as Error).message}`, 'err');
    } finally {
      setRunning(false);
    }
  }

  async function naive() {
    const { keys, enc, chunks } = await prepare();
    const mid = enc.subarray(0, chunks[0] + chunks[1]);
    try {
      const out = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: keys.iv }, keys.encKey, mid);
      log.add(`Giải mã thẳng ${mid.byteLength} byte: không lỗi nhưng mất ${mid.byteLength - out.byteLength} byte cuối (padding "giả" trùng hợp)`, 'warn');
    } catch (e) {
      log.add(`Giải mã thẳng ${mid.byteLength} byte giữa file: ${(e as Error).name}, padding PKCS#7 không hợp lệ`, 'err');
    }
    const tail = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-CBC', iv: mid.slice(-16) }, keys.encKey, new Uint8Array([2, 2])),
    );
    const out = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: keys.iv }, keys.encKey, concat(mid, tail)));
    log.add(`Nối thêm khối mã hoá [2,2]: giải mã ra ${out.byteLength} byte, cắt 2 byte cuối còn ${out.byteLength - 2}`, 'ok');
  }

  const total = info.chunks.reduce((a, b) => a + b, 0);

  return (
    <div className='page wa-prog'>
      <h1>WhatsApp #1: JPEG progressive giải mã theo từng scan</h1>
      <p className='hint'>
        Ảnh được mã hoá AES-CBC bằng khoá tự sinh, chia đoạn theo ranh giới scan. Mỗi đoạn tải xong được kiểm HMAC
        trong sidecar rồi giải mã ngay, ảnh nét dần mà không phải chờ cả file.
      </p>
      <div className='toolbar'>
        <button className='primary' disabled={running} onClick={run} data-testid='run'>
          Gửi và tải ảnh
        </button>
        <label className='switch'>
          <input type='checkbox' checked={corrupt} onChange={(e) => setCorrupt(e.target.checked)} data-testid='corrupt' />
          Lật 1 bit ở đoạn 4
        </label>
        <label className='switch'>
          <input type='checkbox' checked={slow} onChange={(e) => setSlow(e.target.checked)} />
          Mạng chậm
        </label>
        <button disabled={running} onClick={naive} data-testid='naive'>
          Giải mã đoạn giữa không có mẹo
        </button>
      </div>
      <div className='stats'>
        <Stat label='JPEG gốc' value={info.size ? kb(info.size) : '–'} />
        <Stat label='scan / đoạn' value={info.scans ? `${info.scans} / ${info.chunks.length}` : '–'} />
        <Stat label='đã tải' value={total ? `${Math.round((info.loaded / total) * 100)}%` : '–'} />
        <Stat label='scan đang hiện' value={info.shown} />
      </div>
      <div className='wa-prog-bar' aria-label='Các đoạn ciphertext'>
        {info.chunks.map((n, i) => (
          <i key={i} className={states[i]} style={{ flexGrow: n }} title={`đoạn ${i}: ${n} byte`} />
        ))}
        {total > 0 && <b style={{ width: `${(info.loaded / total) * 100}%` }} />}
      </div>
      <div className='split'>
        <div className='wa-prog-view card'>
          {url ? <img src={url} alt='Ảnh đang giải mã dần' data-testid='img' /> : <p className='muted'>Chưa có ảnh</p>}
        </div>
        <Log lines={log.lines} />
      </div>
    </div>
  );
}
