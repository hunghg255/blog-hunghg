import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Đồng hồ dùng chung cho mọi countdown/banner theo lịch, có "du hành thời gian" cho QA.
 * Ý tưởng từ Best Buy Canada: countdownHook + window.globalDateOffset + widget DateOverride
 * (bật bằng ?contentProofing=true). Mọi chỗ cần "bây giờ" đều đi qua MỘT offset.
 */

type Listener = () => void;

export interface Clock {
  /** thời điểm "hiện tại" theo đồng hồ này (ms) = giờ thật + offset */
  now(): number;
  /** độ lệch so với giờ thật (ms); dương = đang ở tương lai */
  getOffset(): number;
  /** QA: xem trang như thể đang ở thời điểm `date` */
  travelTo(date: Date | number): void;
  travelBy(ms: number): void;
  reset(): void;
  subscribe(listener: Listener): () => void;
}

export function createClock(initialOffset = 0): Clock {
  let offset = initialOffset;
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l());
  return {
    now: () => Date.now() + offset,
    getOffset: () => offset,
    travelTo(date) {
      offset = +date - Date.now();
      emit();
    },
    travelBy(ms) {
      offset += ms;
      emit();
    },
    reset() {
      offset = 0;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Đọc offset từ URL, CHỈ khi có cờ QA: ?qaNow=2026-11-28T09:00. Không có cờ thì offset = 0.
 * Đây là công cụ xem trước nội dung, không phải bảo mật: server vẫn phải tự kiểm tra giờ.
 */
export function offsetFromUrl(search = typeof location === 'undefined' ? '' : location.search): number {
  const value = new URLSearchParams(search).get('qaNow');
  if (!value) return 0;
  const target = Date.parse(value);
  return Number.isNaN(target) ? 0 : target - Date.now();
}

export const clock = createClock(offsetFromUrl());

// ---- tính toán thuần, dễ test ----

export interface Remaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** tổng ms còn lại, 0 khi đã hết */
  total: number;
  done: boolean;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function remaining(target: number, now: number): Remaining {
  // làm tròn LÊN tới giây: còn 0,4 giây thì vẫn hiện "1 giây", không hiện 0 khi chưa hết
  const total = Math.max(0, Math.ceil((target - now) / SECOND) * SECOND);
  return {
    days: Math.floor(total / DAY),
    hours: Math.floor((total % DAY) / HOUR),
    minutes: Math.floor((total % HOUR) / MINUTE),
    seconds: Math.floor((total % MINUTE) / SECOND),
    total,
    done: total === 0,
  };
}

export interface Stage<T = unknown> {
  start: number;
  /** không có end = kéo dài mãi */
  end?: number;
  data: T;
}

/** Stage đang hiệu lực tại `now` (Best Buy: syncActiveStage), -1 nếu không có. */
export function activeStageIndex(stages: Stage[], now: number) {
  return stages.findIndex((s) => now >= s.start && (s.end === undefined || now < s.end));
}

// ---- hook React ----

/**
 * "Bây giờ" theo `clock`, cập nhật đúng lúc sang giây mới (căn theo ranh giới giây thay vì
 * setInterval(1000) trôi dần), và cập nhật NGAY khi QA đổi offset.
 */
export function useNow(c: Clock = clock, step = SECOND): number {
  // offset là external store: QA đổi giờ thì component render lại ngay, không đợi tick
  const offset = useSyncExternalStore(c.subscribe, c.getOffset, () => 0);
  const [now, setNow] = useState(() => c.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      setNow(c.now());
      // hẹn lần sau đúng ranh giới giây tiếp theo (+5ms cho chắc đã qua)
      timer = setTimeout(update, step - (c.now() % step) + 5);
    };
    update();
    return () => clearTimeout(timer);
  }, [c, step, offset]);
  return now;
}

export function useCountdown(target: number, c: Clock = clock): Remaining {
  return remaining(target, useNow(c));
}
