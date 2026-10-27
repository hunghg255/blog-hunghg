/**
 * Hàng đợi lệnh cho <video> có nén lệnh (ý tưởng từ VideoPlayerImplementationStateMachineHostCallQueue
 * của Facebook).
 *
 * Khi element video chưa sẵn sàng (chưa mount, đang đổi nguồn…), các lệnh play/pause/seek/volume
 * được xếp hàng. Lúc áp, không cần chạy lại cả chuỗi: chỉ trạng thái CUỐI mới quan trọng.
 * - mỗi loại lệnh (seek, volume, muted, rate) chỉ giữ lệnh cuối cùng;
 * - play và pause xoá lẫn nhau: chỉ còn lệnh cuối trong hai loại;
 * - thứ tự tương đối của các lệnh còn lại được giữ.
 */

export type VideoCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; time: number }
  | { type: 'volume'; volume: number }
  | { type: 'muted'; muted: boolean }
  | { type: 'rate'; rate: number };

/** Nén hàng đợi: giữ lệnh cuối mỗi loại, play/pause tính chung một loại. */
export function compactCommands(queue: VideoCommand[]): VideoCommand[] {
  let out: VideoCommand[] = [];
  for (const cmd of queue) {
    const group = cmd.type === 'play' || cmd.type === 'pause' ? 'playback' : cmd.type;
    out = out.filter((c) => (c.type === 'play' || c.type === 'pause' ? 'playback' : c.type) !== group);
    out.push(cmd);
  }
  return out;
}

export interface DesiredState {
  volume: number;
  muted: boolean;
}

export type PlayEvent =
  | { type: 'play_promise_created'; id: number }
  | { type: 'play_promise_resolved'; id: number }
  | { type: 'play_promise_rejected'; id: number; reason: string }
  | { type: 'command_failed'; command: VideoCommand; error: string; readyState: number; networkState: number }
  | { type: 'applied'; command: VideoCommand };

function apply(video: HTMLVideoElement, cmd: VideoCommand, id: number, emit: (e: PlayEvent) => void) {
  switch (cmd.type) {
    case 'play': {
      const p = video.play();
      // play() trả Promise: bị chặn autoplay hay bị pause() chen ngang thì reject
      emit({ type: 'play_promise_created', id });
      p.then(
        () => emit({ type: 'play_promise_resolved', id }),
        (err: unknown) => emit({ type: 'play_promise_rejected', id, reason: err instanceof Error ? err.name : String(err) }),
      );
      break;
    }
    case 'pause':
      video.pause();
      break;
    case 'seek':
      video.currentTime = cmd.time;
      break;
    case 'volume':
      video.volume = cmd.volume;
      break;
    case 'muted':
      video.muted = cmd.muted;
      break;
    case 'rate':
      video.playbackRate = cmd.rate;
      break;
  }
}

export interface VideoCommandQueue {
  /** áp ngay nếu có element, không thì xếp hàng */
  send(cmd: VideoCommand): void;
  /** gắn element (hoặc null khi gỡ); có element thì xả hàng đợi */
  attach(video: HTMLVideoElement | null): void;
  /** các lệnh đang chờ */
  pending(): VideoCommand[];
}

export function createVideoCommandQueue({
  desired,
  compact = true,
  onEvent = () => {},
}: {
  /** trạng thái người dùng muốn (volume/muted): luôn được áp sau cùng khi xả, thắng trạng thái DOM */
  desired: () => DesiredState;
  compact?: boolean;
  onEvent?: (e: PlayEvent) => void;
}): VideoCommandQueue {
  let video: HTMLVideoElement | null = null;
  let queue: VideoCommand[] = [];
  let nextId = 1;

  const run = (cmd: VideoCommand) => {
    if (!video) return;
    try {
      apply(video, cmd, nextId++, onEvent);
      onEvent({ type: 'applied', command: cmd });
    } catch (e) {
      // ghi kèm readyState/networkState để biết element đang ở trạng thái nào khi lỗi
      onEvent({
        type: 'command_failed',
        command: cmd,
        error: e instanceof Error ? e.message : String(e),
        readyState: video.readyState,
        networkState: video.networkState,
      });
    }
  };

  return {
    send(cmd) {
      if (video) run(cmd);
      else queue.push(cmd);
    },
    attach(el) {
      video = el;
      if (!el) return;
      const { volume, muted } = desired();
      const all = queue.concat([{ type: 'volume', volume }, { type: 'muted', muted }]);
      queue = [];
      for (const cmd of compact ? compactCommands(all) : all) run(cmd);
    },
    pending: () => queue.slice(),
  };
}
