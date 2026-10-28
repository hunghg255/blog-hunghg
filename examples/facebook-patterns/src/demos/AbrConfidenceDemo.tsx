import { useEffect, useMemo, useState } from 'react';
import {
  chooseRendition,
  excludeLarge,
  mosAt,
  parseMos,
  pruneExpensiveRungs,
  qualityLabel,
  segmentsToPrefetch,
  type Rendition,
} from '../lib/abrConfidence';
import { Stat } from './shared';
import './AbrConfidenceDemo.css';

const LADDER: [string, number, number, number, string][] = [
  ['240p', 300_000, 426, 240, '240:62,360:55,480:48,720:40,1080:33'],
  ['360p', 650_000, 640, 360, '240:68,360:70,480:64,720:56,1080:48'],
  ['480p', 1_100_000, 854, 480, '240:70,360:75,480:76,720:68,1080:60'],
  ['720p', 2_200_000, 1280, 720, '240:71,360:77,480:81,720:84,1080:78'],
  ['720p HQ', 3_000_000, 1280, 720, '240:71,360:77,480:82,720:86,1080:82'],
  ['1080p', 4_800_000, 1920, 1080, '240:71,360:78,480:82,720:87,1080:92'],
];

const VIEWPORTS = {
  feed: { label: 'Feed điện thoại 412×232 @2,6x', width: 412, height: 232, dpr: 2.6 },
  desktop: { label: 'Desktop 800×450 @1x', width: 800, height: 450, dpr: 1 },
  full: { label: 'Toàn màn hình 1920×1080', width: 1920, height: 1080, dpr: 1 },
} as const;
type VpKey = keyof typeof VIEWPORTS;

const SIZE_FACTOR = 1.25; // resolution_constraint_factor: cho phép bậc to hơn khung hình 25%
const OPTIONS = { threshold: 0.85, lowBufferMs: 10_000, lowBufferFactor: 0.5, preventDownSwitchMs: 20_000 };
const mbps = (v: number) => `${(v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} Mbps`;

export default function AbrConfidenceDemo() {
  const [bandwidth, setBandwidth] = useState(2_600_000);
  const [bufferSec, setBufferSec] = useState(12);
  const [vpKey, setVpKey] = useState<VpKey>('feed');
  const [portrait, setPortrait] = useState(false);
  const [orBug, setOrBug] = useState(false);
  const [useMos, setUseMos] = useState(true);
  const [current, setCurrent] = useState<Rendition | null>(null);

  const ladder: Rendition[] = useMemo(
    () =>
      LADDER.map(([id, bitrate, w, h, mos]) => ({
        id,
        bitrate,
        width: portrait ? h : w,
        height: portrait ? w : h,
        mos: parseMos(mos) ?? undefined,
      })),
    [portrait],
  );

  const vp = VIEWPORTS[vpKey];
  const display = qualityLabel(Math.round(vp.width * vp.dpr), Math.round(vp.height * vp.dpr));
  const sized = excludeLarge(ladder, vp, SIZE_FACTOR, orBug ? 'or' : 'and');
  const { kept, pruned } = useMos ? pruneExpensiveRungs(sized, display, bandwidth, 3, 2) : { kept: sized, pruned: [] };
  const decision = chooseRendition(kept, { bandwidth, bufferMs: bufferSec * 1000, current }, OPTIONS);
  const naive = [...ladder].reverse().find((r) => r.bitrate <= bandwidth) ?? ladder[0];
  const prefetch = segmentsToPrefetch(kept, bandwidth, bandwidth * 0.15, 1, 5, 2);

  useEffect(() => {
    if (decision.pick.id !== current?.id) setCurrent(decision.pick);
  }, [decision.pick, current]);

  const statusOf = (r: Rendition) => {
    if (!sized.includes(r)) return { text: 'to hơn khung hình', tone: 'muted' };
    if (pruned.includes(r)) return { text: 'MOS tăng không đáng', tone: 'warn' };
    if (r.id === decision.pick.id) return { text: decision.reason === 'high_buffer' ? 'giữ (buffer cao)' : 'được chọn', tone: 'ok' };
    return { text: '', tone: '' };
  };

  return (
    <div className='page abr'>
      <h1>ABR theo độ tự tin phát</h1>
      <p className='hint'>
        Kéo băng thông và buffer. Mỗi bậc có một điểm tự tin; chọn bậc cao nhất có điểm &gt; {OPTIONS.threshold}. Buffer dưới{' '}
        {OPTIONS.lowBufferMs / 1000} s thì mỗi bậc phải "trả" thêm tới 50% băng thông. So với cách ngây thơ "bậc cao nhất ≤ băng thông".
      </p>
      <div className='abr-controls card'>
        <label>
          Băng thông <b>{mbps(bandwidth)}</b>
          <input type='range' min={200_000} max={8_000_000} step={50_000} value={bandwidth} onChange={(e) => setBandwidth(+e.target.value)} />
        </label>
        <label>
          Buffer phía trước <b>{bufferSec} s</b>
          <input type='range' min={0} max={30} step={1} value={bufferSec} onChange={(e) => setBufferSec(+e.target.value)} />
        </label>
        <div className='toolbar'>
          <select value={vpKey} onChange={(e) => setVpKey(e.target.value as VpKey)}>
            {Object.entries(VIEWPORTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <label className='abr-check'>
            <input type='checkbox' checked={portrait} onChange={(e) => setPortrait(e.target.checked)} /> Video dọc 9:16
          </label>
          <label className='abr-check'>
            <input type='checkbox' checked={orBug} onChange={(e) => setOrBug(e.target.checked)} /> Lọc kích thước bằng <code>||</code> như gốc
          </label>
          <label className='abr-check'>
            <input type='checkbox' checked={useMos} onChange={(e) => setUseMos(e.target.checked)} /> Cắt bậc theo MOS
          </label>
        </div>
      </div>
      <div className='stats'>
        <Stat label='Ngây thơ: cao nhất ≤ băng thông' value={naive.id} />
        <Stat label={`Theo độ tự tin (${decision.reason})`} value={<b className='ok'>{decision.pick.id}</b>} />
        <Stat label='Độ phân giải hiển thị' value={`${display}p`} />
        <Stat label={prefetch.near ? 'Sát ranh giới bậc: tải ít' : 'Segment tải trước'} value={prefetch.count} />
      </div>
      <div className='card abr-table-wrap'>
        <table className='abr-table'>
          <thead>
            <tr>
              <th>Bậc</th>
              <th>Bitrate</th>
              <th>MOS @{display}p</th>
              <th>Độ tự tin</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {ladder.map((r) => {
              const score = decision.scores.find((s) => s.id === r.id);
              const st = statusOf(r);
              return (
                <tr key={r.id} className={r.id === decision.pick.id ? 'abr-pick' : ''}>
                  <td>
                    {r.id}
                    <small>
                      {r.width}×{r.height}
                    </small>
                  </td>
                  <td>{mbps(r.bitrate)}</td>
                  <td>{r.mos ? mosAt(r.mos, display).toFixed(0) : '—'}</td>
                  <td>
                    {score ? (
                      <div className='abr-bar'>
                        <span
                          style={{ width: `${Math.max(0, score.confidence) * 100}%` }}
                          className={score.confidence > OPTIONS.threshold ? 'pass' : 'fail'}
                        />
                        <em>{score.confidence.toFixed(2)}</em>
                      </div>
                    ) : (
                      <span className='muted'>—</span>
                    )}
                  </td>
                  <td className={st.tone}>{st.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
