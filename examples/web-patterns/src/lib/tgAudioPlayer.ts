/**
 * Trình phát audio toàn cục của Telegram (Telegram #19):
 * mỗi tin thoại/bài nhạc là một track sống ở cấp module, KHÔNG nằm trong component.
 * Component chỉ đăng ký nghe sự kiện; đổi chat (component unmount) thì nhạc vẫn phát,
 * và hết bài thì tự chuyển sang bài kế trong danh sách.
 * Kèm hai tiện ích: nhả bộ nhớ của thẻ media khi bỏ đi, và lấy ảnh poster của video ngay ở client.
 */

export type TrackEvent = 'play' | 'pause' | 'timeupdate' | 'ended' | 'loadeddata';
export type TrackHandler = (event: TrackEvent, audio: ReadonlyMedia) => void;

/** Những gì component được phép ĐỌC từ thẻ audio. */
export interface ReadonlyMedia {
  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly src: string;
}

/**
 * Bản gốc đưa cho component một `new Proxy(audio, { get: (o, k) => o[k] })` với ý "chỉ đọc".
 * Proxy không có bẫy `set` nên phép gán vẫn đi tới đối tượng gốc — nhưng với receiver là proxy,
 * setter native của HTMLMediaElement ném "Illegal invocation"; gọi method qua proxy cũng ném lỗi tương tự.
 * Một object chỉ có getter nói rõ ý đồ hơn và không có bất ngờ đó.
 */
export function readonlyView(audio: HTMLMediaElement): ReadonlyMedia {
  return {
    get currentTime() {
      return audio.currentTime;
    },
    get duration() {
      return audio.duration;
    },
    get paused() {
      return audio.paused;
    },
    get src() {
      return audio.src;
    },
  };
}

interface Track {
  id: string;
  order: number;
  audio: HTMLAudioElement;
  view: ReadonlyMedia;
  handlers: Set<TrackHandler>;
  onForcePlay?: () => void;
  detach: () => void;
}

export interface AudioRegistryOptions {
  createAudio?: () => HTMLAudioElement;
  /** bài kế tiếp chưa có component nào đăng ký (đang ở chat khác): báo để app tự mở player cho nó */
  onMissingNext?: (trackId: string) => void;
  /** gọi mỗi khi track đang phát đổi, để vẽ thanh player toàn cục */
  onCurrentChange?: (trackId: string | undefined) => void;
  /** false = giữ thứ tự mount như bản gốc (chỉ để so sánh trong demo) */
  sortByOrder?: boolean;
}

export function createAudioRegistry({
  createAudio = () => new Audio(),
  onMissingNext,
  onCurrentChange,
  sortByOrder = true,
}: AudioRegistryOptions = {}) {
  const tracks = new Map<string, Track>();
  /**
   * Danh sách phát xếp theo `order` (thứ tự tin trong chat), không theo thứ tự component mount.
   * Bản gốc `queue.push(trackId)` lúc mount: cuộn ngược lên tin cũ là tin cũ bị xếp SAU tin mới.
   */
  let queue: { id: string; order: number }[] = [];
  let currentId: string | undefined;

  const setCurrent = (id: string | undefined) => {
    currentId = id;
    onCurrentChange?.(id);
  };

  const emit = (track: Track, event: TrackEvent) => track.handlers.forEach((h) => h(event, track.view));

  function playNext(afterId: string) {
    const index = queue.findIndex((q) => q.id === afterId);
    const next = queue[index + 1];
    if (!next) {
      setCurrent(undefined);
      return;
    }
    const track = tracks.get(next.id);
    if (!track) {
      onMissingNext?.(next.id);
      return;
    }
    track.onForcePlay?.();
    setCurrent(next.id);
    if (track.audio.src) void track.audio.play().catch(() => {});
  }

  function createTrack(id: string, order: number, onForcePlay?: () => void): Track {
    const audio = createAudio();
    const track = { id, order, audio, view: readonlyView(audio), handlers: new Set<TrackHandler>(), onForcePlay } as Track;
    const events: TrackEvent[] = ['play', 'pause', 'timeupdate', 'loadeddata'];
    const listeners = events.map((event) => {
      const listener = () => emit(track, event);
      audio.addEventListener(event, listener);
      return [event, listener] as const;
    });
    const onEnded = () => {
      emit(track, 'ended');
      playNext(id);
    };
    audio.addEventListener('ended', onEnded);
    track.detach = () => {
      listeners.forEach(([e, l]) => audio.removeEventListener(e, l));
      audio.removeEventListener('ended', onEnded);
    };
    return track;
  }

  return {
    register(id: string, handler: TrackHandler, { order, onForcePlay }: { order: number; onForcePlay?: () => void }) {
      let track = tracks.get(id);
      if (!track) {
        track = createTrack(id, order, onForcePlay);
        tracks.set(id, track);
      } else if (onForcePlay) {
        track.onForcePlay = onForcePlay;
      }
      if (!queue.some((q) => q.id === id)) {
        queue = [...queue, { id, order }];
        if (sortByOrder) queue.sort((a, b) => a.order - b.order);
      }
      track.handlers.add(handler);
      const t = track;

      return {
        view: t.view,
        play(src: string) {
          if (currentId && currentId !== id) tracks.get(currentId)?.audio.pause();
          setCurrent(id);
          if (!t.audio.src) {
            t.audio.src = src;
            t.audio.preload = 'auto';
          }
          void t.audio.play().catch(() => {});
        },
        pause() {
          if (currentId === id) t.audio.pause();
        },
        seek(time: number) {
          if (currentId === id) t.audio.currentTime = time;
        },
        /** component unmount: chỉ huỷ track khi KHÔNG còn ai nghe và nó không phải bài đang phát */
        destroy(removeFromQueue = false) {
          t.handlers.delete(handler);
          if (t.handlers.size > 0 || (currentId === id && !t.audio.paused)) return;
          t.detach();
          releaseMedia(t.audio);
          tracks.delete(id);
          if (removeFromQueue) queue = queue.filter((q) => q.id !== id);
          if (currentId === id) setCurrent(undefined);
        },
      };
    },
    get currentId() {
      return currentId;
    },
    get queue() {
      return queue.map((q) => q.id);
    },
    /** cho thanh player toàn cục: track đang phát, kể cả khi component của nó đã unmount */
    current(): ReadonlyMedia | undefined {
      return currentId ? tracks.get(currentId)?.view : undefined;
    },
    pauseCurrent() {
      if (currentId) tracks.get(currentId)?.audio.pause();
    },
  };
}

// ---------- Nhả bộ nhớ thẻ media ----------

/**
 * Bản gốc: `pause(); src = ''; load()`. Gán chuỗi rỗng khiến trình duyệt chạy thuật toán chọn nguồn với
 * src rỗng và bắn sự kiện `error` (MEDIA_ERR_SRC_NOT_SUPPORTED) — listener onError nào còn gắn sẽ báo lỗi giả.
 * Gỡ hẳn thuộc tính rồi load() thì trình duyệt trả bộ đệm mà không bắn error.
 */
export function releaseMedia(media: HTMLMediaElement) {
  media.pause();
  media.removeAttribute('src');
  media.load();
}

// ---------- Poster video ngay ở client ----------

export interface PosterOptions {
  /** giây cần lấy khung, mặc định 1 (hoặc cuối video nếu ngắn hơn) */
  at?: number;
  timeoutMs?: number;
  type?: string;
  quality?: number;
}

/**
 * Tải metadata, tua tới giây thứ 1, vẽ khung lên canvas. Hết hạn thì trả undefined.
 * Bản gốc thiếu `return` sau `resolve(undefined)` khi video không có hình (file chỉ có tiếng):
 * kết quả vẫn đúng (Promise chỉ nhận lần resolve đầu) nhưng code chạy tiếp vẽ một canvas 0×0.
 * Bản gốc cũng không dọn thẻ video tạm.
 */
export async function createPosterForVideo(url: string, { at = 1, timeoutMs = 2000, type = 'image/jpeg', quality = 0.8 }: PosterOptions = {}) {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const work = new Promise<string | undefined>((resolve, reject) => {
    video.onerror = () => reject(new Error('Không đọc được video'));
    video.onloadedmetadata = () => {
      if (!video.videoWidth || !video.videoHeight) {
        resolve(undefined);
        return;
      }
      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')!.drawImage(video, 0, 0);
        resolve(canvas.toDataURL(type, quality));
      };
      const duration = Number.isFinite(video.duration) ? video.duration : at;
      video.currentTime = Math.min(duration, at);
    };
    video.src = url;
  });

  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    video.onseeked = video.onloadedmetadata = video.onerror = null;
    releaseMedia(video);
  }
}
