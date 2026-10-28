import { useState } from 'react';
import { displaySize, parseMp4, probeWithVideoElement, validateUpload, type Mp4Metadata, type UploadRules } from '../lib/mp4Metadata';
import { buildMp4, gsphericalXml, type FixtureOptions } from '../lib/mp4MetadataFixtures';
import { Log, Stat, useLog } from './shared';
import './Mp4MetadataDemo.css';

const RULES: UploadRules = {
  extensions: ['mp4', 'mov', 'm4v', '3gp', '3g2'],
  minSize: 1024,
  maxSize: 4 * 1024 ** 3,
  minLengthSec: 1,
  maxLengthSec: 4 * 3600,
  minWidth: 120,
  minHeight: 120,
};

const PRESETS: { key: string; label: string; opts: FixtureOptions; name: string }[] = [
  { key: 'normal', label: 'MP4 1080p thường', name: 'clip.mp4', opts: { durationSec: 12.5, tracks: [{ kind: 'video' }, { kind: 'audio' }] } },
  { key: 'portrait', label: 'Quay dọc (xoay 90°)', name: 'phone.mp4', opts: { durationSec: 8, tracks: [{ kind: 'video', rotation: 90 }, { kind: 'audio' }] } },
  { key: 'v1', label: 'mvhd version 1', name: 'long.mp4', opts: { durationSec: 30, mvhdVersion: 1, tracks: [{ kind: 'video' }] } },
  { key: 'mdat', label: 'mdat 8 MB trước moov', name: 'raw.mov', opts: { durationSec: 60, mdatFirstBytes: 8_000_000, quicktimeDataHandler: true, tracks: [{ kind: 'video', width: 1280, height: 720 }] } },
  {
    key: 'vr180',
    label: 'VR180 (GSpherical)',
    name: 'vr180.mp4',
    opts: { durationSec: 20, tracks: [{ kind: 'video', width: 5760, height: 2880 }], sphericalXml: gsphericalXml({ stereo: 'left-right', crop: [2880, 2880, 5760, 2880] }) },
  },
  { key: 'audio', label: 'Chỉ có audio', name: 'voice.m4v', opts: { durationSec: 20, tracks: [{ kind: 'audio' }] } },
  { key: 'tiny', label: 'Nhỏ và ngắn', name: 'tiny.mp4', opts: { durationSec: 0.5, tracks: [{ kind: 'video', width: 100, height: 100 }] } },
];

/** Danh sách tag của bản gốc, giữ nguyên lỗi gõ "GSphercal". */
const META_TAGS = [
  'GSpherical:Spherical', 'GSpherical:InitialViewHeadingDegrees', 'GSpherical:InitialViewPitchDegrees', 'GSpherical:ProjectionType',
  'GSpherical:StereoMode', 'GSpherical:Stitched', 'GSpherical:StitchingSoftware', 'GSphercal:CroppedAreaImageWidthPixels',
  'GSphercal:CroppedAreaImageHeightPixels', 'GSphercal:CroppedAreaLeftPixels', 'GSphercal:CroppedAreaTopPixels',
  'GSphercal:FullPanoWidthPixels', 'GSphercal:FullPanoHeightPixels',
];

interface Result {
  name: string;
  size: number;
  meta: Mp4Metadata | null;
  error: string | null;
  ms: number;
  legacy: string[];
  player: string | null;
}

/** Bản gốc đọc timescale/duration ở offset của version 0 bất kể version. */
function legacyDuration(mvhd: Uint8Array) {
  const v = new DataView(mvhd.buffer, mvhd.byteOffset);
  return v.getUint32(24) / v.getUint32(20); // như bản gốc: chia cho 0 ra Infinity
}

function legacyNotes(key: string, meta: Mp4Metadata | null, mvhd: Uint8Array | null): string[] {
  const notes: string[] = [];
  if (mvhd && mvhd[8] === 1) {
    const d = legacyDuration(mvhd);
    notes.push(`mvhd v1 đọc bằng offset v0: timescale lấy nhầm nửa cao của modification_time (= 0) → thời lượng ${d} (thật: ${meta?.durationSec} s)${d > RULES.maxLengthSec ? ', validator báo "video quá dài"' : ''}`);
  }
  const v = meta?.primaryVideo;
  if (v && v.rotation) notes.push(`tkhd cho ${v.width}×${v.height}, bản gốc không đọc ma trận xoay; chỉ đúng khi lấy kích thước từ <video>`);
  if (meta?.spherical) {
    const tags = [...meta.spherical.xml.matchAll(/<(GSpherical:\w+)>/g)].map((m) => m[1]);
    const flagged = tags.filter((t) => !META_TAGS.includes(t));
    if (flagged.length) notes.push(`${flagged.length} tag đúng chuẩn bị coi là "không hỗ trợ" vì danh sách gõ "GSphercal": ${flagged.map((t) => t.split(':')[1]).join(', ')}`);
  }
  if (meta && !meta.primaryVideo && meta.primaryAudio) notes.push('Validator gốc return sớm khi không có primaryVideo, nên nhánh "chỉ có audio" không bao giờ chạy: file qua kiểm tra');
  const errs = meta ? validateUpload({ name: 'x.mp4', size: 1e6 }, meta, RULES) : [];
  if (errs.length > 1) notes.push(`Có ${errs.length} lỗi nhưng bản gốc ghi đè biến lỗi, chỉ báo lỗi cuối: "${errs[errs.length - 1].message}"`);
  if (key === 'mdat') notes.push('Bản gốc đọc từng khúc 5 MB; mdat 8 MB lớn hơn khúc nên được nhảy qua. Nếu moov > 5 MB (video rất dài) thì moov cũng bị nhảy qua như vậy');
  return notes;
}

export default function Mp4MetadataDemo() {
  const { lines, add } = useLog(30);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  const analyze = async (blob: Blob, name: string, key: string, mvhd: Uint8Array | null, realFile: boolean) => {
    setBusy(true);
    const t0 = performance.now();
    let meta: Mp4Metadata | null = null;
    let error: string | null = null;
    try {
      meta = await parseMp4(blob);
    } catch (e) {
      error = (e as Error).message;
    }
    const ms = performance.now() - t0;
    let player: string | null = null;
    if (realFile) {
      const p = await probeWithVideoElement(blob);
      player = p ? `${p.width}×${p.height}, ${p.duration.toFixed(2)} s` : 'trình duyệt không đọc được (codec?)';
    }
    setResult({ name, size: blob.size, meta, error, ms, legacy: legacyNotes(key, meta, mvhd), player });
    add(`${name}: ${error ? `lỗi: ${error}` : `${meta!.tracks.length} track, ${meta!.reads} lần đọc, ${ms.toFixed(1)} ms`}`, error ? 'err' : 'ok');
    setBusy(false);
  };

  const runPreset = (p: (typeof PRESETS)[number]) => {
    const { blob, mvhd } = buildMp4(p.opts);
    void analyze(blob, p.name, p.key, mvhd, false);
  };

  const meta = result?.meta;
  const errors = meta ? validateUpload({ name: result!.name, size: result!.size }, meta, RULES) : [];
  const shown = meta?.primaryVideo ? displaySize(meta.primaryVideo) : null;

  return (
    <div className='page mp4m'>
      <h1>Đọc metadata MP4 trên client</h1>
      <p className='hint'>
        Dựng một file MP4 tối giản ngay trong trình duyệt (hoặc chọn video thật) rồi đọc cây hộp bằng <code>Blob.slice</code>. Hộp{' '}
        <code>mdat</code> chứa hình và tiếng không bao giờ được đọc.
      </p>
      <div className='toolbar'>
        {PRESETS.map((p) => (
          <button key={p.key} onClick={() => runPreset(p)} disabled={busy}>
            {p.label}
          </button>
        ))}
        <label className='mp4m-file'>
          <input
            type='file'
            accept='video/*,.mov,.mp4,.m4v'
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void analyze(f, f.name, 'file', null, true);
            }}
          />
          Chọn video thật…
        </label>
      </div>
      {result && (
        <>
          <div className='stats'>
            <Stat label='Thời lượng' value={meta?.durationSec != null ? `${meta.durationSec.toFixed(2)} s` : '—'} />
            <Stat label='Kích thước hiển thị' value={shown ? `${shown.width}×${shown.height}` : '—'} />
            <Stat label={`Lần đọc (file ${result.size >= 1e6 ? `${(result.size / 1e6).toFixed(1)} MB` : `${Math.ceil(result.size / 1024)} KB`})`} value={meta?.reads ?? '—'} />
            <Stat label='Video 360' value={meta?.spherical ? (meta.spherical.vr180 ? 'VR180' : meta.spherical.projection ?? 'có') : 'không'} />
          </div>
          {result.error && <p className='err'>Lỗi: {result.error}</p>}
          {meta && (
            <div className='card mp4m-wrap'>
              <table className='mp4m-table'>
                <thead>
                  <tr>
                    <th>Track</th>
                    <th>Loại</th>
                    <th>Codec</th>
                    <th>tkhd</th>
                    <th>Xoay</th>
                    <th>Thời lượng</th>
                    <th>Mẫu</th>
                  </tr>
                </thead>
                <tbody>
                  {meta.tracks.map((t) => (
                    <tr key={t.id} className={t === meta.primaryVideo || t === meta.primaryAudio ? 'primary' : ''}>
                      <td>#{t.id}</td>
                      <td>{t.type}</td>
                      <td>{t.codec}</td>
                      <td>{t.type === 'video' ? `${t.width}×${t.height}` : '—'}</td>
                      <td>{t.rotation}°</td>
                      <td>{t.durationSec?.toFixed(2)} s</td>
                      <td>{t.sampleCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className='muted mp4m-small'>
                Brand <code>{meta.majorBrand}</code> · đọc trong {result.ms.toFixed(1)} ms
                {result.player && <> · thẻ &lt;video&gt;: {result.player}</>}
              </p>
            </div>
          )}
          <div className='split mp4m-split'>
            <div className='card'>
              <b>Kiểm tra trước khi upload</b>
              {result.error ? (
                <p className='err'>Không đọc được metadata, chặn upload hoặc để server kiểm tra</p>
              ) : errors.length === 0 ? (
                <p className='ok'>Hợp lệ</p>
              ) : (
                <ul className='mp4m-list err'>
                  {errors.map((e) => (
                    <li key={e.code}>{e.message}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className='card'>
              <b>Bản gốc sẽ khác ở đâu</b>
              {result.legacy.length === 0 ? (
                <p className='muted'>Không khác</p>
              ) : (
                <ul className='mp4m-list warn'>
                  {result.legacy.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
      <Log lines={lines} />
    </div>
  );
}
