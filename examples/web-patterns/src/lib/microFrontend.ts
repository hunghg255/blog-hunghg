/**
 * Ba "cây cầu" giữa các mảnh của một micro-frontend, ý tưởng từ:
 * - pro.similarweb.com (single-spa/single-spa-config.ts): AngularJS cũ và React mới cùng sống
 *   trong một trang, mỗi app tự mount/unmount theo URL.
 * - invisionapp.com (utils/encodeDocumentTransferData.js): truyền dữ liệu sang app khác qua
 *   một tham số URL mã hoá base64.
 * - app.hubspot.com (js/manager/PostMessageManager.js, js/util/CounterUtil.js): iframe thông
 *   báo nói chuyện với trang chứa bằng postMessage (và document.domain, cách cũ).
 */

// ---------------------------------------------------------------------------
// 1. Registry mount/unmount theo route (single-spa tối giản)
// ---------------------------------------------------------------------------

export interface Lifecycles<P> {
  /** chạy một lần, lần đầu app được kích hoạt */
  bootstrap?: (props: P) => Promise<void> | void;
  mount: (container: HTMLElement, props: P) => Promise<void> | void;
  unmount: (container: HTMLElement, props: P) => Promise<void> | void;
}

export interface AppDefinition<P> {
  name: string;
  /** tải code của app (thường là import() động) */
  load: () => Promise<Lifecycles<P>>;
  activeWhen: (path: string) => boolean;
  container: () => HTMLElement;
}

export type AppStatus = 'not-loaded' | 'mounted' | 'unmounted' | 'broken';

export function createAppRegistry<P>(props: P, onChange?: (name: string, status: AppStatus, error?: unknown) => void) {
  const apps: (AppDefinition<P> & { status: AppStatus; lifecycles?: Lifecycles<P> })[] = [];
  let queue = Promise.resolve();
  let pending: string | null = null;

  const setStatus = (app: (typeof apps)[number], status: AppStatus, error?: unknown) => {
    app.status = status;
    onChange?.(app.name, status, error);
  };

  async function apply(path: string | null) {
    // Gỡ app không còn khớp TRƯỚC, rồi mới gắn app mới: hai app không bao giờ cùng chiếm màn hình
    for (const app of apps) {
      if (app.status === 'mounted' && (path === null || !app.activeWhen(path))) {
        try {
          await app.lifecycles!.unmount(app.container(), props);
          setStatus(app, 'unmounted');
        } catch (error) {
          setStatus(app, 'broken', error);
        }
      }
    }
    if (path === null) return;
    for (const app of apps) {
      if (app.status === 'mounted' || app.status === 'broken' || !app.activeWhen(path)) continue;
      try {
        if (!app.lifecycles) {
          app.lifecycles = await app.load();
          // bootstrap lỗi thì ném ra ngoài (KHÔNG nuốt rồi để Promise treo mãi)
          await app.lifecycles.bootstrap?.(props);
        }
        await app.lifecycles.mount(app.container(), props);
        setStatus(app, 'mounted');
      } catch (error) {
        setStatus(app, 'broken', error);
      }
    }
  }

  return {
    register(app: AppDefinition<P>) {
      apps.push({ ...app, status: 'not-loaded' });
    },
    /**
     * Gọi mỗi khi URL đổi. Các lần đổi dồn dập được xếp hàng, và nếu trong lúc chờ có URL mới
     * hơn thì chỉ áp dụng URL mới nhất.
     */
    reroute(path: string): Promise<void> {
      pending = path;
      queue = queue.then(() => {
        if (pending === null) return;
        const next = pending;
        pending = null;
        return apply(next);
      });
      return queue;
    },
    /** gỡ hết (trang chứa bị huỷ) */
    destroy(): Promise<void> {
      pending = null;
      queue = queue.then(() => apply(null));
      return queue;
    },
    status: (name: string) => apps.find((a) => a.name === name)?.status,
  };
}

// ---------------------------------------------------------------------------
// 2. Truyền dữ liệu qua URL
// ---------------------------------------------------------------------------

/** JSON → UTF-8 → base64url (không có + / =, an toàn trong URL, không lỗi với tiếng Việt). */
export function encodeTransferParam(data: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeTransferParam<T>(param: string): T {
  const base64 = param.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
}

/** Dựng URL bằng URLSearchParams: mọi giá trị đều được mã hoá, kể cả `redirectTo` có `?` và `&`. */
export function buildTransferUrl(path: string, params: Record<string, string>): string {
  return `${path}?${new URLSearchParams(params)}`;
}

// ---------------------------------------------------------------------------
// 3. postMessage giữa các frame
// ---------------------------------------------------------------------------

/**
 * Origin có thuộc `domain` (chính nó hoặc subdomain) không. So khớp trên hostname đã parse,
 * không dùng regex chưa neo hai đầu.
 */
export function isTrustedOrigin(origin: string, domain: string, { allowHttp = false } = {}): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // "null" (iframe sandbox, file://…) cũng rơi vào đây
  }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) return false;
  return url.hostname === domain || url.hostname.endsWith(`.${domain}`);
}

export type BridgeMessage = { name: string; [key: string]: unknown };

/**
 * Nghe postMessage có kiểm origin + kiểm cả `source` (đúng frame mình mong đợi), parse an toàn,
 * rồi chuyển cho handler theo `name`.
 */
export function listenToFrames(
  handlers: Record<string, (message: BridgeMessage, event: MessageEvent) => void>,
  { isAllowed, sources }: { isAllowed: (origin: string) => boolean; sources?: () => (Window | null)[] },
  target: Window = window,
) {
  const onMessage = (event: MessageEvent) => {
    if (!isAllowed(event.origin)) return;
    if (sources && !sources().includes(event.source as Window)) return;
    let message: unknown = event.data;
    if (typeof message === 'string') {
      try {
        message = JSON.parse(message);
      } catch {
        return;
      }
    }
    if (!message || typeof message !== 'object' || typeof (message as BridgeMessage).name !== 'string') return;
    const handler = handlers[(message as BridgeMessage).name];
    // Object.hasOwn: "toString", "constructor"… không được coi là tên handler hợp lệ
    if (handler && Object.hasOwn(handlers, (message as BridgeMessage).name)) handler(message as BridgeMessage, event);
  };
  target.addEventListener('message', onMessage);
  return () => target.removeEventListener('message', onMessage);
}
