/**
 * Mini QPL (Quick Performance Logger) theo ý tưởng QuickPerformanceLoggerCore của Facebook:
 *
 * - "Marker" đo một đoạn thời gian: markerStart(id, instanceKey) … markerEnd(id, action, instanceKey).
 *   instanceKey cho phép đo nhiều phiên cùng loại song song (vd mỗi tin nhắn đang gửi một marker).
 * - Lấy mẫu 1/N quyết định NGAY lúc start. Marker không trúng mẫu thì không lưu gì,
 *   point/annotation/end sau đó gần như không tốn gì.
 * - trackedForLoss: lúc start gửi thêm một event riêng; server so số start với số end
 *   để biết bao nhiêu phần trăm phép đo bị rơi (tab đóng, crash, lỗi code).
 * - Annotation có kiểu (string/int/double/bool), int bị cắt phần thập phân.
 */

export type QplAction = 'SUCCESS' | 'FAIL' | 'CANCEL' | 'TIMEOUT';

export interface QplPoint {
  name: string;
  timeSinceStart: number;
}

export interface QplAnnotations {
  string?: Record<string, string>;
  int?: Record<string, number>;
  double?: Record<string, number>;
  bool?: Record<string, boolean>;
}

export interface QplEvent {
  kind: 'marker' | 'loss-start';
  markerId: number;
  instanceKey: string | number;
  action?: QplAction;
  /** thời lượng (ms) */
  value?: number;
  sampleRate: number;
  points?: QplPoint[];
  annotations?: QplAnnotations;
}

interface ActiveMarker {
  start: number;
  sampleRate: number;
  points: QplPoint[];
  annotations: QplAnnotations;
  trackedForLoss: boolean;
}

export interface QplOptions {
  /** N trong "1/N"; 0 = tắt, 1 = luôn đo */
  sampleRate: (markerId: number) => number;
  send: (event: QplEvent) => void;
  now?: () => number;
  random?: () => number;
}

export function createQpl({ sampleRate, send, now = () => performance.now(), random = Math.random }: QplOptions) {
  const active = new Map<number, Map<string | number, ActiveMarker>>();

  const get = (markerId: number, key: string | number) => active.get(markerId)?.get(key);
  const remove = (markerId: number, key: string | number) => {
    const byKey = active.get(markerId);
    byKey?.delete(key);
    if (byKey && byKey.size === 0) active.delete(markerId);
  };

  return {
    markerStart(
      markerId: number,
      instanceKey: string | number = 0,
      { timestamp = now(), trackedForLoss = false }: { timestamp?: number; trackedForLoss?: boolean } = {},
    ) {
      const rate = sampleRate(markerId);
      // xác suất 1/rate; rate ≤ 1 nghĩa là luôn đo
      const sampled = rate !== 0 && (rate <= 1 || random() * rate <= 1);
      if (!sampled) return false;
      if (!active.has(markerId)) active.set(markerId, new Map());
      active.get(markerId)!.set(instanceKey, {
        start: timestamp,
        sampleRate: rate,
        points: [],
        annotations: {},
        trackedForLoss,
      });
      if (trackedForLoss) send({ kind: 'loss-start', markerId, instanceKey, sampleRate: rate });
      return true;
    },

    markerPoint(markerId: number, name: string, instanceKey: string | number = 0, timestamp = now()) {
      const marker = get(markerId, instanceKey);
      if (!marker) return;
      // point trùng tên chỉ giữ lần đầu (giống bản gốc)
      if (marker.points.some((p) => p.name === name)) return;
      marker.points.push({ name, timeSinceStart: Math.trunc(timestamp - marker.start) });
    },

    markerAnnotate(markerId: number, annotations: QplAnnotations, instanceKey: string | number = 0) {
      const marker = get(markerId, instanceKey);
      if (!marker) return;
      const int = annotations.int && Object.fromEntries(Object.entries(annotations.int).map(([k, v]) => [k, Math.trunc(v)]));
      marker.annotations = {
        string: { ...marker.annotations.string, ...annotations.string },
        int: { ...marker.annotations.int, ...int },
        double: { ...marker.annotations.double, ...annotations.double },
        bool: { ...marker.annotations.bool, ...annotations.bool },
      };
    },

    markerEnd(markerId: number, action: QplAction, instanceKey: string | number = 0, timestamp = now()) {
      const marker = get(markerId, instanceKey);
      if (!marker) return undefined; // không trúng mẫu, hoặc đã kết thúc rồi
      remove(markerId, instanceKey);
      const value = Math.round(timestamp - marker.start);
      send({
        kind: 'marker',
        markerId,
        instanceKey,
        action,
        value,
        sampleRate: marker.sampleRate,
        points: marker.points,
        annotations: marker.annotations,
      });
      return value;
    },

    markerDrop(markerId: number, instanceKey: string | number = 0) {
      remove(markerId, instanceKey);
    },

    /**
     * Bổ sung so với bản gốc: kết thúc các marker treo quá lâu bằng TIMEOUT.
     * Bản gốc không có bước này nên marker không bao giờ end sẽ nằm mãi trong bộ nhớ.
     */
    sweep(maxAgeMs: number, timestamp = now()) {
      let swept = 0;
      for (const [markerId, byKey] of [...active]) {
        for (const [key, marker] of [...byKey]) {
          if (timestamp - marker.start > maxAgeMs) {
            this.markerEnd(markerId, 'TIMEOUT', key, timestamp);
            swept++;
          }
        }
      }
      return swept;
    },

    get activeCount() {
      let n = 0;
      for (const byKey of active.values()) n += byKey.size;
      return n;
    },
  };
}

export type Qpl = ReturnType<typeof createQpl>;

export const SEND_MESSAGE = 25_100_001;

/**
 * Đo RTT gửi tin đầu-cuối: start khi bấm gửi, end khi tin của chính mình dội về qua sync.
 * Hai đầu khớp nhau nhờ cùng instanceKey là OTID của tin.
 *
 * Mấu chốt: chụp timestamp ĐỒNG BỘ tại lúc sự kiện xảy ra, rồi mới làm việc async.
 */
export function createSendRttTracker(qpl: Qpl, now: () => number = () => performance.now()) {
  return {
    onSend(otid: string) {
      return qpl.markerStart(SEND_MESSAGE, otid, { timestamp: now(), trackedForLoss: true });
    },
    onEcho(otid: string) {
      return qpl.markerEnd(SEND_MESSAGE, 'SUCCESS', otid, now());
    },
    onError(otid: string) {
      return qpl.markerEnd(SEND_MESSAGE, 'FAIL', otid, now());
    },
  };
}
