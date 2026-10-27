/**
 * Nhiều tab cùng mở một app nhưng chỉ MỘT tab được làm việc "ồn ào":
 * phát âm thanh, hiện thông báo hệ điều hành, giữ kết nối realtime…
 *
 * - electLeader: bầu tab chủ bằng Web Locks API. Tab giữ lock là tab chủ; tab chủ đóng thì
 *   trình duyệt tự nhả lock và tab đang chờ kế tiếp lên thay. (HubSpot dùng thư viện `crosstab`
 *   để làm việc tương tự: onBecomeMaster / onSurrenderMaster.)
 * - claimActiveTab: kiểu của Telegram Web, tab mở SAU CÙNG thắng, các tab cũ tự ngắt.
 * - createNotificationSound: "mở khoá" âm thanh trước khi cần (HubSpot phát một âm thanh câm
 *   khi tab thành tab chủ / khi tab được hiện lại).
 * - setFaviconBadge / setTitleCount: chấm đỏ trên favicon và "(3)" trên tiêu đề tab.
 */

// ---------------------------------------------------------------------------
// Bầu tab chủ
// ---------------------------------------------------------------------------

export interface LeaderHandle {
  isLeader(): boolean;
  /** rời cuộc bầu (vd: component unmount). Đang là tab chủ thì nhả lock cho tab khác. */
  destroy(): void;
}

export function electLeader(name: string, onChange: (isLeader: boolean) => void): LeaderHandle {
  let leader = false;
  let release: (() => void) | null = null;
  let destroyed = false;
  const controller = new AbortController();

  if (!('locks' in navigator)) {
    // Trình duyệt quá cũ: coi như chỉ có một tab. Muốn chính xác hơn thì dùng localStorage
    // + heartbeat như thư viện crosstab.
    leader = true;
    queueMicrotask(() => !destroyed && onChange(true));
  } else {
    navigator.locks
      .request(name, { signal: controller.signal }, () => {
        if (destroyed) return;
        leader = true;
        onChange(true);
        // Giữ lock tới khi Promise này resolve: gọi destroy() hoặc tab bị đóng.
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      })
      .catch((error: unknown) => {
        // AbortError: destroy() khi còn đang xếp hàng chờ lock, không phải lỗi
        if ((error as Error).name !== 'AbortError') throw error;
      });
  }

  return {
    isLeader: () => leader,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      controller.abort();
      release?.();
      if (leader) {
        leader = false;
        onChange(false);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tab mở sau cùng thắng (Telegram Web)
// ---------------------------------------------------------------------------

/**
 * Ghi id của tab này vào localStorage. Tab khác ghi đè (tức là vừa mở) thì gọi `onTakenOver`
 * đúng một lần. Telegram kiểm tra bằng setInterval 2s; ở đây dùng sự kiện `storage`
 * (chỉ bắn ở các tab KHÁC tab vừa ghi) nên phản ứng ngay.
 */
export function claimActiveTab(key: string, onTakenOver: () => void) {
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Date.now() + Math.random());
  localStorage.setItem(key, id);

  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== localStorage || event.key !== key) return;
    if (event.newValue === id) return;
    stop();
    onTakenOver();
  };
  const stop = () => window.removeEventListener('storage', onStorage);
  window.addEventListener('storage', onStorage);
  return stop;
}

// ---------------------------------------------------------------------------
// Âm thanh thông báo
// ---------------------------------------------------------------------------

/**
 * Trình duyệt chặn phát âm thanh khi người dùng chưa tương tác với trang (autoplay policy).
 * AudioContext tạo ra lúc đó ở trạng thái "suspended"; resume() chỉ thành công khi trang đã
 * có tương tác. Vì vậy: thử mở khoá sớm (khi thành tab chủ, khi tab hiện lại, khi click),
 * để lúc có thông báo thật thì đã phát được.
 */
export function createNotificationSound() {
  let context: AudioContext | null = null;

  async function unlock(): Promise<boolean> {
    context ??= new AudioContext();
    if (context.state === 'running') return true;
    // resume() bị chặn có thể treo mãi không resolve: chỉ chờ tối đa 200ms
    await Promise.race([context.resume().catch(() => {}), new Promise((r) => setTimeout(r, 200))]);
    // đọc lại sau await: TS tưởng state vẫn là giá trị đã kiểm tra ở trên
    return (context.state as AudioContextState) === 'running';
  }

  /** hai nốt ngắn (tần số giống âm báo của HubSpot); trả về false nếu bị chặn */
  async function play(volume = 0.08): Promise<boolean> {
    if (!(await unlock()) || !context) return false;
    const ctx = context;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    [622.25, 932.33].forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = frequency;
      osc.connect(gain);
      const at = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(volume, at);
      osc.start(at);
      osc.stop(at + 0.1);
    });
    return true;
  }

  return {
    unlock,
    play,
    isUnlocked: () => context?.state === 'running',
    close() {
      void context?.close();
      context = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Favicon + tiêu đề
// ---------------------------------------------------------------------------

const originalIcons = new WeakMap<Document, string | null>();

/** Vẽ chấm đỏ lên favicon (count > 0) hoặc trả favicon gốc (count = 0). Trả về URL đang dùng. */
export function setFaviconBadge(count: number, doc: Document = document): string | null {
  let link = doc.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!originalIcons.has(doc)) originalIcons.set(doc, link?.href ?? null);
  const original = originalIcons.get(doc) ?? null;

  if (count <= 0) {
    if (link && original) link.href = original;
    return original;
  }

  const size = 32;
  const canvas = doc.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // Không vẽ lại ảnh favicon gốc (cần cùng origin/CORS và phải chờ ảnh tải xong);
  // bản demo vẽ một ô vuông bo góc làm nền.
  ctx.fillStyle = '#3b82f6';
  ctx.beginPath();
  ctx.roundRect(2, 2, 28, 28, 7);
  ctx.fill();
  ctx.fillStyle = '#f2466b';
  ctx.beginPath();
  ctx.arc(23, 9, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  const url = canvas.toDataURL('image/png');

  if (!link) {
    link = doc.createElement('link');
    link.rel = 'icon';
    doc.head.appendChild(link);
  }
  link.href = url;
  return url;
}

/** "(3) Hộp thư" — giữ nguyên tiêu đề gốc, chỉ thay phần đếm ở đầu. */
export function setTitleCount(count: number, doc: Document = document) {
  const base = doc.title.replace(/^\(\d+\+?\)\s*/, '');
  doc.title = count > 0 ? `(${count > 99 ? '99+' : count}) ${base}` : base;
}
