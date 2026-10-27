/**
 * Tải trước đuôi feed sớm hay muộn tuỳ chất lượng mạng.
 *
 * Ý tưởng từ CometFeedTailLoadBufferHeight + CometFeedInfiniteScrollSuspenseList của Facebook:
 * khoảng cách (px) từ đáy viewport tới "đuôi" feed mà ở đó bắt đầu tải trang kế tiếp được
 * chọn theo hạng kết nối. Mạng càng kém thì buffer càng LỚN: request mất nhiều thời gian hơn
 * nên phải bắt đầu sớm hơn mới kịp có nội dung trước khi người dùng cuộn tới.
 */

export type ConnectionClass = 'EXCELLENT' | 'GOOD' | 'MODERATE' | 'POOR' | 'UNKNOWN';

/** Đúng bộ số Facebook dùng (px). */
export const TAIL_LOAD_BUFFER: Record<Exclude<ConnectionClass, 'UNKNOWN'>, number> = {
  EXCELLENT: 2570,
  GOOD: 2933,
  MODERATE: 3227,
  POOR: 4948,
};

/** FB log lỗi "mustfix" rồi dùng 2500px nếu không tra được bảng. */
export const FALLBACK_BUFFER = 2500;

export function tailBufferFor(connectionClass: ConnectionClass): number {
  if (connectionClass === 'UNKNOWN') return TAIL_LOAD_BUFFER.EXCELLENT; // FB coi UNKNOWN như EXCELLENT
  return TAIL_LOAD_BUFFER[connectionClass] ?? FALLBACK_BUFFER;
}

/**
 * Facebook lấy hạng kết nối do server đoán (WebConnectionClassServerGuess), gửi kèm trang.
 * Không có server thì ước lượng ở client: ưu tiên RTT đo được từ chính các request của app,
 * sau đó mới tới Network Information API (chỉ có trên trình duyệt nhân Chromium).
 * Ngưỡng dưới đây là của bản viết lại, không phải của Facebook.
 */
export function guessConnectionClass(input: {
  measuredRttMs?: number | null;
  effectiveType?: string | null;
  saveData?: boolean;
}): ConnectionClass {
  const { measuredRttMs, effectiveType, saveData } = input;
  if (measuredRttMs != null) {
    // thời gian của cả một request lấy trang feed (gồm thời gian server xử lý), không phải ping
    if (measuredRttMs < 300) return 'EXCELLENT';
    if (measuredRttMs < 800) return 'GOOD';
    if (measuredRttMs < 1600) return 'MODERATE';
    return 'POOR';
  }
  if (saveData) return 'POOR';
  switch (effectiveType) {
    case '4g':
      return 'GOOD'; // "4g" chỉ nói là ≥ ngưỡng 4g, không nói là xuất sắc
    case '3g':
      return 'MODERATE';
    case '2g':
    case 'slow-2g':
      return 'POOR';
    default:
      return 'UNKNOWN';
  }
}

/** Trung bình trượt mũ (EWMA) của thời gian request: cập nhật rẻ, quên dần số liệu cũ. */
export function createRttEstimator(alpha = 0.3) {
  let value: number | null = null;
  return {
    add(ms: number) {
      value = value == null ? ms : value + alpha * (ms - value);
      return value;
    },
    get: () => value,
    reset: () => {
      value = null;
    },
  };
}

export interface TailLoaderOptions {
  /** phần tử cuộn; null = viewport */
  root: HTMLElement | null;
  /** phần tử đặt ở đuôi danh sách (thường là skeleton "đang tải") */
  sentinel: HTMLElement;
  bufferPx: number;
  /** giống waitOnScrollIntent của FB: chưa cuộn lần nào thì không tải trước */
  waitForScrollIntent?: boolean;
  onLoadMore: () => void;
  /**
   * Gọi khi skeleton thực sự lọt vào khung nhìn: người dùng đã đuổi kịp đuôi feed và phải
   * nhìn trạng thái đang tải. FB ghi sự kiện này với tên "collision_happened".
   */
  onCollision?: (info: { hadScrollIntent: boolean }) => void;
}

/**
 * Hai IntersectionObserver trên cùng một sentinel:
 * - một cái có rootMargin = buffer: chạm vào là bắt đầu tải trang kế tiếp;
 * - một cái rootMargin = 0: chạm vào nghĩa là đã "va chạm", người dùng đang nhìn skeleton.
 */
export function createTailLoader(options: TailLoaderOptions) {
  const { root, sentinel, onLoadMore, onCollision } = options;
  let bufferPx = options.bufferPx;
  let hadScrollIntent = !options.waitForScrollIntent;
  let prefetchObserver: IntersectionObserver | null = null;
  const scrollTarget: HTMLElement | Window = root ?? window;
  const startScroll = root ? root.scrollTop : window.scrollY;

  const makePrefetchObserver = () => {
    prefetchObserver?.disconnect();
    // chưa có ý định cuộn thì buffer = 0: chỉ tải khi đuôi feed đã hiện ra
    const margin = hadScrollIntent ? bufferPx : 0;
    prefetchObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMore();
      },
      { root, rootMargin: `0px 0px ${margin}px 0px` },
    );
    prefetchObserver.observe(sentinel);
  };

  const collisionObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) onCollision?.({ hadScrollIntent });
    },
    { root },
  );

  const onScroll = () => {
    const now = root ? root.scrollTop : window.scrollY;
    if (now !== startScroll && !hadScrollIntent) {
      hadScrollIntent = true;
      scrollTarget.removeEventListener('scroll', onScroll);
      makePrefetchObserver();
    }
  };

  if (!hadScrollIntent) scrollTarget.addEventListener('scroll', onScroll, { passive: true });
  makePrefetchObserver();
  collisionObserver.observe(sentinel);

  return {
    /** đổi buffer khi hạng kết nối thay đổi */
    setBuffer(px: number) {
      if (px === bufferPx) return;
      bufferPx = px;
      makePrefetchObserver();
    },
    /**
     * IntersectionObserver chỉ báo khi trạng thái giao nhau ĐỔI. Tải xong mà sentinel vẫn
     * nằm trong vùng buffer thì sẽ không có callback mới; gọi hàm này sau khi render trang
     * mới để observer kiểm tra lại từ đầu.
     */
    recheck() {
      makePrefetchObserver();
    },
    destroy() {
      prefetchObserver?.disconnect();
      collisionObserver.disconnect();
      scrollTarget.removeEventListener('scroll', onScroll);
    },
  };
}
