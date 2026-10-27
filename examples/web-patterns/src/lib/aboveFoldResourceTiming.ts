/**
 * Tách thời gian tải một request thành DNS / kết nối / TLS / chờ server / tải nội dung
 * (ý tưởng từ bestbuy.ca: client/utils/analytics/performanceInstrumentation.ts).
 */

export interface ResourceBreakdown {
  url: string;
  /** tổng thời gian request, luôn có */
  total: number;
  /** false: request khác origin không có Timing-Allow-Origin, các mốc chi tiết đều bằng 0 */
  detailed: boolean;
  dns?: number;
  connect?: number;
  tls?: number;
  waiting?: number;
  download?: number;
}

export function breakdown(entry: PerformanceResourceTiming): ResourceBreakdown {
  const base = { url: entry.name, total: entry.duration };
  // Không có Timing-Allow-Origin: domainLookupStart, connectStart, requestStart, responseStart... đều là 0.
  // responseEnd thì vẫn có. Lấy responseEnd - responseStart lúc này ra một số rất lớn (tính từ lúc mở trang).
  if (entry.responseStart === 0) return { ...base, detailed: false };
  return {
    ...base,
    detailed: true,
    dns: entry.domainLookupEnd - entry.domainLookupStart,
    connect: entry.connectEnd - entry.connectStart,
    // secureConnectionStart = 0 khi không dùng HTTPS hoặc dùng lại kết nối cũ
    tls: entry.secureConnectionStart > 0 ? entry.connectEnd - entry.secureConnectionStart : 0,
    waiting: entry.responseStart - entry.requestStart,
    download: entry.responseEnd - entry.responseStart,
  };
}

/** Lấy entry MỚI NHẤT của một URL (cùng URL gọi nhiều lần sẽ có nhiều entry). */
export function latestEntry(url: string) {
  const entries = performance.getEntriesByName(url, 'resource') as PerformanceResourceTiming[];
  return entries[entries.length - 1];
}
