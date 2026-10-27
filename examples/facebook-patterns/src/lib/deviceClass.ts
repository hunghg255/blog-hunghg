/**
 * Thu thông tin phần cứng + tốc độ mạng/đĩa đo được từ Resource Timing để đoán "hạng" thiết bị.
 *
 * Ý tưởng từ WebDevicePerfInfoLogging của Facebook. Ở FB client chỉ thu số liệu, còn việc
 * xếp hạng do server làm (XDeviceClassRealtimeController trả về devicePerfClassLevel).
 * Hàm classifyDevice() bên dưới là ngưỡng của bản viết lại.
 */

export interface DeviceInfo {
  cpuCores?: number;
  /** GB, đã được trình duyệt làm tròn (0.25, 0.5, 1, 2, 4, 8…) */
  ramGb?: number;
  gpuVendor?: string;
  gpuRenderer?: string;
  /** bytes/ms đọc từ cache (transferSize = 0) */
  cachedSpeed?: number;
  cachedFiles?: number;
  /** bytes/ms tải qua mạng */
  networkSpeed?: number;
  networkFiles?: number;
  skippedHidden?: number;
}

export function readHardware(): Pick<DeviceInfo, 'cpuCores' | 'ramGb'> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    cpuCores: nav.hardwareConcurrency || undefined,
    ramGb: nav.deviceMemory, // chỉ có trên trình duyệt nhân Chromium
  };
}

/** Tên GPU thật qua extension WEBGL_debug_renderer_info (một số trình duyệt trả về chuỗi đã che bớt). */
export function readGpu(): Pick<DeviceInfo, 'gpuVendor' | 'gpuRenderer'> {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return {};
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return {};
    const result = {
      gpuVendor: String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)),
      gpuRenderer: String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)),
    };
    // trả context lại ngay, trình duyệt giới hạn số WebGL context sống cùng lúc
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return result;
  } catch {
    return {};
  }
}

/** Khoảng thời gian tab bị ẩn, đo trên cùng trục thời gian với performance.now(). */
export function createHiddenTimeline() {
  const changes: Array<{ at: number; hidden: boolean }> = [{ at: 0, hidden: document.hidden }];
  const onChange = () => changes.push({ at: performance.now(), hidden: document.hidden });
  document.addEventListener('visibilitychange', onChange);
  return {
    /** số ms tab bị ẩn trong khoảng [start, end] */
    hiddenTime(start: number, end: number): number {
      let total = 0;
      for (let i = 0; i < changes.length; i++) {
        if (!changes[i].hidden) continue;
        const from = Math.max(start, changes[i].at);
        const to = Math.min(end, i + 1 < changes.length ? changes[i + 1].at : Infinity);
        if (to > from) total += to - from;
      }
      return total;
    },
    destroy: () => document.removeEventListener('visibilitychange', onChange),
  };
}

export interface ResourceSample {
  name: string;
  transferSize: number;
  encodedBodySize: number;
  responseStart: number;
  responseEnd: number;
  startTime: number;
}

/**
 * Tốc độ đọc cache và tốc độ mạng từ các resource đã tải.
 * - transferSize === 0 && encodedBodySize > 0: lấy từ cache → đo tốc độ đọc đĩa.
 * - transferSize >= encodedBodySize: tải qua mạng (transferSize có cả header nên thường lớn hơn).
 * - còn lại (transferSize < encodedBodySize): bỏ, không rõ nguồn.
 * Bỏ resource tải trong lúc tab bị ẩn: trình duyệt giảm ưu tiên tab nền nên số đo sai lệch.
 *
 * Khác bản gốc: FB gọi getHiddenTime(entry.startTime, entry.responseEnd) với thời gian TƯƠNG ĐỐI,
 * trong khi các mốc ẩn/hiện của nó lưu theo epoch (Date.now), nên phép lọc có lẽ không bao giờ
 * loại được resource nào. Ở đây mọi mốc cùng trục performance.now(). Ngoài ra resource khác
 * origin không có Timing-Allow-Origin có cả transferSize lẫn encodedBodySize bằng 0, FB vẫn
 * tính là "cache" với tốc độ 0; bản này bỏ chúng.
 */
export function measureResourceSpeed(
  entries: ResourceSample[],
  hiddenTime: (start: number, end: number) => number = () => 0,
): Pick<DeviceInfo, 'cachedSpeed' | 'cachedFiles' | 'networkSpeed' | 'networkFiles' | 'skippedHidden'> {
  let cachedSum = 0;
  let cachedFiles = 0;
  let networkSum = 0;
  let networkFiles = 0;
  let skippedHidden = 0;
  for (const e of entries) {
    if (e.encodedBodySize === 0) continue; // không đo được (opaque, rỗng, hoặc thiếu Timing-Allow-Origin)
    const duration = e.responseEnd - e.responseStart;
    if (duration <= 0) continue; // tránh chia cho 0 → Infinity
    if (hiddenTime(e.startTime, e.responseEnd) > 0) {
      skippedHidden++;
      continue;
    }
    if (e.transferSize === 0) {
      cachedSum += e.encodedBodySize / duration;
      cachedFiles++;
    } else if (e.transferSize >= e.encodedBodySize) {
      networkSum += e.transferSize / duration;
      networkFiles++;
    }
  }
  return {
    cachedSpeed: cachedFiles ? cachedSum / cachedFiles : undefined,
    cachedFiles,
    networkSpeed: networkFiles ? networkSum / networkFiles : undefined,
    networkFiles,
    skippedHidden,
  };
}

export type DeviceTier = 'low' | 'mid' | 'high' | 'unknown';

/** Ngưỡng của bản viết lại: ưu tiên RAM và số nhân, không có dữ liệu thì "unknown". */
export function classifyDevice(info: DeviceInfo): DeviceTier {
  const { cpuCores, ramGb } = info;
  if (cpuCores == null && ramGb == null) return 'unknown';
  if ((ramGb != null && ramGb <= 2) || (cpuCores != null && cpuCores <= 2)) return 'low';
  if ((ramGb != null && ramGb >= 8) && (cpuCores == null || cpuCores >= 8)) return 'high';
  if (ramGb == null && cpuCores != null && cpuCores >= 8) return 'high';
  return 'mid';
}
