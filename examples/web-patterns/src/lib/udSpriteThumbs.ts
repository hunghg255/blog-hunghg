/**
 * Thumbnail xem trước khi rê chuột trên thanh tua video, lấy từ MỘT ảnh sprite
 * và một file WebVTT chỉ toạ độ từng ô (ý tưởng từ sneak-peek + parseSpriteImageLink của Udemy).
 *
 *   00:00:00.000 --> 00:00:05.000
 *   sprite.jpg#xywh=0,0,160,90
 *
 * Kèm cách chia thanh tua thành các đoạn theo slide (video mashup) sao cho tổng đúng 100%.
 */

export interface ThumbCue {
  start: number;
  end: number;
  text: string;
}

export interface SpriteRef {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** "01:02:03.456" hoặc "02:03.456" → giây */
export function parseTimestamp(text: string): number {
  const parts = text.trim().split(':');
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + Number(part.replace(',', '.'));
  return seconds;
}

/** Parser WebVTT tối giản, đủ cho file thumbnail: bỏ header, NOTE, id cue. */
export function parseThumbnailVtt(text: string): ThumbCue[] {
  const cues: ThumbCue[] = [];
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex === -1) continue;
    const [from, to] = lines[timingIndex].split('-->');
    const payload = lines.slice(timingIndex + 1).join('\n').trim();
    if (!payload) continue;
    cues.push({ start: parseTimestamp(from), end: parseTimestamp(to.trim().split(/\s+/)[0]), text: payload });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/**
 * "sprite.jpg#xywh=160,0,160,90" → { src, x, y, w, h }.
 * Đúng chuẩn Media Fragments, phần sau "xywh=" có thể có tiền tố "pixel:".
 * Đường dẫn tương đối được ghép với `baseUrl` (thư mục của file VTT).
 */
export function parseSpriteRef(text: string, baseUrl = ''): SpriteRef {
  const hash = text.indexOf('#');
  const path = hash === -1 ? text : text.slice(0, hash);
  const src = /^(https?:|data:|blob:|\/)/.test(path) ? path : baseUrl + path;
  const match = hash === -1 ? null : /xywh=(?:pixel:)?(\d+),(\d+),(\d+),(\d+)/.exec(text.slice(hash + 1));
  if (!match) return { src, x: 0, y: 0, w: 0, h: 0 };
  const [x, y, w, h] = match.slice(1).map(Number);
  return { src, x, y, w, h };
}

/** Tìm cue chứa thời điểm `t` bằng tìm kiếm nhị phân (cue đã sắp theo start). */
export function findCue(cues: ThumbCue[], t: number): ThumbCue | undefined {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cue = cues[mid];
    if (t < cue.start) hi = mid - 1;
    else if (t >= cue.end) lo = mid + 1;
    else return cue;
  }
  return undefined;
}

/**
 * URL trong VTT không mang chữ ký CDN. Udemy lấy phần query (chữ ký) của URL sprite mà API
 * trả về rồi gắn vào mọi đường dẫn ảnh trong VTT.
 */
export function withSignature(src: string, signedUrl: string): string {
  const query = signedUrl.includes('?') ? signedUrl.slice(signedUrl.indexOf('?')) : '';
  if (!query) return src;
  return src.includes('?') ? `${src}&${query.slice(1)}` : src + query;
}

/** Style hiện một ô của sprite bằng background-position, không cần `clip` (đã lỗi thời). */
export function spriteStyle(ref: SpriteRef) {
  return {
    width: `${ref.w}px`,
    height: `${ref.h}px`,
    backgroundImage: `url("${ref.src}")`,
    backgroundPosition: `-${ref.x}px -${ref.y}px`,
    backgroundRepeat: 'no-repeat',
  };
}

/** Vị trí ngang của khung thumbnail: căn giữa theo chuột, kẹp trong thanh tua. */
export function tooltipLeft(mouseX: number, thumbWidth: number, barWidth: number) {
  return Math.min(Math.max(0, mouseX - thumbWidth / 2), Math.max(0, barWidth - thumbWidth));
}

/**
 * Chia thanh tua thành các đoạn theo thời điểm đổi slide, trả về % bề rộng từng đoạn.
 * Làm tròn theo VỊ TRÍ CỘNG DỒN: mép phải đoạn i = round(time[i+1] / duration · 100, decimals).
 * Sai số không dồn lại, tổng luôn đúng 100 và không đoạn nào âm.
 */
export function slideIntervals(times: number[], duration: number, decimals = 2): number[] {
  const factor = 10 ** decimals;
  const edge = (t: number) => Math.round((Math.min(Math.max(t, 0), duration) / duration) * 100 * factor) / factor;
  return times.map((t, i) => {
    const left = i === 0 ? 0 : edge(t);
    const right = i === times.length - 1 ? 100 : edge(times[i + 1]);
    return Math.round((right - left) * factor) / factor;
  });
}

/** Cách làm của Udemy để so sánh: làm tròn từng đoạn về số nguyên, đoạn cuối gánh phần dư. */
export function slideIntervalsUdemy(times: number[], duration: number): number[] {
  let last = 100;
  return times.map((_, i) => {
    let interval: number;
    if (i === times.length - 1) interval = last;
    else interval = Math.round(((times[i + 1] - times[i]) / duration) * 100);
    last -= interval;
    return interval;
  });
}
