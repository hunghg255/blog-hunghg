/**
 * Ba mẹo dò tính năng bằng cách "hỏi thẳng trình duyệt" thay vì đọc User-Agent:
 * 1. Ảnh JPEG 2×1 có EXIF Orientation = 6: trình duyệt tự xoay thì ảnh thành 1×2.
 * 2. Getter bẫy: truyền object có getter, nếu API đọc thuộc tính đó thì nó hiểu tuỳ chọn.
 * 3. Div ẩn overflow:scroll: offset − client = độ dày thanh cuộn.
 * Ý tưởng từ ImageUtils, UserTimingUtils, FBScrollbarsUtils (Facebook), viết lại từ đầu.
 */

// ---------- 1. EXIF Orientation ----------

/** Segment APP1 "Exif" tối thiểu: TIFF little-endian, IFD0 có đúng một tag 0x0112. */
export function exifApp1(orientation: number): Uint8Array {
  const tiff = [
    0x49, 0x49, 0x2a, 0x00, // "II", 42
    0x08, 0x00, 0x00, 0x00, // IFD0 ở offset 8
    0x01, 0x00, // 1 entry
    0x12, 0x01, 0x03, 0x00, // tag 0x0112 Orientation, kiểu SHORT
    0x01, 0x00, 0x00, 0x00, // count = 1
    orientation & 0xff, 0x00, 0x00, 0x00, // giá trị nằm ngay trong entry
    0x00, 0x00, 0x00, 0x00, // không có IFD tiếp theo
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0"
  const len = payload.length + 2; // độ dài tính cả 2 byte độ dài
  return Uint8Array.from([0xff, 0xe1, len >> 8, len & 0xff, ...payload]);
}

interface Segment {
  marker: number;
  start: number;
  end: number;
}

/** Duyệt các segment đầu file JPEG tới SOS (0xFFDA). */
function* segments(jpeg: Uint8Array): Generator<Segment> {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Không phải JPEG');
  let i = 2;
  while (i + 4 <= jpeg.length && jpeg[i] === 0xff) {
    const marker = jpeg[i + 1];
    if (marker === 0xda) return;
    const len = (jpeg[i + 2] << 8) | jpeg[i + 3];
    yield { marker, start: i, end: i + 2 + len };
    i += 2 + len;
  }
}

const isExif = (jpeg: Uint8Array, s: Segment) =>
  s.marker === 0xe1 && String.fromCharCode(...jpeg.subarray(s.start + 4, s.start + 8)) === 'Exif';

/** Chèn (hoặc thay) EXIF Orientation; đặt sau APP0/JFIF nếu có, như ảnh probe của Facebook. */
export function withOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  const segs = [...segments(jpeg)];
  const old = segs.find((s) => isExif(jpeg, s));
  const app0 = segs[0]?.marker === 0xe0 ? segs[0] : null;
  const at = app0 ? app0.end : 2;
  const head = jpeg.subarray(0, at);
  let tail = jpeg.subarray(at);
  if (old) tail = concat(jpeg.subarray(at, old.start), jpeg.subarray(old.end));
  return concat(head, exifApp1(orientation), tail);
}

/** Đọc Orientation (1–8) từ EXIF, null nếu không có. Hỗ trợ cả "II" và "MM". */
export function readOrientation(jpeg: Uint8Array): number | null {
  for (const s of segments(jpeg)) {
    if (!isExif(jpeg, s)) continue;
    const t = s.start + 10; // đầu TIFF
    const le = jpeg[t] === 0x49;
    const u16 = (o: number) => (le ? jpeg[o] | (jpeg[o + 1] << 8) : (jpeg[o] << 8) | jpeg[o + 1]);
    const u32 = (o: number) => (le ? u16(o) + u16(o + 2) * 65536 : u16(o) * 65536 + u16(o + 2));
    const ifd = t + u32(t + 4);
    const count = u16(ifd);
    for (let k = 0; k < count; k++) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > s.end) break;
      if (u16(e) === 0x0112) return u16(e + 8);
    }
  }
  return null;
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function toDataUri(bytes: Uint8Array, mime = 'image/jpeg') {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:${mime};base64,${btoa(bin)}`;
}

/** Vẽ lên canvas rồi xuất JPEG; dùng để sinh ảnh probe ngay trên trang. */
export async function canvasJpeg(width: number, height: number, paint?: (ctx: CanvasRenderingContext2D) => void): Promise<Uint8Array> {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  paint?.(ctx);
  const blob = await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('toBlob lỗi'))), 'image/jpeg', 0.9));
  return new Uint8Array(await blob.arrayBuffer());
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error('Ảnh không tải được'));
    img.src = src;
  });
}

let autoRotate: Promise<boolean> | null = null;

/**
 * Trình duyệt có tự xoay ảnh theo EXIF khi hiển thị không?
 * Single-flight: nhiều lời gọi cùng lúc dùng chung một lần tải; lỗi thì không nhớ, lần sau thử lại.
 */
export function browserAutoRotates(): Promise<boolean> {
  autoRotate ??= (async () => {
    const jpeg = withOrientation(await canvasJpeg(2, 1), 6);
    const img = await loadImage(toDataUri(jpeg));
    return img.naturalWidth === 1; // 2×1 xoay 90° thành 1×2
  })().catch((e) => {
    autoRotate = null;
    throw e;
  });
  return autoRotate;
}

// ---------- 2. Getter bẫy ----------

/** API có đọc thuộc tính `key` của object tuỳ chọn không? Lỗi ném ra được nuốt. */
export function readsOption(call: (options: object) => void, key: string): boolean {
  let read = false;
  const options = Object.defineProperty({}, key, {
    get() {
      read = true;
      return undefined;
    },
    enumerable: true,
  });
  try {
    call(options);
  } catch {
    /* API cũ có thể ném lỗi với object lạ, coi như không hỗ trợ */
  }
  return read;
}

/** User Timing Level 3: mark/measure nhận object tuỳ chọn (startTime, detail…). */
export function supportsMarkOptions(): boolean {
  if (typeof PerformanceMark !== 'function') return false;
  // constructor không thêm mark vào timeline nên không có gì phải dọn
  return readsOption((o) => new PerformanceMark('__probe_l3', o as PerformanceMarkOptions), 'startTime');
}

/** Event listener có hiểu { passive } không (mẹo kinh điển cùng họ). */
export function supportsPassive(): boolean {
  const noop = () => {};
  return readsOption((o) => {
    window.addEventListener('__probe', noop, o as AddEventListenerOptions);
    window.removeEventListener('__probe', noop, o as EventListenerOptions);
  }, 'passive');
}

// ---------- 3. Thanh cuộn ----------

export interface ScrollbarSize {
  width: number;
  height: number;
}

/** Độ dày thanh cuộn (px). null khi chưa có body: đừng kết luận khi chưa đo được. */
export function measureScrollbar(doc: Document = document, className = ''): ScrollbarSize | null {
  const body = doc.body;
  if (!body) return null;
  const el = doc.createElement('div');
  el.className = className;
  Object.assign(el.style, { position: 'absolute', top: '-9999px', width: '100px', height: '100px', overflow: 'scroll', visibility: 'hidden' });
  body.appendChild(el);
  const size = { width: el.offsetWidth - el.clientWidth, height: el.offsetHeight - el.clientHeight };
  el.remove();
  return size;
}

/** Nhớ kết quả, nhưng chỉ nhớ khi đo được (khác `once`), và cho phép đo lại. */
export function cachedProbe<T>(probe: () => T | null) {
  let value: T | null = null;
  return {
    get(): T | null {
      if (value === null) value = probe();
      return value;
    },
    invalidate() {
      value = null;
    },
  };
}

/**
 * Một ResizeObserver dùng chung cho nhiều listener trên cùng phần tử.
 * Gỡ listener nào thì chỉ listener đó mất; chỉ unobserve khi phần tử hết listener.
 */
export function createResizeHub() {
  const listeners = new Map<Element, Map<string, () => void>>();
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) listeners.get(e.target)?.forEach((cb) => cb());
  });
  return {
    observe(el: Element, key: string, cb: () => void) {
      let byKey = listeners.get(el);
      if (!byKey) {
        byKey = new Map();
        listeners.set(el, byKey);
        ro.observe(el);
      }
      byKey.set(key, cb);
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        const m = listeners.get(el);
        if (m?.get(key) !== cb) return;
        m.delete(key);
        if (m.size === 0) {
          listeners.delete(el);
          ro.unobserve(el);
        }
      };
    },
    get size() {
      let n = 0;
      listeners.forEach((m) => (n += m.size));
      return n;
    },
    disconnect() {
      ro.disconnect();
      listeners.clear();
    },
  };
}
