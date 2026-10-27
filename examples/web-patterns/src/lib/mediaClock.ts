/**
 * Hai "đồng hồ" cho media:
 *
 * 1. createWatchTimeTracker: đếm thời gian xem thật (ý tưởng từ freemium-usage-tracker của Skillshare).
 *    Cộng dồn khoảng cách giữa hai lần `timeupdate`; khoảng nào quá lớn (máy ngủ, tab bị treo)
 *    thì bỏ, không cộng. Gửi lên server theo giây chẵn, có khoá chống gửi chồng, lỗi thì cộng lại.
 *
 * 2. createMasterClock: một timeline chủ điều khiển nhiều track (audio, video, animation)
 *    (ý tưởng từ timeline.js của Simplified). Mỗi frame so thời gian của từng track với
 *    timeline chủ, lệch quá ngưỡng (250ms) thì seek lại; lệch nhỏ thì để yên.
 */

// ---------------------------------------------------------------------------
// 1. Đếm thời gian xem
// ---------------------------------------------------------------------------

export interface WatchTimeOptions {
  /** gửi lên server: số giây xem được kể từ lần gửi trước. Reject nếu lỗi. */
  send: (seconds: number) => Promise<void>;
  /** đủ bao nhiêu ms thì gửi một lần, mặc định 15s */
  flushEvery?: number;
  /** hai lần tick cách nhau quá ngưỡng này thì coi là máy bị treo/ngủ, bỏ qua (mặc định 1000ms) */
  maxGap?: number;
  /** đồng hồ, mặc định performance.now (đơn điệu, không nhảy khi đổi giờ hệ thống) */
  now?: () => number;
  onDiscard?: (gapMs: number) => void;
}

export function createWatchTimeTracker({
  send,
  flushEvery = 15_000,
  maxGap = 1000,
  now = () => performance.now(),
  onDiscard,
}: WatchTimeOptions) {
  let last: number | null = null; // null = đang không xem
  let pendingMs = 0; // đã xem nhưng chưa gửi
  let saving: Promise<void> | null = null;
  let flushAgain = false;
  let retryAfter = 0; // gửi lỗi thì chờ thêm một chu kỳ mới tự gửi lại

  /** gọi trong `timeupdate` (trình duyệt bắn khoảng 4 lần/giây khi đang phát) */
  function tick() {
    if (last === null) return;
    const t = now();
    const gap = t - last;
    last = t; // luôn cập nhật mốc, kể cả khi bỏ qua khoảng này
    if (gap > maxGap) {
      onDiscard?.(gap);
      return;
    }
    pendingMs += gap;
    if (pendingMs >= flushEvery && t >= retryAfter) void flush();
  }

  async function flush(): Promise<void> {
    if (saving) {
      // đang gửi dở: không gửi chồng, gửi tiếp ngay khi lần này xong
      flushAgain = true;
      return saving;
    }
    const seconds = Math.floor(pendingMs / 1000);
    if (seconds <= 0) return;
    // trừ TRƯỚC khi gửi: thời gian xem trong lúc chờ server vẫn được cộng tiếp vào pendingMs
    pendingMs -= seconds * 1000;
    saving = send(seconds)
      .catch(() => {
        pendingMs += seconds * 1000; // gửi lỗi: trả lại để lần sau gửi
        // không có dòng này thì tick (4 lần/giây) nào cũng thấy đủ ngưỡng và gửi lại ngay
        retryAfter = now() + flushEvery;
      })
      .finally(() => {
        saving = null;
        if (flushAgain) {
          flushAgain = false;
          void flush();
        }
      });
    return saving;
  }

  return {
    /** gọi khi `play` */
    start() {
      last = now();
    },
    tick,
    /** gọi khi `pause`/`ended`/rời trang: chốt khoảng cuối rồi gửi */
    stop() {
      tick();
      last = null;
      return flush();
    },
    flush,
    getPendingMs: () => pendingMs,
  };
}

// ---------------------------------------------------------------------------
// 2. Timeline chủ + sửa lệch
// ---------------------------------------------------------------------------

/** Một thứ có thời gian riêng cần chạy theo timeline chủ. Đơn vị: ms. */
export interface SyncTarget {
  currentTime(): number;
  seek(ms: number): void;
  play(): void;
  pause(): void;
}

export interface TrackSpec {
  id: string;
  target: SyncTarget;
  /** track bắt đầu ở mốc nào trên timeline chủ */
  offset: number;
  /** track kéo dài bao lâu trên timeline chủ */
  duration: number;
  /** bắt đầu phát từ đâu trong media (cắt đầu file nhạc), mặc định 0 */
  start?: number;
}

export interface MasterClockOptions {
  duration: number;
  tracks: TrackSpec[];
  /** lệch quá ngưỡng này thì seek lại, mặc định 250ms như Simplified */
  maxDrift?: number;
  now?: () => number;
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (id: number) => void;
  onFrame?: (time: number) => void;
  onCorrect?: (trackId: string, driftMs: number) => void;
  onEnd?: () => void;
}

export function createMasterClock({
  duration,
  tracks,
  maxDrift = 250,
  now = () => performance.now(),
  requestFrame = (cb) => requestAnimationFrame(cb),
  cancelFrame = (id) => cancelAnimationFrame(id),
  onFrame,
  onCorrect,
  onEnd,
}: MasterClockOptions) {
  let playing = false;
  let position = 0; // vị trí khi đang dừng
  let startedAt = 0; // now() tương ứng với vị trí 0 khi đang phát
  let frame = 0;
  const active = new Set<string>(); // track đang nằm trong khoảng của nó

  const time = () => (playing ? now() - startedAt : position);

  /** đưa mọi track về đúng vị trí; force = seek dù lệch ít (dùng khi tua) */
  function sync(t: number, force: boolean) {
    for (const track of tracks) {
      const inside = t >= track.offset && t < track.offset + track.duration;
      const expected = t - track.offset + (track.start ?? 0);
      if (!inside) {
        if (active.delete(track.id)) track.target.pause();
        continue;
      }
      if (!active.has(track.id)) {
        // vừa đi vào khoảng của track: luôn seek một lần cho chắc
        active.add(track.id);
        track.target.seek(expected);
        if (playing) track.target.play();
        continue;
      }
      const drift = track.target.currentTime() - expected;
      if (force || Math.abs(drift) > maxDrift) {
        track.target.seek(expected);
        if (!force) onCorrect?.(track.id, drift);
      }
    }
  }

  function loop() {
    const t = time();
    if (t >= duration) {
      pause();
      seek(0);
      onEnd?.();
      return;
    }
    sync(t, false);
    onFrame?.(t);
    frame = requestFrame(loop);
  }

  function play() {
    if (playing) return;
    playing = true;
    startedAt = now() - position;
    for (const track of tracks) if (active.has(track.id)) track.target.play();
    loop();
  }

  function pause() {
    if (!playing) return;
    position = time();
    playing = false;
    cancelFrame(frame);
    for (const track of tracks) track.target.pause();
  }

  function seek(ms: number) {
    const t = Math.max(0, Math.min(duration, ms));
    if (playing) startedAt = now() - t;
    else position = t;
    sync(t, true);
    onFrame?.(t);
  }

  return {
    play,
    pause,
    seek,
    time,
    isPlaying: () => playing,
    destroy() {
      cancelFrame(frame);
      playing = false;
    },
  };
}

/** Bọc <audio>/<video> (đơn vị giây) thành SyncTarget (đơn vị ms). */
export function mediaTarget(el: HTMLMediaElement): SyncTarget {
  return {
    currentTime: () => el.currentTime * 1000,
    seek: (ms) => {
      el.currentTime = ms / 1000;
    },
    // play() trả về Promise và có thể bị chặn autoplay: nuốt lỗi để không có unhandled rejection
    play: () => void el.play().catch(() => {}),
    pause: () => el.pause(),
  };
}

/** Bọc một Web Animation (element.animate) thành SyncTarget. */
export function animationTarget(animation: Animation): SyncTarget {
  return {
    currentTime: () => Number(animation.currentTime ?? 0),
    seek: (ms) => {
      animation.currentTime = ms;
    },
    play: () => animation.play(),
    pause: () => animation.pause(),
  };
}
