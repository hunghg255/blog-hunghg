/**
 * Đo Visual Completion (VC) và Speed Index ngay trên trình duyệt người dùng,
 * cho cả điều hướng trong SPA (ý tưởng từ vc-tracker.WWW / CometVisualCompletion của Facebook).
 *
 * Cách làm:
 * 1. MutationObserver theo dõi vùng trang: phần tử mới được thêm, `hidden` bị gỡ,
 *    `style` hết display:none, ảnh đổi `src`.
 * 2. Mỗi phần tử đó được đưa cho IntersectionObserver. `entry.time` của lần báo đầu tiên
 *    xấp xỉ thời điểm phần tử được vẽ lên màn hình (IO chạy trong bước "update the rendering").
 * 3. Khi trang "xong" (hết lock, hết phần tử chờ), tính xem mỗi phần tử đóng góp bao nhiêu
 *    pixel trong viewport. VC = thời điểm phần tử cuối cùng có pixel được vẽ;
 *    Speed Index = Σ (tỉ lệ pixel × thời điểm vẽ).
 */

export const VC_ATTRIBUTE = 'data-visualcompletion';
/** Gắn lên phần tử không được tính (spinner, quảng cáo, đồng hồ đếm…) */
export const VC_IGNORE = 'ignore';

export interface VCElement {
  label: string;
  /** ms kể từ lúc bắt đầu điều hướng */
  latency: number;
  /** số pixel phần tử này "sở hữu" trong viewport */
  pixels: number;
  type: 'element' | 'image';
}

export interface VCReport {
  /** ms: lúc phần tử có pixel cuối cùng được vẽ */
  visuallyComplete: number;
  /** ms: lúc phần tử đầu tiên được vẽ */
  firstPaint: number;
  /** ms: càng nhỏ càng tốt, = thời điểm "trung bình" mà pixel xuất hiện */
  speedIndex: number;
  viewportPixels: number;
  paintedPixels: number;
  elements: VCElement[];
  /** đường cong % viewport đã hoàn tất theo thời gian */
  progress: { latency: number; percent: number }[];
  endReason: 'complete' | 'timeout';
  backgrounded: boolean;
}

export interface VisualCompletionOptions {
  /** vùng cần đo, mặc định document.body */
  root?: Element;
  /** quá thời gian này thì chốt kết quả dù vẫn còn lock */
  timeoutMs?: number;
  /** đặt tên phần tử trong báo cáo */
  label?: (element: Element) => string;
}

interface PaintRecord {
  element: Element;
  paintTime: number;
  type: VCElement['type'];
}

interface Node {
  record: PaintRecord;
  rect: { top: number; left: number; bottom: number; right: number };
  pixels: number;
  children: Node[];
}

const defaultLabel = (element: Element) =>
  element.closest('[data-vc-label]')?.getAttribute('data-vc-label') ?? element.tagName.toLowerCase();

const isInViewport = (element: Element) => {
  const r = element.getBoundingClientRect();
  return (
    r.bottom > 0 &&
    r.right > 0 &&
    r.top < document.documentElement.clientHeight &&
    r.left < document.documentElement.clientWidth
  );
};

const isHiddenStyle = (style: string | null) =>
  !!style && /display:\s*none|visibility:\s*hidden/.test(style);

export class VisualCompletionTrace {
  readonly startTime = performance.now();
  report: VCReport | null = null;

  private root: Element;
  private label: (element: Element) => string;
  private records = new Map<Element, PaintRecord>();
  /** phần tử đã thay đổi, đang chờ IntersectionObserver báo thời điểm vẽ */
  private pending = new Map<Element, PaintRecord['type']>();
  private locks = new Set<string>();
  private listeners = new Set<(report: VCReport) => void>();
  private mutationObserver: MutationObserver;
  private intersectionObserver: IntersectionObserver;
  private timeout: ReturnType<typeof setTimeout>;
  private settleFrame = 0;
  private backgrounded = document.visibilityState === 'hidden';
  private nextLockId = 0;

  constructor({ root = document.body, timeoutMs = 10_000, label = defaultLabel }: VisualCompletionOptions = {}) {
    this.root = root;
    this.label = label;
    this.intersectionObserver = new IntersectionObserver(this.onIntersect);
    this.mutationObserver = new MutationObserver(this.onMutations);
    this.mutationObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['hidden', 'style', 'src'],
    });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.timeout = setTimeout(() => this.finish('timeout'), timeoutMs);
  }

  /**
   * Giữ trace chưa được chốt (vd: chờ interaction tracing báo xong, chờ dữ liệu).
   * Trả về hàm nhả lock.
   */
  lock(name = 'lock'): () => void {
    const id = `${name}#${this.nextLockId++}`;
    this.locks.add(id);
    return () => {
      this.locks.delete(id);
      this.maybeFinish();
    };
  }

  onComplete(listener: (report: VCReport) => void) {
    if (this.report) listener(this.report);
    else this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Huỷ trace mà không báo cáo (vd: người dùng đã điều hướng tiếp). */
  dispose() {
    this.cleanup();
    this.listeners.clear();
  }

  // ---------- thu thập ----------

  private onMutations = (mutations: MutationRecord[]) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node instanceof HTMLImageElement) return this.trackImage(node);
          node.querySelectorAll('img').forEach((img) => this.trackImage(img));
          this.track(node, 'element');
        });
        continue;
      }
      const target = mutation.target as Element;
      if (mutation.attributeName === 'hidden' && !target.hasAttribute('hidden')) {
        this.track(target, 'element');
      } else if (
        mutation.attributeName === 'style' &&
        isHiddenStyle(mutation.oldValue) &&
        !isHiddenStyle(target.getAttribute('style'))
      ) {
        // từ display:none -> hiện ra: coi như vừa được vẽ
        this.track(target, 'element');
      } else if (mutation.attributeName === 'src' && target instanceof HTMLImageElement) {
        this.trackImage(target);
      }
    }
  };

  private isIgnored(element: Element) {
    for (let el: Element | null = element; el && el !== this.root.parentElement; el = el.parentElement) {
      if (el.getAttribute(VC_ATTRIBUTE) === VC_IGNORE) return true;
    }
    return false;
  }

  private track(element: Element, type: PaintRecord['type']) {
    if (this.report || this.isIgnored(element)) return;
    this.pending.set(element, type);
    this.intersectionObserver.observe(element);
  }

  /**
   * Ảnh chỉ "được vẽ" sau khi tải xong, nên chờ `load` rồi mới hỏi IntersectionObserver.
   * Chỉ giữ lock cho ảnh đang nằm trong viewport: ảnh ngoài màn hình (nhất là
   * loading="lazy") có thể không bao giờ tải, và dù tải thì cũng không góp pixel nào.
   */
  private trackImage(img: HTMLImageElement) {
    if (this.report || this.isIgnored(img) || !img.getAttribute('src')) return;
    if (img.complete && img.naturalWidth > 0) return this.track(img, 'image');
    if (!isInViewport(img)) return;
    const release = this.lock('image');
    const done = () => {
      img.removeEventListener('load', done);
      img.removeEventListener('error', done);
      if (img.naturalWidth > 0) this.track(img, 'image');
      release();
    };
    img.addEventListener('load', done);
    img.addEventListener('error', done);
  }

  private onIntersect = (entries: IntersectionObserverEntry[]) => {
    for (const entry of entries) {
      const type = this.pending.get(entry.target);
      if (!type) continue;
      // entry.time cùng mốc với performance.now() (tính từ timeOrigin)
      this.records.set(entry.target, { element: entry.target, paintTime: entry.time, type });
      this.pending.delete(entry.target);
      this.intersectionObserver.unobserve(entry.target);
    }
    this.maybeFinish();
  };

  /** Tab bị ẩn: trình duyệt ngừng vẽ, IO không bao giờ báo. Chốt luôn các phần tử đang chờ. */
  private onVisibilityChange = () => {
    if (document.visibilityState !== 'hidden') return;
    this.backgrounded = true;
    const now = performance.now();
    this.pending.forEach((type, element) => {
      this.records.set(element, { element, paintTime: now, type });
      this.intersectionObserver.unobserve(element);
    });
    this.pending.clear();
    this.maybeFinish();
  };

  private maybeFinish() {
    if (this.report) return;
    // phần tử bị gỡ khỏi DOM trước khi kịp vẽ: không chờ nữa
    this.pending.forEach((_, element) => {
      if (!element.isConnected) this.pending.delete(element);
    });
    if (this.locks.size > 0 || this.pending.size > 0) return;
    // Chờ 2 frame: nếu trong lúc đó có mutation mới thì pending lại khác rỗng.
    cancelAnimationFrame(this.settleFrame);
    this.settleFrame = requestAnimationFrame(() => {
      this.settleFrame = requestAnimationFrame(() => {
        if (this.locks.size === 0 && this.pending.size === 0) this.finish('complete');
      });
    });
  }

  private cleanup() {
    clearTimeout(this.timeout);
    cancelAnimationFrame(this.settleFrame);
    this.mutationObserver.disconnect();
    this.intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private finish(endReason: VCReport['endReason']) {
    if (this.report) return;
    this.cleanup();
    this.report = this.calculate(endReason);
    this.listeners.forEach((listener) => listener(this.report!));
    this.listeners.clear();
  }

  // ---------- tính toán ----------

  private calculate(endReason: VCReport['endReason']): VCReport {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const viewportPixels = vw * vh;

    // 1. Đo hình chữ nhật của từng phần tử, cắt theo viewport.
    const nodes = new Map<Element, Node>();
    this.records.forEach((record, element) => {
      if (!element.isConnected) return;
      const r = element.getBoundingClientRect();
      const rect = {
        top: Math.max(0, r.top),
        left: Math.max(0, r.left),
        bottom: Math.min(vh, r.bottom),
        right: Math.min(vw, r.right),
      };
      const area = Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);
      nodes.set(element, { record, rect, pixels: area, children: [] });
    });

    // 2. Dựng cây: phần tử con (được vẽ sau) nằm dưới phần tử cha gần nhất cũng được theo dõi.
    const roots: Node[] = [];
    nodes.forEach((node, element) => {
      let parent: Element | null = element.parentElement;
      while (parent && !nodes.has(parent)) parent = parent.parentElement;
      if (parent && nodes.get(parent)!.record.paintTime <= node.record.paintTime) {
        nodes.get(parent)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    // 3. Chia pixel: phần tử vẽ SAU được ưu tiên (nó là thứ người dùng thấy cuối cùng),
    //    mỗi phần tử bị giới hạn bởi số pixel còn lại, và trừ đi phần của các con.
    const flat: Node[] = [];
    const assign = (list: Node[], budget: number): number => {
      let used = 0;
      [...list]
        .sort((a, b) => b.record.paintTime - a.record.paintTime)
        .forEach((node) => {
          node.pixels = Math.min(budget, node.pixels);
          used += node.pixels;
          budget -= node.pixels;
          node.pixels -= assign(node.children, node.pixels);
          flat.push(node);
        });
      return used;
    };
    assign(roots, viewportPixels);

    const painted = flat
      .filter((node) => node.pixels > 0 && node.record.paintTime >= this.startTime)
      .map((node) => ({
        label: this.label(node.record.element),
        latency: Math.round(node.record.paintTime - this.startTime),
        pixels: Math.round(node.pixels),
        type: node.record.type,
      }))
      .sort((a, b) => a.latency - b.latency);

    const paintedPixels = painted.reduce((sum, el) => sum + el.pixels, 0);
    let cumulative = 0;
    const progress = painted.map((el) => {
      cumulative += el.pixels;
      return { latency: el.latency, percent: paintedPixels ? (cumulative / paintedPixels) * 100 : 0 };
    });

    return {
      visuallyComplete: painted.length ? painted[painted.length - 1].latency : 0,
      firstPaint: painted.length ? painted[0].latency : 0,
      speedIndex: Math.round(
        painted.reduce((sum, el) => sum + (paintedPixels ? (el.pixels / paintedPixels) * el.latency : 0), 0),
      ),
      viewportPixels,
      paintedPixels,
      elements: painted,
      progress,
      endReason,
      backgrounded: this.backgrounded,
    };
  }
}
