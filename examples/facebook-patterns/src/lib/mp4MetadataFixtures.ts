/** Dựng file MP4/MOV tối giản (chỉ có hộp metadata, mdat toàn số 0) cho demo và test của mp4Metadata.ts. */

const enc = new TextEncoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function bytes(len: number, write: (v: DataView) => void): Uint8Array {
  const u = new Uint8Array(len);
  write(new DataView(u.buffer));
  return u;
}

export function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);
  const head = bytes(8, (v) => v.setUint32(0, 8 + body.length));
  head.set(enc.encode(type), 4);
  return concat([head, body]);
}

const fullHeader = (version: number) => bytes(4, (v) => v.setUint8(0, version));

function matrix(rotation: number): Uint8Array {
  const r = (rotation * Math.PI) / 180;
  const cos = Math.round(Math.cos(r));
  const sin = Math.round(Math.sin(r));
  return bytes(36, (v) => {
    [cos, sin, 0, -sin, cos, 0, 0, 0].forEach((x, i) => v.setInt32(i * 4, x * 65536));
    v.setInt32(32, 0x40000000); // w = 1.0 (2.30)
  });
}

/** Giây tính từ 1904-01-01 (mốc thời gian của QuickTime/MP4), khoảng năm 2024. */
const CREATED = 3_800_000_000;

export function mvhd(version: 0 | 1, timescale: number, duration: number): Uint8Array {
  const times =
    version === 1
      ? bytes(28, (v) => {
          v.setUint32(4, CREATED); // creation_time 64-bit: nửa cao = 0 tới năm 2040
          v.setUint32(12, CREATED); // modification_time
          v.setUint32(16, timescale);
          v.setUint32(20, Math.floor(duration / 2 ** 32));
          v.setUint32(24, duration >>> 0);
        })
      : bytes(16, (v) => {
          v.setUint32(0, CREATED);
          v.setUint32(4, CREATED);
          v.setUint32(8, timescale);
          v.setUint32(12, duration);
        });
  return box('mvhd', fullHeader(version), times, bytes(80, (v) => v.setUint32(76, 3)));
}

function tkhd(id: number, w: number, h: number, rotation: number) {
  return box(
    'tkhd',
    fullHeader(0),
    bytes(28, (v) => v.setUint32(8, id)),
    bytes(8, () => {}),
    matrix(rotation),
    bytes(8, (v) => {
      v.setUint32(0, w * 65536);
      v.setUint32(4, h * 65536);
    }),
  );
}

const mdhd = (timescale: number, duration: number) =>
  box('mdhd', fullHeader(0), bytes(20, (v) => (v.setUint32(8, timescale), v.setUint32(12, duration))));

function hdlr(handler: string) {
  const b = bytes(21, () => {});
  b.set(enc.encode(handler), 4);
  return box('hdlr', fullHeader(0), b);
}

const stsd = (codec: string) => box('stsd', fullHeader(0), bytes(4, (v) => v.setUint32(0, 1)), box(codec, new Uint8Array(8)));
const stsz = (count: number) => box('stsz', fullHeader(0), bytes(8, (v) => v.setUint32(4, count)));

export interface FixtureTrack {
  kind: 'video' | 'audio';
  width?: number;
  height?: number;
  rotation?: number;
}

export interface FixtureOptions {
  durationSec: number;
  mvhdVersion?: 0 | 1;
  tracks: FixtureTrack[];
  /** MOV từ QuickTime: thêm hdlr 'alis' bên trong minf. */
  quicktimeDataHandler?: boolean;
  sphericalXml?: string;
  /** Đặt mdat (toàn 0) dài chừng này byte TRƯỚC moov, như file chưa "fast start". */
  mdatFirstBytes?: number;
}

export function buildMp4(o: FixtureOptions): { blob: Blob; mvhd: Uint8Array } {
  const ts = 1000;
  const movieHeader = mvhd(o.mvhdVersion ?? 0, ts, Math.round(o.durationSec * ts));
  const traks = o.tracks.map((t, i) => {
    const video = t.kind === 'video';
    const minfParts = [
      box(video ? 'vmhd' : 'smhd', fullHeader(0), new Uint8Array(video ? 8 : 4)),
      ...(o.quicktimeDataHandler ? [hdlr('alis')] : []),
      box('stbl', stsd(video ? 'avc1' : 'mp4a'), stsz(Math.round(o.durationSec * (video ? 30 : 43)))),
    ];
    return box(
      'trak',
      tkhd(i + 1, video ? t.width ?? 1920 : 0, video ? t.height ?? 1080 : 0, t.rotation ?? 0),
      box('mdia', mdhd(ts, Math.round(o.durationSec * ts)), hdlr(video ? 'vide' : 'soun'), box('minf', ...minfParts)),
    );
  });
  const extra: Uint8Array[] = [];
  if (o.sphericalXml) {
    const uuid = Uint8Array.from([0xff, 0xcc, 0x82, 0x63, 0xf8, 0x55, 0x4a, 0x93, 0x88, 0x14, 0x58, 0x7a, 0x02, 0x52, 0x1f, 0xdd]);
    extra.push(box('uuid', uuid, enc.encode(o.sphericalXml)));
  }
  const ftyp = box('ftyp', enc.encode(o.quicktimeDataHandler ? 'qt  ' : 'isom'), new Uint8Array(4), enc.encode('isomiso2avc1mp41'));
  const moov = box('moov', movieHeader, ...traks, ...extra);
  const parts: BlobPart[] = [ftyp as BlobPart];
  if (o.mdatFirstBytes) parts.push(box('mdat', new Uint8Array(o.mdatFirstBytes)) as BlobPart, moov as BlobPart);
  else parts.push(moov as BlobPart, box('mdat', new Uint8Array(1024)) as BlobPart);
  return { blob: new Blob(parts, { type: 'video/mp4' }), mvhd: movieHeader };
}

export function gsphericalXml(o: { stereo: 'mono' | 'left-right' | 'top-bottom'; crop?: [number, number, number, number] }): string {
  const tag = (k: string, v: string | number) => `<GSpherical:${k}>${v}</GSpherical:${k}>`;
  const crop = o.crop
    ? [
        tag('CroppedAreaImageWidthPixels', o.crop[0]),
        tag('CroppedAreaImageHeightPixels', o.crop[1]),
        tag('FullPanoWidthPixels', o.crop[2]),
        tag('FullPanoHeightPixels', o.crop[3]),
        tag('CroppedAreaLeftPixels', (o.crop[2] - o.crop[0]) / 2),
        tag('CroppedAreaTopPixels', 0),
      ]
    : [];
  return `<?xml version="1.0"?><rdf:SphericalVideo xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:GSpherical="http://ns.google.com/videos/1.0/spherical/">${[
    tag('Spherical', 'true'),
    tag('Stitched', 'true'),
    tag('StitchingSoftware', 'demo'),
    tag('ProjectionType', 'equirectangular'),
    tag('StereoMode', o.stereo),
    ...crop,
  ].join('')}</rdf:SphericalVideo>`;
}
