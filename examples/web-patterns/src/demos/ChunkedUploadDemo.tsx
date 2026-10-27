import { useRef, useState } from 'react';
import {
  HttpError,
  contentRange,
  createSliceRanges,
  startSlicedUpload,
  type SliceRange,
  type SliceState,
  type SlicedUpload,
} from '../lib/blobSlicer';
import { buildPresignedPostForm, friendlyS3Message, parseS3Error } from '../lib/s3Upload';
import { Log, Stat, useLog } from './shared';
import './ChunkedUploadDemo.css';

const MB = 1024 * 1024;

interface ServerOptions {
  strictOrder: boolean;
  failRate: number;
  expired: boolean;
}

/** Server upload-session giả lập: ~150ms độ trễ mỗi request, mỗi kết nối ~20MB/s. */
function createFakeServer(total: number, options: ServerOptions, log: (t: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void) {
  let nextExpected = 0;
  const received = new Set<number>();
  return async function put(slice: Blob, range: SliceRange, signal: AbortSignal, onProgress: (n: number) => void, last: boolean) {
    const header = contentRange(range, total);
    const duration = 150 + (slice.size / (20 * MB)) * 1000 * (0.6 + Math.random() * 0.8);
    const startedAt = performance.now();
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearInterval(timer);
        reject(signal.reason);
      };
      const timer = setInterval(() => {
        const ratio = Math.min(1, (performance.now() - startedAt) / duration);
        onProgress(Math.round(slice.size * ratio));
        if (ratio >= 1) {
          clearInterval(timer);
          signal.removeEventListener('abort', onAbort);
          resolve();
        }
      }, 80);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    if (options.expired) throw new HttpError(401, 'upload session đã hết hạn');
    if (Math.random() < options.failRate) {
      log(`PUT ${header} → 503 (lỗi tạm thời)`, 'warn');
      throw new HttpError(503);
    }
    if (options.strictOrder && range.start !== nextExpected) {
      log(`PUT ${header} → 416: server chờ byte ${nextExpected}`, 'err');
      throw new HttpError(416, `lát #${range.index} đến lệch thứ tự`);
    }
    nextExpected = Math.max(nextExpected, range.end);
    received.add(range.index);
    if (last) {
      log(`PUT ${header} → 201 Created, server ghép file`, 'ok');
    } else {
      log(`PUT ${header} → 202 Accepted`, 'muted');
    }
  };
}

const STATE_LABEL: Record<SliceState | 'pending', string> = {
  pending: 'chờ',
  uploading: 'đang gửi',
  retrying: 'gửi lại',
  done: 'xong',
  failed: 'lỗi',
  aborted: 'huỷ',
};

function UploadPanel() {
  const { lines, add } = useLog(80);
  const [fileMB, setFileMB] = useState(64);
  const [sliceMB, setSliceMB] = useState(8);
  const [parallel, setParallel] = useState(2);
  const [failRate, setFailRate] = useState(0);
  const [strictOrder, setStrictOrder] = useState(false);
  const [expired, setExpired] = useState(false);
  const [states, setStates] = useState<Array<SliceState | 'pending'>>([]);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState('–');
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [retries, setRetries] = useState(0);
  const uploadRef = useRef<SlicedUpload | null>(null);
  const fileRef = useRef<File | null>(null);
  const [running, setRunning] = useState(false);

  const start = async () => {
    const blob = fileRef.current ?? new Blob([new Uint8Array(fileMB * MB)], { type: 'application/octet-stream' });
    const sliceSize = sliceMB * MB;
    const ranges = createSliceRanges(blob.size, sliceSize);
    const put = createFakeServer(blob.size, { strictOrder, failRate: failRate / 100, expired }, add);
    setStates(ranges.map(() => 'pending'));
    setProgress(0);
    setRetries(0);
    setElapsed(null);
    setResult('đang chạy');
    add(`Bắt đầu: ${(blob.size / MB).toFixed(1)}MB, ${ranges.length} lát × ${sliceMB}MB, song song ${parallel}`);
    const t0 = performance.now();

    const upload = startSlicedUpload(
      blob,
      (slice, range, ctx) => put(slice, range, ctx.signal, ctx.onProgress, range.index === ctx.totalSlices - 1 && ctx.totalSlices > 0),
      {
        sliceSize,
        parallel,
        retries: 2,
        retryDelay: (attempt) => 300 * 2 ** attempt,
        onProgress: (uploaded, total) => setProgress(uploaded / total),
        onSliceState: (range, state) => {
          setStates((prev) => prev.map((s, i) => (i === range.index ? state : s)));
          if (state === 'retrying') setRetries((n) => n + 1);
        },
      },
    );
    uploadRef.current = upload;
    setRunning(true);
    try {
      const outcome = await upload.done;
      setResult(outcome === 'completed' ? 'hoàn tất' : 'đã huỷ');
      add(outcome === 'completed' ? 'Upload xong' : 'Đã huỷ: gọi DELETE upload session để server dọn phần đã nhận', outcome === 'completed' ? 'ok' : 'warn');
    } catch (error) {
      setResult('thất bại');
      add(`Dừng: ${(error as Error).message}`, 'err');
    } finally {
      setElapsed(Math.round(performance.now() - t0));
      uploadRef.current = null;
      setRunning(false);
    }
  };

  return (
    <>
      <div className='toolbar cu-options'>
        <label>
          File{' '}
          <select value={fileMB} onChange={(e) => setFileMB(Number(e.target.value))} disabled={running}>
            {[32, 64, 128].map((n) => (
              <option key={n} value={n}>
                {n}MB (tạo sẵn)
              </option>
            ))}
          </select>
        </label>
        <label>
          Lát{' '}
          <select value={sliceMB} onChange={(e) => setSliceMB(Number(e.target.value))} disabled={running}>
            {[4, 8, 10, 14].map((n) => (
              <option key={n} value={n}>
                {n}MB
              </option>
            ))}
          </select>
        </label>
        <label>
          Song song{' '}
          <select value={parallel} onChange={(e) => setParallel(Number(e.target.value))} disabled={running}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Lỗi tạm thời{' '}
          <select value={failRate} onChange={(e) => setFailRate(Number(e.target.value))} disabled={running}>
            {[0, 15, 35].map((n) => (
              <option key={n} value={n}>
                {n}%
              </option>
            ))}
          </select>
        </label>
        <label className='switch'>
          <input type='checkbox' checked={strictOrder} onChange={(e) => setStrictOrder(e.target.checked)} disabled={running} />
          Server chỉ nhận đúng thứ tự (kiểu OneDrive)
        </label>
        <label className='switch'>
          <input type='checkbox' checked={expired} onChange={(e) => setExpired(e.target.checked)} disabled={running} />
          Link upload hết hạn
        </label>
        <label className='cu-file'>
          hoặc chọn file thật{' '}
          <input
            type='file'
            disabled={running}
            onChange={(e) => {
              fileRef.current = e.target.files?.[0] ?? null;
              if (fileRef.current) add(`Đã chọn ${fileRef.current.name} (${(fileRef.current.size / MB).toFixed(1)}MB)`);
            }}
          />
        </label>
      </div>
      <div className='toolbar'>
        <button className='primary' onClick={start} disabled={running} data-testid='start'>
          ▶ Upload
        </button>
        <button onClick={() => uploadRef.current?.cancel()} disabled={!running}>
          Huỷ
        </button>
      </div>
      <div className='stats'>
        <Stat label='tiến độ' value={`${Math.round(progress * 100)}%`} />
        <Stat label='thời gian' value={elapsed === null ? '–' : `${(elapsed / 1000).toFixed(2)}s`} />
        <Stat label='lần gửi lại' value={retries} />
        <Stat label='kết quả' value={<output data-testid='result'>{result}</output>} />
      </div>
      <div className='cu-bar' aria-hidden='true'>
        <div style={{ width: `${progress * 100}%` }} />
      </div>
      <ol className='cu-slices' aria-label='Trạng thái từng lát'>
        {states.map((s, i) => (
          <li key={i} className={`cu-${s}`} title={`Lát #${i}: ${STATE_LABEL[s]}`}>
            <b>#{i}</b>
            <span>{STATE_LABEL[s]}</span>
          </li>
        ))}
      </ol>
      <Log lines={lines} />
    </>
  );
}

// ---------- lỗi XML của S3 ----------
const S3_CASES: Array<{ label: string; status: number; body: string }> = [
  { label: '204 thành công', status: 204, body: '' },
  {
    label: 'Policy hết hạn',
    status: 403,
    body: '<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>AccessDenied</Code><Message>Invalid according to Policy: Policy expired.</Message><RequestId>8Q2C1E</RequestId></Error>',
  },
  {
    label: 'File quá lớn',
    status: 400,
    body: '<Error><Code>EntityTooLarge</Code><Message>Your proposed upload exceeds the maximum allowed size</Message><ProposedSize>31457280</ProposedSize><MaxSizeAllowed>10485760</MaxSizeAllowed></Error>',
  },
  {
    label: 'Đồng hồ máy lệch',
    status: 403,
    body: '<Error><Code>RequestTimeTooSkewed</Code><Message>The difference between the request time and the current time is too large.</Message></Error>',
  },
  { label: '502 từ proxy (HTML)', status: 502, body: '<html><body><h1>502 Bad Gateway</h1></body></html>' },
  { label: 'XML bị cụt', status: 500, body: '<Error><Code>InternalError</Code><Message>We encountered an inter' },
];

function S3Panel() {
  const [picked, setPicked] = useState<number | null>(null);
  const c = picked === null ? null : S3_CASES[picked];
  const parsed = c ? parseS3Error(c.body) : null;
  const form = buildPresignedPostForm(
    { key: 'uploads/${filename}', policy: 'eyJleHBp…', 'x-amz-signature': '9f2c…', 'x-amz-credential': 'AKIA…/s3/aws4_request' },
    new File(['x'], 'avatar.png', { type: 'image/png' }),
  );
  return (
    <>
      <p className='hint'>
        Presigned POST lên S3: lỗi trả về là XML chứ không phải JSON. Chọn một phản hồi giả lập để xem{' '}
        <code>parseS3Error</code> đọc ra gì.
      </p>
      <div className='toolbar'>
        {S3_CASES.map((x, i) => (
          <button key={x.label} className={picked === i ? 'primary' : ''} onClick={() => setPicked(i)}>
            {x.label}
          </button>
        ))}
      </div>
      {c && (
        <div className='cu-s3'>
          <div className='card'>
            <small className='muted'>HTTP {c.status} · body</small>
            <pre>{c.body || '(rỗng)'}</pre>
          </div>
          <div className='card'>
            <small className='muted'>parseS3Error</small>
            <pre data-testid='s3-parsed'>{JSON.stringify(parsed, null, 1)}</pre>
            <small className='muted'>Hiện cho người dùng</small>
            <div className={c.status < 300 ? 'ok' : 'err'}>{c.status < 300 ? 'Đã tải ảnh lên.' : friendlyS3Message(parsed, c.status)}</div>
          </div>
        </div>
      )}
      <p className='hint' style={{ marginTop: 12 }}>
        Thứ tự field trong FormData (file phải đứng cuối): <code>{[...form.keys()].join(' → ')}</code>
      </p>
    </>
  );
}

export default function ChunkedUploadDemo() {
  const [tab, setTab] = useState<'slices' | 's3'>('slices');
  return (
    <div className='page'>
      <h1>Upload file lớn theo lát</h1>
      <p className='hint'>
        Lát đầu chạy một mình, các lát giữa chạy song song, lát cuối chạy sau cùng (cách của Outlook). Thử bật "Link
        upload hết hạn": dừng ngay sau lát đầu, không lát nào khác bị gửi phí.
      </p>
      <div className='toolbar' role='tablist'>
        <button role='tab' aria-selected={tab === 'slices'} className={tab === 'slices' ? 'primary' : ''} onClick={() => setTab('slices')}>
          Upload theo lát (Outlook)
        </button>
        <button role='tab' aria-selected={tab === 's3'} className={tab === 's3' ? 'primary' : ''} onClick={() => setTab('s3')}>
          Lỗi XML của S3 (Tribe)
        </button>
      </div>
      {tab === 'slices' ? <UploadPanel /> : <S3Panel />}
    </div>
  );
}
