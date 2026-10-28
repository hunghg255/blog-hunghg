/**
 * Đọc metadata MP4/MOV ngay trên trình duyệt trước khi upload (kiểu VideoUploadMetadataParser của Facebook):
 * duyệt cây hộp ISO-BMFF bằng Blob.slice, lấy thời lượng, track, kích thước, góc xoay và metadata video 360.
 * Viết lại từ đầu.
 */

export interface TrackInfo {
  id: number;
  type: 'video' | 'audio' | 'subtitle' | 'data';
  /** Kích thước mã hoá (tkhd), chưa xoay. */
  width: number;
  height: number;
  /** Góc xoay đọc từ ma trận tkhd: 0, 90, 180, 270. */
  rotation: number;
  durationSec: number | null;
  sampleCount: number | null;
  codec: string | null;
}

export interface SphericalInfo {
  source: 'gspherical-v1' | 'fb-spherical';
  projection: string | null;
  stereoMode: string | null;
  vr180: boolean;
  /** Tag không nằm trong danh sách hỗ trợ (bản gốc gõ sai "GSphercal" nên tag crop đúng chuẩn rơi vào đây). */
  unknownTags: string[];
  xml: string;
}

export interface Mp4Metadata {
  majorBrand: string | null;
  durationSec: number | null;
  tracks: TrackInfo[];
  primaryVideo: TrackInfo | null;
  primaryAudio: TrackInfo | null;
  spherical: SphericalInfo | null;
  /** Số lần đọc Blob.slice, để thấy mdat lớn được nhảy qua chứ không đọc. */
  reads: number;
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta']);
const HANDLERS: Record<string, TrackInfo['type']> = { vide: 'video', soun: 'audio', subt: 'subtitle', text: 'subtitle' };
const GSPHERICAL_UUID = 'ffcc8263f8554a938814587a02521fdd';
const FBSPHERICAL_UUID = 'ae24b24d3c8f4f188a7be009c13835c1';
const KNOWN_GSPHERICAL = [
  'Spherical', 'Stitched', 'StitchingSoftware', 'ProjectionType', 'StereoMode', 'SourceCount',
  'InitialViewHeadingDegrees', 'InitialViewPitchDegrees', 'InitialViewRollDegrees', 'Timestamp',
  'FullPanoWidthPixels', 'FullPanoHeightPixels', 'CroppedAreaImageWidthPixels', 'CroppedAreaImageHeightPixels',
  'CroppedAreaLeftPixels', 'CroppedAreaTopPixels',
];

const fourcc = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
const u64 = (v: DataView, o: number) => v.getUint32(o) * 2 ** 32 + v.getUint32(o + 4);
const hex = (v: DataView, o: number, n: number) =>
  Array.from({ length: n }, (_, i) => v.getUint8(o + i).toString(16).padStart(2, '0')).join('');

/** mvhd/mdhd: version 1 dùng thời gian 64-bit nên mọi offset phía sau dịch đi. */
export function readTimescaleDuration(v: DataView): number | null {
  const version = v.getUint8(8);
  const timescale = version === 1 ? v.getUint32(28) : v.getUint32(20);
  const duration = version === 1 ? u64(v, 32) : v.getUint32(24);
  return timescale ? duration / timescale : null;
}

function readTkhd(v: DataView) {
  const version = v.getUint8(8);
  const base = version === 1 ? 12 : 0; // creation/modification/duration 64-bit thay vì 32-bit
  const id = v.getUint32(version === 1 ? 28 : 20);
  const m = 48 + base; // ma trận 3×3, a b u / c d v / x y w, a b c d dạng 16.16
  const a = v.getInt32(m) / 65536;
  const b = v.getInt32(m + 4) / 65536;
  const rotation = (Math.round((Math.atan2(b, a) * 180) / Math.PI) + 360) % 360;
  return { id, rotation, width: v.getUint32(84 + base) / 65536, height: v.getUint32(88 + base) / 65536 };
}

export async function parseMp4(blob: Blob, { maxPayload = 64 * 1024 } = {}): Promise<Mp4Metadata> {
  const out: Mp4Metadata = { majorBrand: null, durationSec: null, tracks: [], primaryVideo: null, primaryAudio: null, spherical: null, reads: 0 };
  const read = async (start: number, len: number) => {
    out.reads++;
    return new DataView(await blob.slice(start, start + len).arrayBuffer());
  };
  let track: TrackInfo | null = null;

  async function walk(start: number, end: number, parent: string): Promise<void> {
    let pos = start;
    while (pos + 8 <= end) {
      const h = await read(pos, 16);
      let size = h.getUint32(0);
      const type = fourcc(h, 4);
      let header = 8;
      if (size === 1) {
        if (h.byteLength < 16) throw new Error(`Hộp ${type} bị cắt cụt`);
        size = u64(h, 8);
        header = 16;
      } else if (size === 0) size = end - pos; // hộp kéo dài tới hết file, chuẩn cho phép
      if (pos === 0 && type !== 'ftyp') throw new Error('Không có hộp ftyp ở đầu: không phải MP4/MOV');
      if (size < header || pos + size > end) throw new Error(`Hộp ${type} ở byte ${pos} có kích thước sai (${size})`);

      if (CONTAINERS.has(type)) {
        if (type === 'trak') track = { id: 0, type: 'data', width: 0, height: 0, rotation: 0, durationSec: null, sampleCount: null, codec: null };
        await walk(pos + header, pos + size, type);
        if (type === 'trak' && track) out.tracks.push(track);
      } else if (type !== 'mdat' && type !== 'free' && type !== 'skip') {
        const v = await read(pos, Math.min(size, maxPayload)); // mdat không bao giờ được đọc
        leaf(type, v, parent);
      }
      pos += size;
    }
  }

  function leaf(type: string, v: DataView, parent: string) {
    switch (type) {
      case 'ftyp':
        out.majorBrand = fourcc(v, 8);
        break;
      case 'mvhd':
        out.durationSec = readTimescaleDuration(v);
        break;
      case 'tkhd':
        if (track) Object.assign(track, readTkhd(v));
        break;
      case 'mdhd':
        if (track) track.durationSec = readTimescaleDuration(v);
        break;
      case 'hdlr':
        // MOV có thêm hdlr trong minf (data handler 'alis'): chỉ tin hdlr nằm ngay dưới mdia
        if (track && parent === 'mdia') track.type = HANDLERS[fourcc(v, 16)] ?? 'data';
        break;
      case 'stsd':
        // stsd: header 8, version/flags 4, entry_count 4, rồi entry đầu: size 4 + định dạng 4
        if (track && v.byteLength >= 24) track.codec = fourcc(v, 20).trim();
        break;
      case 'stsz':
        if (track) track.sampleCount = v.getUint32(16);
        break;
      case 'uuid':
        if (v.byteLength > 24) readSphericalUuid(v);
        break;
    }
  }

  function readSphericalUuid(v: DataView) {
    const id = hex(v, 8, 16);
    if (id !== GSPHERICAL_UUID && id !== FBSPHERICAL_UUID) return;
    const xml = new TextDecoder().decode(new Uint8Array(v.buffer, v.byteOffset + 24, v.byteLength - 24)).replace(/\0/g, '');
    const s = parseSphericalXml(xml, id === GSPHERICAL_UUID ? 'gspherical-v1' : 'fb-spherical');
    if (s && (!out.spherical || s.source === 'gspherical-v1')) out.spherical = s;
  }

  await walk(0, blob.size, '');
  for (const t of out.tracks) {
    if (t.type === 'video') {
      // Chọn track hình LỚN nhất (bản gốc giữ track nhỏ nhất)
      if (!out.primaryVideo || t.width * t.height > out.primaryVideo.width * out.primaryVideo.height) out.primaryVideo = t;
    } else if (t.type === 'audio') {
      if (!out.primaryAudio || (t.durationSec ?? 0) > (out.primaryAudio.durationSec ?? 0)) out.primaryAudio = t;
    }
  }
  return out;
}

/** Đọc XML Spherical Video V1 theo TÊN CỤC BỘ, không phụ thuộc tiền tố namespace. */
export function parseSphericalXml(xml: string, source: SphericalInfo['source']): SphericalInfo | null {
  const tags = new Map<string, string>();
  const unknownTags: string[] = [];
  for (const m of xml.matchAll(/<([\w-]+):([\w-]+)>([^<]*)<\/\1:\2>/g)) {
    const [, prefix, local, value] = m;
    tags.set(local, value.trim());
    if (prefix === 'GSpherical' && !KNOWN_GSPHERICAL.includes(local)) unknownTags.push(`${prefix}:${local}`);
  }
  if (tags.get('Spherical')?.toLowerCase() !== 'true') return null;
  const projection = tags.get('ProjectionType') ?? null;
  const stereoMode = tags.get('StereoMode') ?? null;
  const num = (k: string) => (tags.has(k) ? Number.parseInt(tags.get(k)!, 10) : null);
  return {
    source,
    projection,
    stereoMode,
    vr180: isVR180(projection, stereoMode, num('CroppedAreaImageWidthPixels'), num('CroppedAreaImageHeightPixels'), num('FullPanoWidthPixels'), num('FullPanoHeightPixels')),
    unknownTags,
    xml,
  };
}

/** VR180: ảnh equirect stereo chỉ phủ nửa vòng ngang (crop rộng = nửa pano), phủ đủ chiều dọc. */
export function isVR180(projection: string | null, stereo: string | null, cropW: number | null, cropH: number | null, fullW: number | null, fullH: number | null) {
  if (cropW == null || cropH == null || fullW == null || fullH == null) return false;
  if (projection !== 'equirectangular' || (stereo !== 'left-right' && stereo !== 'top-bottom')) return false;
  return Math.abs(cropW - fullW / 2) <= 1 && Math.abs(cropH - fullH) <= 1;
}

/** Kích thước hiển thị sau khi áp góc xoay (video quay dọc trên điện thoại thường là 1920×1080 + xoay 90°). */
export const displaySize = (t: TrackInfo) =>
  t.rotation % 180 === 90 ? { width: t.height, height: t.width } : { width: t.width, height: t.height };

export interface UploadRules {
  extensions: string[];
  minSize: number;
  maxSize: number;
  minLengthSec: number;
  maxLengthSec: number;
  minWidth: number;
  minHeight: number;
  minAspect?: number;
  maxAspect?: number;
}

export interface ValidationError {
  code: 'extension' | 'too_small' | 'too_large' | 'too_short' | 'too_long' | 'no_video' | 'too_narrow' | 'too_low' | 'too_tall' | 'too_wide';
  message: string;
}

/** Trả về MỌI lỗi, theo thứ tự nên sửa trước (bản gốc ghi đè biến lỗi nên chỉ còn lỗi cuối). */
export function validateUpload(file: { name: string; size: number }, meta: Mp4Metadata | null, r: UploadRules): ValidationError[] {
  const errors: ValidationError[] = [];
  const push = (code: ValidationError['code'], message: string) => errors.push({ code, message });
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!r.extensions.includes(ext)) push('extension', `Định dạng .${ext} không được hỗ trợ`);
  if (file.size < r.minSize) push('too_small', `File nhỏ hơn ${Math.round(r.minSize / 1024)} KB`);
  if (file.size > r.maxSize) push('too_large', `File lớn hơn ${Math.floor(r.maxSize / 1024 / 1024)} MB`);
  if (!meta) return errors;
  const d = meta.durationSec;
  if (d != null && d > r.maxLengthSec) push('too_long', `Dài hơn ${r.maxLengthSec} giây`);
  if (d != null && d < r.minLengthSec) push('too_short', `Ngắn hơn ${r.minLengthSec} giây`);
  if (!meta.primaryVideo) {
    push('no_video', meta.primaryAudio ? 'File chỉ có âm thanh, không có hình' : 'Không tìm thấy track hình');
    return errors;
  }
  const { width, height } = displaySize(meta.primaryVideo);
  if (width < r.minWidth) push('too_narrow', `Rộng ${width}px, tối thiểu ${r.minWidth}px`);
  if (height < r.minHeight) push('too_low', `Cao ${height}px, tối thiểu ${r.minHeight}px`);
  const ratio = height ? width / height : Infinity;
  if (r.minAspect && ratio < r.minAspect) push('too_tall', `Tỉ lệ ${ratio.toFixed(2)} nhỏ hơn ${r.minAspect}`);
  if (r.maxAspect && ratio > r.maxAspect) push('too_wide', `Tỉ lệ ${ratio.toFixed(2)} lớn hơn ${r.maxAspect}`);
  return errors;
}

/** Kích thước do trình duyệt giải mã (đã xoay), có timeout và luôn dọn object URL. */
export function probeWithVideoElement(file: Blob, timeoutMs = 5000): Promise<{ width: number; height: number; duration: number } | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (value: { width: number; height: number; duration: number } | null) => {
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    video.preload = 'metadata';
    video.onloadedmetadata = () => done({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
    video.onerror = () => done(null);
    video.src = url;
  });
}
