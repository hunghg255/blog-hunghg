/**
 * Mấy "mẹo vặt" quanh thẻ <video> mà player của Udemy phải tự lo:
 * - đo băng thông cao nhất (high-watermark) chỉ bằng bộ đếm byte đã giải mã của trình duyệt
 * - forcePlay: ép trình duyệt tải đủ dữ liệu bằng cách phát ở chế độ tắt tiếng rồi trả lại trạng thái cũ
 * - nhận ra iPad chạy iPadOS 13+ (Safari báo mình là Mac)
 *
 * Ý tưởng từ `video-player/videojs-setup/bandwidth-watermark.js`, `watermark.js`,
 * `udemy-patches.js` và `video-player/utils.js` của Udemy, viết lại từ đầu.
 */

// ---------------------------------------------------------------------------
// 1. High-watermark

/** Giữ tốc độ cao nhất từng thấy của một bộ đếm tăng dần (bytes, ms…). */
export class Watermark {
  highest = 0;
  private lastTotal: number | null = null;

  /**
   * @param total giá trị cộng dồn hiện tại của bộ đếm
   * @param seconds số giây kể từ lần đo trước
   * @returns tốc độ của mẫu này, hoặc null nếu bỏ qua
   */
  add(total: number | undefined, seconds: number): number | null {
    // Bản gốc không kiểm tra: một lần `undefined` (trình duyệt không có bộ đếm) biến
    // lastTotal thành NaN và mọi mẫu sau đó đều NaN — watermark kẹt ở 0 mãi.
    if (total == null || !Number.isFinite(total) || seconds <= 0) return null;
    if (this.lastTotal === null || total < this.lastTotal) {
      // mẫu đầu, hoặc bộ đếm bị reset (đổi nguồn video): chỉ ghi mốc
      this.lastTotal = total;
      return null;
    }
    const rate = (total - this.lastTotal) / seconds;
    this.lastTotal = total;
    if (rate > this.highest) this.highest = rate;
    return rate;
  }
}

type DecodedCounters = HTMLVideoElement & {
  webkitAudioDecodedByteCount?: number;
  webkitVideoDecodedByteCount?: number;
};

/**
 * Tổng byte audio + video trình duyệt đã giải mã (thuộc tính có tiền tố webkit, có trên Chromium
 * và Safari). Trả undefined nếu không hỗ trợ, thay vì NaN.
 */
export function decodedBytes(video: HTMLVideoElement): number | undefined {
  const v = video as DecodedCounters;
  if (typeof v.webkitVideoDecodedByteCount !== 'number') return undefined;
  return v.webkitVideoDecodedByteCount + (v.webkitAudioDecodedByteCount ?? 0);
}

/**
 * Số mili-giây media đã được buffer (cộng các khoảng trong `video.buffered`).
 * Chia cho thời gian thực sẽ ra "tải nhanh gấp mấy lần tốc độ phát".
 */
export function bufferedMillis(video: HTMLVideoElement): number {
  let total = 0;
  for (let i = 0; i < video.buffered.length; i++) total += video.buffered.end(i) - video.buffered.start(i);
  return total * 1000;
}

export interface BandwidthSample {
  decoderBytesPerSec: number | null;
  bufferedMsPerSec: number | null;
  highest: { decoderBytesPerSec: number; bufferedMsPerSec: number };
}

/** Lấy mẫu mỗi `intervalMs`, báo kết quả qua `onSample`. Trả hàm dừng. */
export function watchBandwidth(
  video: HTMLVideoElement,
  onSample: (sample: BandwidthSample) => void,
  {
    intervalMs = 1000,
    readBytes = decodedBytes,
    now = () => performance.now(),
  }: { intervalMs?: number; readBytes?: (v: HTMLVideoElement) => number | undefined; now?: () => number } = {},
) {
  const decoder = new Watermark();
  const buffered = new Watermark();
  let last = now();
  decoder.add(readBytes(video), 1);
  buffered.add(bufferedMillis(video), 1);
  const id = setInterval(() => {
    const t = now();
    const seconds = (t - last) / 1000;
    last = t;
    onSample({
      decoderBytesPerSec: decoder.add(readBytes(video), seconds),
      bufferedMsPerSec: buffered.add(bufferedMillis(video), seconds),
      highest: { decoderBytesPerSec: decoder.highest, bufferedMsPerSec: buffered.highest },
    });
  }, intervalMs);
  return () => clearInterval(id);
}

// ---------------------------------------------------------------------------
// 2. forcePlay

export interface ForcePlayOptions {
  /** chờ tối đa bao lâu (ms), mặc định 10 giây */
  timeoutMs?: number;
  /** readyState cần đạt, mặc định HAVE_ENOUGH_DATA (4) */
  readyState?: number;
}

export type ForcePlayResult = 'ready' | 'timeout' | 'blocked';

const pendingForcePlay = new WeakMap<HTMLVideoElement, Promise<ForcePlayResult>>();

/**
 * Ép trình duyệt tải đủ dữ liệu: tắt tiếng → play() → chờ readyState đủ → trả lại trạng
 * thái tắt tiếng / dừng ban đầu. Nhiều trình duyệt không tải trước nếu chưa phát, và chỉ
 * cho tự phát khi tắt tiếng.
 *
 * Khác bản gốc:
 * - nghe sự kiện thay vì poll mỗi 100ms tối đa 100 lần;
 * - promise được xoá khi xong, gọi lần sau vẫn chạy (bản gốc giữ promise đã resolve mãi,
 *   nên chỉ có tác dụng một lần trong đời player);
 * - play() bị từ chối (kể cả khi đã tắt tiếng) thì trả 'blocked' thay vì nuốt lỗi.
 */
export function forcePlay(video: HTMLVideoElement, { timeoutMs = 10_000, readyState = 4 }: ForcePlayOptions = {}) {
  const pending = pendingForcePlay.get(video);
  if (pending) return pending;

  const wasMuted = video.muted;
  const wasPaused = video.paused;

  const promise = new Promise<ForcePlayResult>((resolve) => {
    let done = false;
    const finish = (result: ForcePlayResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener('canplaythrough', check);
      video.removeEventListener('canplay', check);
      video.removeEventListener('loadeddata', check);
      if (wasPaused) video.pause();
      video.muted = wasMuted;
      resolve(result);
    };
    const check = () => {
      if (video.readyState >= readyState) finish('ready');
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    video.addEventListener('canplaythrough', check);
    video.addEventListener('canplay', check);
    video.addEventListener('loadeddata', check);

    video.muted = true;
    Promise.resolve(video.play()).then(check, () => finish('blocked'));
  }).finally(() => pendingForcePlay.delete(video));

  pendingForcePlay.set(video, promise);
  return promise;
}

/**
 * Tua về 0: player của Udemy đổi 0 thành 0.1 vì có trình duyệt bỏ qua lệnh tua về đúng 0
 * (có lẽ khi đang ở rất gần 0). Đổi lại, người dùng mất 100ms đầu mỗi lần tua về đầu.
 */
export const safeSeekTime = (time: number, nudge = 0.1) => (time === 0 ? nudge : time);

// ---------------------------------------------------------------------------
// 3. Nền tảng

export interface PlatformInput {
  userAgent: string;
  /** navigator.platform, vd 'MacIntel', 'iPhone' */
  platform: string;
  maxTouchPoints: number;
}

export interface Platform {
  os: 'iOS' | 'iPadOS' | 'macOS' | 'Android' | 'Windows' | 'other';
  /** phiên bản hệ điều hành, undefined nếu không tin được */
  version?: string;
  isTablet: boolean;
  isMobile: boolean;
  /** true khi UA là của Mac nhưng máy thật là iPad */
  spoofedDesktopUA: boolean;
}

const versionFrom = (ua: string, re: RegExp) => ua.match(re)?.[1]?.replace(/_/g, '.');

/**
 * Từ iPadOS 13, Safari trên iPad mặc định gửi UA của Mac. Dấu hiệu còn lại: platform vẫn là
 * 'MacIntel' nhưng có màn hình cảm ứng nhiều điểm (Mac không có).
 */
export function detectPlatform({ userAgent, platform, maxTouchPoints }: PlatformInput): Platform {
  if (/iPhone|iPod/.test(userAgent)) {
    return { os: 'iOS', version: versionFrom(userAgent, /OS (\d+[_\d]*)/), isTablet: false, isMobile: true, spoofedDesktopUA: false };
  }
  if (/iPad/.test(userAgent)) {
    return { os: 'iPadOS', version: versionFrom(userAgent, /OS (\d+[_\d]*)/), isTablet: true, isMobile: false, spoofedDesktopUA: false };
  }
  if (/Mac OS X/.test(userAgent)) {
    if (platform === 'MacIntel' && maxTouchPoints > 1) {
      // Phiên bản trong UA là của macOS giả (thường 10.15.7), không phải iPadOS: bỏ đi.
      return { os: 'iPadOS', version: undefined, isTablet: true, isMobile: false, spoofedDesktopUA: true };
    }
    return { os: 'macOS', version: versionFrom(userAgent, /Mac OS X (\d+[_.\d]*)/), isTablet: false, isMobile: false, spoofedDesktopUA: false };
  }
  if (/Android/.test(userAgent)) {
    const isMobile = /Mobile/.test(userAgent);
    return { os: 'Android', version: versionFrom(userAgent, /Android (\d+[.\d]*)/), isTablet: !isMobile, isMobile, spoofedDesktopUA: false };
  }
  if (/Windows/.test(userAgent)) return { os: 'Windows', isTablet: false, isMobile: false, spoofedDesktopUA: false };
  return { os: 'other', isTablet: false, isMobile: false, spoofedDesktopUA: false };
}
