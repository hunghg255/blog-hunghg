import { useSyncExternalStore } from 'react';

/**
 * Store quản lý toast, không phụ thuộc React (lấy ý tưởng từ CometToasterStateManager).
 *
 * Vòng đời một toast:
 *   push -> (chờ trong hàng đợi) -> shown (bắt đầu đếm giờ) -> expired (chạy animation thoát)
 *        -> bị xoá khỏi store sau `exitDuration`.
 * Hover vào toast thì dừng đồng hồ, rời chuột thì đếm lại từ đầu.
 */

export interface Toast<T> {
  id: string;
  value: T;
  /** null = không tự tắt */
  duration: number | null;
  shown: boolean;
  expired: boolean;
  /** tăng mỗi lần đồng hồ chạy lại, view dùng làm key để reset thanh progress */
  timerVersion: number;
  paused: boolean;
}

export interface ToastStoreOptions {
  /** số toast tối đa CHƯA hiển thị được giữ trong hàng đợi; vượt quá thì bỏ cái cũ nhất */
  maxQueued?: number;
  exitDuration?: number;
}

export class ToastStore<T> {
  private nextId = 0;
  private toasts: readonly Toast<T>[] = [];
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();
  private maxQueued: number;
  private exitDuration: number;

  constructor({ maxQueued = 2, exitDuration = 300 }: ToastStoreOptions = {}) {
    this.maxQueued = maxQueued;
    this.exitDuration = exitDuration;
  }

  // --- API cho nơi phát toast ---

  push(value: T, duration: number | null = 4000): string {
    const id = `toast-${this.nextId++}`;
    let next = [
      ...this.toasts,
      { id, value, duration, shown: false, expired: false, timerVersion: 0, paused: false },
    ];
    const queued = next.filter((t) => !t.shown && !t.expired);
    if (this.maxQueued > 0 && queued.length > this.maxQueued) {
      // Spam 10 toast liên tiếp thì người dùng không cần xem hết: bỏ cái cũ nhất đang chờ.
      next = next.filter((t) => t.id !== queued[0].id);
    }
    this.setToasts(next);
    return id;
  }

  dismiss(id: string) {
    const toast = this.get(id);
    if (!toast || toast.expired) return;
    this.clearTimer(id);
    this.update(id, { expired: true });
    // giữ lại thêm một chút cho animation thoát rồi mới xoá hẳn
    setTimeout(() => this.setToasts(this.toasts.filter((t) => t.id !== id)), this.exitDuration);
  }

  // --- API cho view ---

  /** View báo toast đã thực sự hiện trên màn hình -> lúc này mới bắt đầu đếm giờ. */
  markShown(id: string) {
    const toast = this.get(id);
    if (!toast || toast.shown) return;
    this.update(id, { shown: true });
    this.startTimer(id);
  }

  pause(id: string) {
    const toast = this.get(id);
    if (!toast || toast.expired || toast.paused) return;
    this.clearTimer(id);
    this.update(id, { paused: true });
  }

  resume(id: string) {
    const toast = this.get(id);
    if (!toast || toast.expired || !toast.paused) return;
    this.update(id, { paused: false, timerVersion: toast.timerVersion + 1 });
    this.startTimer(id);
  }

  // --- external store cho useSyncExternalStore ---

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.toasts;

  // --- nội bộ ---

  private get(id: string) {
    return this.toasts.find((t) => t.id === id);
  }

  private update(id: string, patch: Partial<Toast<T>>) {
    this.setToasts(this.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  private setToasts(next: readonly Toast<T>[]) {
    // luôn tạo mảng mới (immutable) để useSyncExternalStore nhận ra thay đổi
    this.toasts = next;
    this.listeners.forEach((listener) => listener());
  }

  private startTimer(id: string) {
    const toast = this.get(id);
    if (!toast || toast.duration == null) return;
    this.clearTimer(id);
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), toast.duration),
    );
  }

  private clearTimer(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }
}

// Snapshot cho server và lần hydrate đầu: luôn rỗng, cùng một tham chiếu.
const EMPTY: readonly Toast<never>[] = [];
const getServerSnapshot = () => EMPTY;

export function useToasts<T>(store: ToastStore<T>): readonly Toast<T>[] {
  // Không dùng store.getSnapshot làm getServerSnapshot: nếu client đã push toast trước khi
  // hydrate (vd: flash message lúc khởi động), HTML server (rỗng) sẽ lệch với client.
  // React render lần hydrate bằng EMPTY rồi tự cập nhật sang snapshot thật ngay sau đó.
  return useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);
}
