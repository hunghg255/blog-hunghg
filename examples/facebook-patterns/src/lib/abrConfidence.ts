/**
 * Chọn bitrate (ABR) theo "độ tự tin phát" kiểu oz-player của Facebook,
 * lọc bậc quá to so với khung hình và cắt bậc đắt mà điểm MOS tăng không đáng.
 * Viết lại từ đầu.
 */

export interface MosPoint {
  /** Độ phân giải hiển thị (cạnh ngắn, kiểu 360, 720). */
  label: number;
  /** Điểm chất lượng cảm nhận 0–100 khi xem bản này ở độ phân giải đó. */
  mos: number;
}

export interface Rendition {
  id: string;
  bitrate: number;
  width: number;
  height: number;
  mos?: MosPoint[];
}

export interface ConfidenceInput {
  bitrate: number;
  bandwidth: number;
  bufferMs: number;
  /** Buffer dưới ngưỡng này thì đòi dư băng thông. */
  lowBufferMs: number;
  /** Buffer cạn hẳn thì cần bandwidth ≥ bitrate × (1 + factor). */
  lowBufferFactor: number;
  /** Có đủ ba số dưới thì phạt thêm theo thời gian tải dự kiến. */
  segmentSec?: number;
  segmentsAhead?: number;
  ttfbMs?: number | null;
  downloadPenalty?: number;
}

/** Mức tự tin khi băng thông vừa khít bitrate cần có. */
export const BASE_CONFIDENCE = 0.8;

/**
 * Tải `segmentsAhead` segment mất bao lâu so với thời lượng phát của chúng.
 * Dương: tải chậm hơn phát, buffer sẽ hụt dần.
 */
export function downloadTimeDeltaMs(bitrate: number, bandwidth: number, segmentSec: number, segmentsAhead: number, ttfbMs: number) {
  const playSec = segmentSec * segmentsAhead;
  return ((playSec * bitrate) / bandwidth) * 1000 + ttfbMs - playSec * 1000;
}

export function playbackConfidence(i: ConfidenceInput): number {
  const fill = Math.min(1, i.bufferMs / i.lowBufferMs);
  const needed = i.bitrate * (1 + (1 - fill) * i.lowBufferFactor);
  if (needed > i.bandwidth) return BASE_CONFIDENCE * (i.bandwidth / needed);
  let penalty = 0;
  if (i.segmentSec && i.segmentsAhead && i.ttfbMs != null && (i.downloadPenalty ?? 0) > 0) {
    const delta = downloadTimeDeltaMs(i.bitrate, i.bandwidth, i.segmentSec, i.segmentsAhead, i.ttfbMs);
    if (delta > 0) penalty = (delta / 1000) * i.downloadPenalty!;
  }
  return 1 - ((1 - BASE_CONFIDENCE) * needed) / i.bandwidth - penalty;
}

/** Cạnh ngắn, nhưng video rộng hơn 16:9 thì quy về chiều cao tương đương 16:9 (1920×800 → 1080). */
export function qualityLabel(width: number, height: number): number {
  if (width === 0 || height === 0) return 0;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  return long / short > 16 / 9 ? Math.round(long / (16 / 9)) : short;
}

/** "360:62,720:80" → điểm đã SẮP XẾP theo label (bản gốc tin là chuỗi đã sắp sẵn). */
export function parseMos(text: string): MosPoint[] | null {
  const points: MosPoint[] = [];
  for (const part of text.split(',')) {
    const [a, b, extra] = part.split(':');
    const label = Number(a);
    const mos = Number(b);
    if (extra !== undefined || b === undefined || Number.isNaN(label) || Number.isNaN(mos)) return null;
    points.push({ label, mos });
  }
  return points.sort((x, y) => x.label - y.label);
}

/** Nội suy tuyến tính MOS tại một độ phân giải hiển thị, kẹp vào [0, 100]. */
export function mosAt(points: MosPoint[], label: number): number {
  if (points.length === 0) return 0;
  const sorted = [...points].sort((x, y) => x.label - y.label);
  const upper = sorted.findIndex((p) => p.label > label);
  if (upper === 0) return sorted[0].mos;
  if (upper === -1) return sorted[sorted.length - 1].mos;
  const lo = sorted[upper - 1];
  const hi = sorted[upper];
  const v = lo.mos + ((label - lo.label) * (hi.mos - lo.mos)) / (hi.label - lo.label);
  return Math.min(100, Math.max(0, v));
}

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
}

/**
 * Bỏ bậc to hơn khung hình × dpr × factor. Bản gốc dùng `||` (rộng HOẶC cao vừa là giữ),
 * nên video dọc trong khung ngang giữ cả bậc 1080p. Ở đây cần cả hai chiều vừa.
 */
export function excludeLarge(list: Rendition[], vp: Viewport, factor: number, mode: 'and' | 'or' = 'and'): Rendition[] {
  if (factor === 0) return list;
  const fitsW = (r: Rendition) => r.width <= vp.width * vp.dpr * factor;
  const fitsH = (r: Rendition) => r.height <= vp.height * vp.dpr * factor;
  const kept = list.filter((r) => (mode === 'and' ? fitsW(r) && fitsH(r) : fitsW(r) || fitsH(r)));
  return kept.length ? kept : [lowest(list)];
}

const lowest = (list: Rendition[]) => list.reduce((a, b) => (b.bitrate < a.bitrate ? b : a));

/**
 * Đi từ bậc cao xuống: bậc nào MOS chỉ hơn bậc dưới ≤ ngân sách còn lại, và mạng không dư dả
 * (bandwidth / bitrate ≤ affordRatio) thì bỏ. Bậc đắt hơn mà MOS thấp hơn bậc dưới thì luôn bỏ.
 */
export function pruneExpensiveRungs(list: Rendition[], displayLabel: number, bandwidth: number, mosBudget: number, affordRatio: number) {
  const sorted = [...list].sort((a, b) => a.bitrate - b.bitrate);
  if (sorted.length < 2 || sorted.some((r) => !r.mos)) return { kept: sorted, pruned: [] as Rendition[] };
  const score = sorted.map((r) => mosAt(r.mos!, displayLabel));
  const kept: Rendition[] = [];
  const pruned: Rendition[] = [];
  let budget = mosBudget;
  for (let i = sorted.length - 1; i > 0; i--) {
    const gain = score[i] - score[i - 1];
    if (gain < 0 || (gain <= budget && bandwidth / sorted[i].bitrate <= affordRatio)) {
      if (gain >= 0) budget -= gain;
      pruned.push(sorted[i]);
      continue;
    }
    budget = mosBudget;
    kept.push(sorted[i]);
  }
  kept.push(sorted[0]);
  return { kept: kept.reverse(), pruned };
}

export interface AbrState {
  bandwidth: number;
  bufferMs: number;
  current: Rendition | null;
}

export interface AbrOptions {
  threshold: number;
  lowBufferMs: number;
  lowBufferFactor: number;
  /** Buffer từ mức này trở lên thì không hạ chất lượng (0 = tắt). */
  preventDownSwitchMs: number;
}

export interface AbrDecision {
  pick: Rendition;
  reason: 'bandwidth' | 'high_buffer' | 'fallback';
  scores: { id: string; confidence: number }[];
}

export function chooseRendition(list: Rendition[], s: AbrState, o: AbrOptions): AbrDecision {
  const scores = list.map((r) => ({
    id: r.id,
    confidence: playbackConfidence({ bitrate: r.bitrate, bandwidth: s.bandwidth, bufferMs: s.bufferMs, lowBufferMs: o.lowBufferMs, lowBufferFactor: o.lowBufferFactor }),
  }));
  let best: Rendition | null = null;
  list.forEach((r, i) => {
    if (scores[i].confidence > o.threshold && (!best || best.bitrate < r.bitrate)) best = r;
  });
  const pick: Rendition = best ?? lowest(list);
  const current = s.current && list.find((r) => r.id === s.current!.id); // bậc hiện tại phải còn trong danh sách
  if (current && o.preventDownSwitchMs > 0 && s.bufferMs >= o.preventDownSwitchMs && current.bitrate > pick.bitrate)
    return { pick: current, reason: 'high_buffer', scores };
  return { pick, reason: best ? 'bandwidth' : 'fallback', scores };
}

/**
 * Băng thông nằm sát bitrate của một bậc nào đó (trong k × độ lệch chuẩn) thì sắp phải đổi bậc:
 * chỉ tải trước ít segment để khỏi tải thừa segment của bậc sắp bỏ.
 */
export function segmentsToPrefetch(list: Rendition[], bandwidth: number, stdDev: number, k: number, normal: number, nearBoundary: number) {
  const near = list.some((r) => Math.abs(r.bitrate - bandwidth) < stdDev * k);
  return { near, count: near ? Math.min(normal, nearBoundary) : normal };
}
