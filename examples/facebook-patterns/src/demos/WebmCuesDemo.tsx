import { useMemo, useState } from 'react';
import { EBML_ID, children, parseWebmCues, parseWebmInit, rangeHeader, readUint, segmentAt, type WebmSegment } from '../lib/ebml';
import { buildWebm, ebmlTree } from '../lib/ebmlFixtures';
import { Stat } from './shared';
import './WebmCuesDemo.css';

/**
 * Mô phỏng hành vi của bản gốc (OzWebmSidxParser) để so sánh:
 * - tạo DataView từ `.buffer`, tức là đọc từ byte 0 của ArrayBuffer, bỏ qua byteOffset của view;
 * - thiếu Duration thì bảng rỗng;
 * - CuePoint phải có CueTime đứng đầu, CueTrackPositions đứng thứ hai;
 * - segment cuối luôn có endByte = null.
 */
function legacySegments(init: Uint8Array, cues: Uint8Array): WebmSegment[] | string {
  const info = parseWebmInit(new Uint8Array(init.buffer));
  if (!info) return 'không thấy EBML header ở byte 0 của ArrayBuffer';
  if (info.durationSec == null) return 'Info không có Duration nên hàm đọc Info trả null, bảng rỗng';
  const whole = new Uint8Array(cues.buffer);
  const root = children(whole).next().value;
  if (!root || root.id !== EBML_ID.Cues) return `phần tử đầu tiên của ArrayBuffer là 0x${root?.id.toString(16)}, không phải Cues`;
  const out: WebmSegment[] = [];
  for (const cp of children(whole, root.dataStart, root.dataEnd)) {
    const it = children(whole, cp.dataStart, cp.dataEnd);
    const first = it.next().value;
    const second = it.next().value;
    if (!first || first.id !== EBML_ID.CueTime || !second || second.id !== EBML_ID.CueTrackPositions) continue;
    const pos = [...children(whole, second.dataStart, second.dataEnd)].find((e) => e.id === EBML_ID.CueClusterPosition);
    const start = readUint(whole, first.dataStart, first.dataEnd) * info.timecodeScaleSec;
    out.push({ index: out.length, startSec: start, endSec: null, startByte: info.segmentDataOffset + (pos ? readUint(whole, pos.dataStart, pos.dataEnd) : 0), endByte: null });
  }
  out.forEach((s, i) => {
    s.endSec = out[i + 1]?.startSec ?? info.durationSec;
    s.endByte = out[i + 1] ? out[i + 1].startByte - 1 : null;
  });
  return out.length ? out : 'không CuePoint nào có CueTime đứng đầu';
}

/** getUint của bản gốc với số 8 byte: chỉ chặn 3 bit cao của byte đầu, nên nhận cả số 61 bit. */
function legacyGetUint(b: number[]): string {
  if (b.length === 8 && b[0] & 0xe0) return 'RangeError';
  return String(b.reduce((v, x) => v * 256 + x, 0));
}

const UINT_CASES: { label: string; bytes: number[] }[] = [
  { label: '2^53 − 1', bytes: [0x00, 0x1f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff] },
  { label: '2^61 − 1', bytes: [0x1f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff] },
  { label: '2^56 + 1', bytes: [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01] },
];

const COLORS: Record<string, string> = { EBML: 'var(--muted)', Segment: 'var(--muted)', SeekHead: 'var(--warn)', Info: 'var(--warn)', Tracks: 'var(--warn)', Cues: 'var(--accent)' };
const fmtSec = (s: number | null) => (s == null ? '?' : `${s.toFixed(1)} s`);

export default function WebmCuesDemo() {
  const [clusters, setClusters] = useState(8);
  const [withDuration, setWithDuration] = useState(true);
  const [swapCueOrder, setSwap] = useState(false);
  const [unknownSize, setUnknown] = useState(false);
  const [oneRequest, setOneRequest] = useState(false);
  const [t, setT] = useState(5);

  const data = useMemo(() => {
    const f = buildWebm({ clusters, clusterSec: 2, withDuration, swapCueOrder, unknownSegmentSize: unknownSize });
    const [, initEnd] = f.initRange;
    const [cuesStart, cuesEnd] = f.indexRange;
    let init: Uint8Array, cues: Uint8Array;
    if (oneRequest) {
      // Một request "bytes=0-<hết Cues>" rồi cắt hai phần bằng subarray: cùng một ArrayBuffer.
      const both = f.bytes.slice(0, cuesEnd + 1);
      init = both.subarray(0, initEnd + 1);
      cues = both.subarray(cuesStart, cuesEnd + 1);
    } else {
      init = f.bytes.slice(0, initEnd + 1);
      cues = f.bytes.slice(cuesStart, cuesEnd + 1);
    }
    const info = parseWebmInit(init);
    const segments = info ? parseWebmCues(cues, info) : [];
    return { f, info, segments, legacy: legacySegments(init, cues), tree: ebmlTree(f.bytes, 80) };
  }, [clusters, withDuration, swapCueOrder, unknownSize, oneRequest]);

  const { f, info, segments, legacy } = data;
  const maxT = clusters * 2;
  const current = segmentAt(segments, Math.min(t, maxT - 0.01));
  const total = f.bytes.length;

  return (
    <div className='page wcu'>
      <h1>Đọc WebM Cues để tìm byte range</h1>
      <p className='hint'>
        Demo dựng một file WebM giả ({(total / 1024).toFixed(0)} KB) bằng code: đúng cấu trúc EBML, nhưng dữ liệu khung hình là byte rác. Parser chỉ đọc phần init
        và phần tử <code>Cues</code> để biết mỗi khoảng thời gian nằm ở byte nào.
      </p>
      <div className='toolbar'>
        <label>
          Số Cluster{' '}
          <select value={clusters} onChange={(e) => setClusters(Number(e.target.value))}>
            {[4, 8, 16].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className='switch'>
          <input type='checkbox' checked={!withDuration} onChange={(e) => setWithDuration(!e.target.checked)} /> Thiếu Duration
        </label>
        <label className='switch'>
          <input type='checkbox' checked={swapCueOrder} onChange={(e) => setSwap(e.target.checked)} /> CueTrackPositions trước CueTime
        </label>
        <label className='switch'>
          <input type='checkbox' checked={unknownSize} onChange={(e) => setUnknown(e.target.checked)} /> Segment không biết kích thước
        </label>
        <label className='switch'>
          <input type='checkbox' checked={oneRequest} onChange={(e) => setOneRequest(e.target.checked)} /> Một request cho init + Cues
        </label>
      </div>

      <div className='stats'>
        <Stat label='TimecodeScale' value={info ? `${info.timecodeScaleSec * 1e3} ms` : '—'} />
        <Stat label='Duration' value={fmtSec(info?.durationSec ?? null)} />
        <Stat label='Segment (viết lại)' value={<span className='ok'>{segments.length}</span>} />
        <Stat label='Segment (bản gốc)' value={<span className={typeof legacy === 'string' ? 'err' : legacy.length === segments.length ? 'ok' : 'warn'}>{typeof legacy === 'string' ? 0 : legacy.length}</span>} />
      </div>
      {typeof legacy === 'string' && <p className='err wcu-note'>Bản gốc: {legacy}.</p>}

      <div className='card wcu-map-card'>
        <div className='wcu-map' aria-label='Bản đồ byte của file'>
          {f.blocks.map((b) => {
            const isCluster = b.name.startsWith('Cluster');
            const active = current && isCluster && b.start === current.startByte;
            return (
              <div
                key={b.name}
                className={`wcu-block${active ? ' active' : ''}`}
                style={{ flexGrow: Math.max(b.end - b.start + 1, total / 120), background: isCluster ? undefined : COLORS[b.name] }}
                title={`${b.name}: byte ${b.start}–${b.end}`}
              />
            );
          })}
        </div>
        <div className='wcu-legend muted'>
          <span><i style={{ background: 'var(--warn)' }} /> init (SeekHead, Info, Tracks)</span>
          <span><i style={{ background: 'var(--accent)' }} /> Cues</span>
          <span><i className='cl' /> Cluster</span>
        </div>
        <label className='wcu-seek'>
          Tua tới <b>{t.toFixed(1)} s</b>
          <input type='range' min={0} max={maxT} step={0.1} value={Math.min(t, maxT)} onChange={(e) => setT(Number(e.target.value))} />
        </label>
        <p className='wcu-range'>
          {current ? (
            <>
              Segment #{current.index} ({fmtSec(current.startSec)} → {fmtSec(current.endSec)}): <code>Range: {rangeHeader(current)}</code>
            </>
          ) : (
            <span className='muted'>Không có segment cho thời điểm này.</span>
          )}
        </p>
      </div>

      <div className='wcu-grid'>
        <div className='card wcu-scroll'>
          <b>Bảng segment</b>
          <table className='wcu-table'>
            <thead>
              <tr>
                <th>#</th>
                <th>Thời gian</th>
                <th>Byte (viết lại)</th>
                <th>Byte cuối (gốc)</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s) => {
                const l = typeof legacy === 'string' ? undefined : legacy[s.index];
                return (
                  <tr key={s.index} className={current?.index === s.index ? 'cur' : ''}>
                    <td>{s.index}</td>
                    <td>
                      {fmtSec(s.startSec)} → {fmtSec(s.endSec)}
                    </td>
                    <td>
                      {s.startByte}–{s.endByte ?? '∞'}
                    </td>
                    <td className={l === undefined ? 'err' : l.endByte !== s.endByte ? 'warn' : ''}>{l === undefined ? 'thiếu' : (l.endByte ?? '∞')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className='card wcu-scroll'>
          <b>Cây EBML (80 phần tử đầu)</b>
          <div className='wcu-tree'>
            {data.tree.map((r) => (
              <div key={r.start} style={{ paddingLeft: r.depth * 14 }}>
                <span className={r.name === 'Cues' || r.name.startsWith('Cue') ? 'wcu-hl' : ''}>{r.name}</span> <span className='muted'>{r.id} @{r.start}, {r.size == null ? 'size ?' : `${r.size} B`}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className='card wcu-x'>
        <b>Số nguyên 8 byte</b>
        <table className='wcu-table'>
          <thead>
            <tr>
              <th>Giá trị</th>
              <th>Đúng (BigInt)</th>
              <th>Bản gốc</th>
              <th>Viết lại</th>
            </tr>
          </thead>
          <tbody>
            {UINT_CASES.map((c) => {
              const exact = c.bytes.reduce((v, x) => v * 256n + BigInt(x), 0n).toString();
              const old = legacyGetUint(c.bytes);
              let mine: string;
              try {
                mine = String(readUint(Uint8Array.from(c.bytes), 0, 8));
              } catch {
                mine = 'RangeError';
              }
              return (
                <tr key={c.label}>
                  <td>{c.label}</td>
                  <td>{exact}</td>
                  <td className={old === exact ? 'ok' : old === 'RangeError' ? '' : 'err'}>{old}</td>
                  <td className={mine === exact || mine === 'RangeError' ? 'ok' : 'err'}>{mine}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
