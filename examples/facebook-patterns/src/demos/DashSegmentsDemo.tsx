import { useEffect, useRef, useState } from 'react';
import { buildSidx, parseSegmentTemplate, parseSidx, parseSidxIgnoringOffset, PredictedTimeline, type SidxReference } from '../lib/dashSegments';
import { Log, Stat, sleep, useLog } from './shared';
import './DashSegmentsDemo.css';

const SEG_MS = 1000; // mỗi segment live dài 1 s (thời gian demo)
const MANIFEST_EVERY = 3000; // player ngây thơ tải lại manifest mỗi 3 s
const RTT = 150;
const TOTAL = 10;

/** Manifest như server sinh ra tại thời điểm `now`: liệt kê 4 segment gần nhất, kèm thuộc tính dự đoán. */
function manifestAt(now: number) {
  const ready = Math.floor(now / SEG_MS); // segment 1..ready đã có
  const first = Math.max(1, ready - 3);
  const s = [];
  for (let n = first; n <= ready; n++) s.push(`      <S t="${(n - 1) * 90_000}" d="90000"/>`);
  return `<SegmentTemplate timescale="90000" media="live/v-$Number$.m4s">
    <SegmentTimeline FBPredictedMedia="live/v-$Number$.m4s?predicted=1"
        FBPredictedMediaStartNumber="1" FBPredictedMediaEndNumber="${ready}" FBAverageDuration="90000">
${s.join('\n')}
    </SegmentTimeline>
</SegmentTemplate>`;
}

type Row = Record<number, number>; // số segment → độ trễ ms

export default function DashSegmentsDemo() {
  const { lines, add } = useLog(40);
  const [running, setRunning] = useState(false);
  const [naive, setNaive] = useState<Row>({});
  const [predicted, setPredicted] = useState<Row>({});
  const [serverReady, setServerReady] = useState(0);
  const [xml, setXml] = useState(manifestAt(0));
  const stop = useRef(false);
  useEffect(() => () => void (stop.current = true), []);

  const run = async () => {
    stop.current = false;
    setRunning(true);
    setNaive({});
    setPredicted({});
    const t0 = performance.now();
    const now = () => performance.now() - t0;
    const readyAt = (n: number) => n * SEG_MS;
    /** Server giữ request tới khi segment có (long-poll), cộng một vòng mạng. */
    const fetchSegment = async (n: number) => {
      await sleep(Math.max(0, readyAt(n) - now()) + RTT);
      return now() - readyAt(n);
    };

    const tick = setInterval(() => setServerReady(Math.min(TOTAL, Math.floor(now() / SEG_MS))), 100);

    const naiveLoop = (async () => {
      let have = 0;
      while (!stop.current && have < TOTAL) {
        await sleep(RTT);
        const text = manifestAt(now());
        setXml(text);
        const tl = new PredictedTimeline(parseSegmentTemplate(text));
        const last = tl.last()?.number ?? 0;
        for (let n = have + 1; n <= Math.min(last, TOTAL); n++) {
          const delay = await fetchSegment(n);
          setNaive((r) => ({ ...r, [n]: delay }));
        }
        if (last > have) add(`Chờ manifest: manifest mới tới #${last}, tải ${Math.min(last, TOTAL) - have} segment`, 'muted');
        have = Math.max(have, Math.min(last, TOTAL));
        await sleep(MANIFEST_EVERY);
      }
    })();

    const predictLoop = (async () => {
      await sleep(RTT);
      const tl = new PredictedTimeline(parseSegmentTemplate(manifestAt(now())));
      let n = tl.last()?.number ?? 0;
      add(`Đoán URL: manifest đầu tiên kết thúc ở #${n}, từ đây không cần tải lại manifest`, 'ok');
      while (!stop.current && n < TOTAL) {
        const [next] = tl.predictAfter(n);
        const delay = await fetchSegment(next.number!);
        setPredicted((r) => ({ ...r, [next.number!]: delay }));
        if (next.number! <= 2) add(`Đoán URL: GET ${next.url} (server giữ request tới khi segment xong)`);
        n = next.number!;
      }
    })();

    await Promise.all([naiveLoop, predictLoop]);
    clearInterval(tick);
    setServerReady(TOTAL);
    setRunning(false);
  };

  const avg = (r: Row) => {
    const v = Object.values(r);
    return v.length ? `${Math.round(v.reduce((a, b) => a + b, 0) / v.length)} ms` : '—';
  };

  return (
    <div className='page dsg'>
      <h1>Segment DASH dự đoán và hộp sidx</h1>
      <p className='hint'>
        Luồng live: mỗi giây server có một segment mới. Player ngây thơ tải lại manifest mỗi 3 s và chỉ tải những segment đã được liệt kê.
        Player kiểu oz-player đọc <code>FBPredictedMedia</code> rồi xin luôn segment kế tiếp; server giữ request tới khi segment xong.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={run} disabled={running}>
          {running ? 'Đang phát…' : `Phát ${TOTAL} segment live`}
        </button>
      </div>
      <div className='stats'>
        <Stat label='Trễ TB: chờ manifest' value={<b className='warn'>{avg(naive)}</b>} />
        <Stat label='Trễ TB: đoán URL' value={<b className='ok'>{avg(predicted)}</b>} />
        <Stat label='Segment đã có trên server' value={serverReady} />
      </div>
      <div className='card dsg-grid' role='table' aria-label='Thời điểm nhận từng segment'>
        <div className='dsg-row'>
          <span className='dsg-label'>Segment</span>
          {Array.from({ length: TOTAL }, (_, i) => (
            <span key={i} className={`dsg-cell head ${i < serverReady ? 'ready' : ''}`}>
              {i + 1}
            </span>
          ))}
        </div>
        {[
          ['Chờ manifest', naive, 'warn'] as const,
          ['Đoán URL', predicted, 'ok'] as const,
        ].map(([label, row, tone]) => (
          <div className='dsg-row' key={label}>
            <span className='dsg-label'>{label}</span>
            {Array.from({ length: TOTAL }, (_, i) => (
              <span key={i} className={`dsg-cell ${row[i + 1] != null ? tone : ''}`} title={row[i + 1] != null ? `trễ ${Math.round(row[i + 1])} ms` : ''}>
                {row[i + 1] != null ? Math.round(row[i + 1] / 100) / 10 : ''}
              </span>
            ))}
          </div>
        ))}
        <p className='muted dsg-note'>Số trong ô: giây trễ từ lúc segment có trên server tới lúc player nhận xong.</p>
      </div>
      <details className='card'>
        <summary>Manifest mới nhất player ngây thơ nhận được</summary>
        <pre className='dsg-xml'>{xml}</pre>
      </details>
      <SidxSection add={add} />
      <Log lines={lines} />
    </div>
  );
}

function SidxSection({ add }: { add: (t: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void }) {
  const [refs, setRefs] = useState<SidxReference[]>([]);
  const [hex, setHex] = useState('');
  const [error, setError] = useState('');

  const build = () => {
    const header = 1200; // ftyp + moov giả
    const segments = Array.from({ length: 6 }, () => ({ size: 40_000 + Math.floor(Math.random() * 60_000), duration: 48_000 }));
    const sidx = buildSidx(24_000, segments);
    const file = new Uint8Array(header + sidx.byteLength);
    file.set(new TextEncoder().encode('....ftypisom'), 0);
    file.set(sidx, header);
    // Như khi tải "init + index" bằng một Range request rồi cắt ra phần sidx:
    const view = file.subarray(header, header + sidx.byteLength);
    setHex(Array.from(view.slice(0, 32), (b) => b.toString(16).padStart(2, '0')).join(' '));
    const parsed = parseSidx(view, header);
    setRefs(parsed.references);
    add(`sidx: ${parsed.references.length} segment, timescale ${parsed.timescale}`, 'ok');
    try {
      parseSidxIgnoringOffset(view, header);
      setError('');
    } catch (e) {
      setError((e as Error).message);
      add(`Đọc kiểu gốc new DataView(view.buffer): ${(e as Error).message}`, 'err');
    }
  };

  return (
    <div className='card dsg-sidx'>
      <div className='toolbar'>
        <b>Hộp sidx</b>
        <button onClick={build}>Tạo file MP4 giả và đọc sidx</button>
      </div>
      {hex && (
        <>
          <code className='dsg-hex'>{hex}</code>
          <div className='dsg-table-wrap'>
            <table className='dsg-table'>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Kích thước</th>
                  <th>Thời gian</th>
                  <th>Range header</th>
                </tr>
              </thead>
              <tbody>
                {refs.map((r, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>
                      {r.endByte - r.startByte + 1} B
                    </td>
                    <td>
                      {r.start}–{r.end} s
                    </td>
                    <td>
                      <code>
                        bytes={r.startByte}-{r.endByte}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={error ? 'err' : 'ok'}>
            Đọc kiểu gốc (bỏ qua byteOffset của view): {error ? `lỗi "${error}"` : 'không lỗi'}
          </p>
        </>
      )}
    </div>
  );
}
