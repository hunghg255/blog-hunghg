/**
 * Ước lượng băng thông kiểu oz-player (Facebook): EWMA theo half-life tính bằng giây,
 * loại outlier theo độ lệch chuẩn, trừ phạt theo độ dao động, nhớ kết quả qua phiên.
 * Viết lại từ đầu; có kèm bản "meta" mô phỏng đúng công thức gốc để demo so sánh.
 */

export interface BandwidthSample {
  bytes: number;
  ms: number;
}

export interface EstimateOptions {
  /** Half-life tính theo giây tải (mẫu tải 2 s nặng gấp đôi mẫu 1 s). Gốc: 6. */
  halfLifeSec?: number;
  /** Bỏ mẫu lệch khỏi trung bình quá factor × độ lệch chuẩn. Gốc: 2. */
  outlierFactor?: number;
  /** Trừ penalty × độ lệch chuẩn khỏi kết quả. Gốc: 0.1. */
  stdDevPenalty?: number;
  /** Kết quả không bao giờ thấp hơn floorRatio × EWMA (bản gốc có thể ra số âm). */
  floorRatio?: number;
}

export const bps = (s: BandwidthSample) => (s.bytes * 8000) / s.ms;

export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length);
}

/**
 * EWMA với trọng số liên tục: alpha = 0.5^(1/halfLife), mỗi điểm "kéo" giá trị
 * theo trọng số riêng. Chia cho (1 - alpha^tổng trọng số) để bỏ thiên lệch về 0 ở đầu chuỗi.
 */
export function ewma(points: { value: number; weight: number }[], halfLife: number): number | null {
  const alpha = Math.exp(Math.log(0.5) / halfLife);
  let estimate = 0;
  let totalWeight = 0;
  for (const p of points) {
    const keep = Math.pow(alpha, p.weight);
    estimate = p.value * (1 - keep) + estimate * keep;
    totalWeight += p.weight;
  }
  if (totalWeight <= 0) return null;
  return estimate / (1 - Math.pow(alpha, totalWeight));
}

/** Công thức gốc, giữ nguyên cả chỗ yếu: dùng để demo cho thấy NaN và số âm. */
export function metaEstimate(samples: BandwidthSample[], o: EstimateOptions = {}): number {
  const { halfLifeSec = 6, outlierFactor = 2, stdDevPenalty = 0.1 } = o;
  const rates = samples.map(bps);
  const sd = Math.round(stdDev(rates));
  const m = mean(rates);
  const kept = samples.filter((s) => Math.abs(m - bps(s)) < sd * outlierFactor); // `<`: sd = 0 thì bỏ hết
  const alpha = Math.exp(Math.log(0.5) / halfLifeSec);
  let est = 0;
  let w = 0;
  for (const s of kept) {
    const keep = Math.pow(alpha, s.ms / 1000);
    est = bps(s) * (1 - keep) + est * keep;
    w += s.ms / 1000;
  }
  return Math.round(est / (1 - Math.pow(alpha, w))) - sd * stdDevPenalty; // 0/0 = NaN khi kept rỗng
}

/** Lọc outlier bằng median + MAD: vẫn chạy được khi ít mẫu, không bị chính outlier làm phình ngưỡng. */
export function filterOutliers(samples: BandwidthSample[], factor: number): BandwidthSample[] {
  if (samples.length < 3) return samples;
  const rates = samples.map(bps);
  const med = median(rates);
  const deviations = rates.map((r) => Math.abs(r - med));
  // MAD × 1.4826 ≈ σ với phân phối chuẩn; quá nửa số mẫu trùng nhau thì MAD = 0, lùi về trung bình độ lệch
  const scale = median(deviations) * 1.4826 || mean(deviations) * 1.2533;
  if (scale === 0) return samples;
  return samples.filter((_, i) => deviations[i] <= factor * scale);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function estimateBandwidth(samples: BandwidthSample[], o: EstimateOptions = {}): number | null {
  const { halfLifeSec = 6, outlierFactor = 2, stdDevPenalty = 0.1, floorRatio = 0.5 } = o;
  const kept = filterOutliers(samples, outlierFactor);
  const raw = ewma(kept.map((s) => ({ value: bps(s), weight: s.ms / 1000 })), halfLifeSec);
  if (raw == null || !Number.isFinite(raw)) return null;
  const penalty = stdDev(kept.map(bps)) * stdDevPenalty; // độ lệch của tập ĐÃ lọc
  return Math.round(Math.max(raw - penalty, raw * floorRatio));
}

export interface BandwidthStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface EstimatorOptions extends EstimateOptions {
  maxSamples?: number;
  defaultBps?: number;
  storageKey?: string;
  /** Giá trị đã lưu quá tuổi này thì bỏ (mạng hôm qua không phải mạng hôm nay). */
  maxCacheAgeMs?: number;
  store?: BandwidthStore | null;
  now?: () => number;
}

export class BandwidthEstimator {
  private samples: BandwidthSample[] = [];
  private readonly o: Required<Omit<EstimatorOptions, 'store'>> & { store: BandwidthStore | null };

  constructor(options: EstimatorOptions = {}) {
    this.o = {
      halfLifeSec: 6,
      outlierFactor: 2,
      stdDevPenalty: 0.1,
      floorRatio: 0.5,
      maxSamples: 15,
      defaultBps: 500_000,
      storageKey: 'bandwidthEstimate',
      maxCacheAgeMs: 24 * 3600_000,
      store: safeLocalStorage(),
      now: Date.now,
      ...options,
    };
  }

  addSample(sample: BandwidthSample): void {
    if (sample.ms <= 0 || sample.bytes <= 0) return;
    this.samples.push(sample);
    if (this.samples.length > this.o.maxSamples) this.samples.shift();
  }

  getSamples(): readonly BandwidthSample[] {
    return this.samples;
  }

  /** Ước lượng hiện tại và nguồn của nó, để UI/log biết số đang dùng là đo thật hay đoán. */
  estimate(): { bps: number; source: 'samples' | 'cache' | 'default' } {
    const live = estimateBandwidth(this.samples, this.o);
    if (live != null && live > 0) return { bps: live, source: 'samples' };
    const cached = this.readCache();
    if (cached != null) return { bps: cached, source: 'cache' };
    return { bps: this.o.defaultBps, source: 'default' };
  }

  readCache(): number | null {
    const raw = this.o.store?.get(this.o.storageKey);
    if (!raw) return null;
    try {
      const { bps: value, at } = JSON.parse(raw) as { bps: number; at: number };
      if (!(value > 0) || this.o.now() - at > this.o.maxCacheAgeMs) return null;
      return value;
    } catch {
      return null;
    }
  }

  /** Chỉ lưu khi có số đo thật: không ghi lại giá trị cache/mặc định, tránh vòng lặp tự củng cố. */
  persist(): boolean {
    const live = estimateBandwidth(this.samples, this.o);
    if (live == null || live <= 0) return false;
    this.o.store?.set(this.o.storageKey, JSON.stringify({ bps: live, at: this.o.now() }));
    return true;
  }

  /** pagehide + visibilitychange thay cho unload (unload không chạy trên mobile, chặn bfcache). */
  persistOnHide(target: Window = window): () => void {
    const onHide = () => void this.persist();
    const onVisibility = () => document.visibilityState === 'hidden' && this.persist();
    target.addEventListener('pagehide', onHide);
    target.document.addEventListener('visibilitychange', onVisibility);
    return () => {
      target.removeEventListener('pagehide', onHide);
      target.document.removeEventListener('visibilitychange', onVisibility);
    };
  }
}

function safeLocalStorage(): BandwidthStore | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) };
  } catch {
    return null;
  }
}

/**
 * TransformStream đếm byte đi qua và báo một mẫu mỗi khi đủ bytesPerSample.
 * Mẫu dùng số byte CỦA MẪU (không phải byte cộng dồn) khi kiểm tra mẫu vô lý.
 */
export function createBandwidthMeter(
  onSample: (s: BandwidthSample) => void,
  { bytesPerSample = 20_000, maxBps = 1e9, now = () => performance.now() } = {},
): TransformStream<Uint8Array, Uint8Array> {
  let start = now();
  let pending = 0;
  const emit = () => {
    const t = now();
    const ms = t - start;
    if (ms > 0 && (pending * 8000) / ms <= maxBps) onSample({ bytes: pending, ms });
    start = t;
    pending = 0;
  };
  return new TransformStream({
    transform(chunk, controller) {
      pending += chunk.byteLength;
      if (pending >= bytesPerSample) emit();
      controller.enqueue(chunk);
    },
    flush() {
      if (pending > 0) emit();
    },
  });
}

/**
 * Cổng chặn autoplay bất đối xứng: bị chặn hay không xét theo EWMA chậm,
 * lần trước đã bị chặn thì đọc EWMA nhanh để mở lại sớm khi mạng hồi phục (cùng một ngưỡng).
 */
export class AutoplayGate {
  restrained = false;
  constructor(private readonly thresholdBps = 123_034) {}

  update(slowBps: number | null, fastBps: number | null): boolean {
    const value = this.restrained ? fastBps ?? slowBps : slowBps;
    this.restrained = value != null && value < this.thresholdBps;
    return this.restrained;
  }
}
