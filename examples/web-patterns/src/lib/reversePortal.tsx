import {
  Children,
  cloneElement,
  isValidElement,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Reverse portal: render một cây React MỘT lần (InPortal), rồi "đặt" DOM của nó vào bất kỳ chỗ
 * nào trên trang (OutPortal). Đổi chỗ không làm cây remount: state, effect, input đang gõ…
 * vẫn nguyên. Ý tưởng từ `helpers/PortalNodeManager.tsx` của Zappos (LeafPortal / BranchPortal),
 * cùng họ với thư viện react-reverse-portal.
 */

type AnyProps = Record<string, unknown>;

export interface PortalNode<P extends AnyProps = AnyProps> {
  /** element chứa cây React của InPortal; chính element này được di chuyển giữa các OutPortal */
  getElement(): HTMLElement;
  /** OutPortal đang hiển thị node, null = không ai hiển thị (đang nằm trong "kho") */
  getHost(): HTMLElement | null;
  /** props do OutPortal hiện tại truyền vào, InPortal sẽ gắn vào child */
  getProps(): Partial<P>;
  setProps(props: Partial<P>): void;
  subscribe(listener: () => void): () => void;
  /** gắn node vào host; trả về cách đã làm để log/debug */
  mount(host: HTMLElement): 'move' | 'insert' | 'noop';
  unmount(host: HTMLElement): void;
}

type MoveBefore = (node: Node, child: Node | null) => void;

/** Element.moveBefore: di chuyển node mà KHÔNG gỡ khỏi document (iframe không tải lại, video không dừng). */
function moveInto(parent: HTMLElement, node: HTMLElement): 'move' | 'insert' {
  const moveBefore = (parent as unknown as { moveBefore?: MoveBefore }).moveBefore;
  if (moveBefore && node.isConnected && parent.isConnected) {
    try {
      moveBefore.call(parent, node, null);
      return 'move';
    } catch {
      // khác document/shadow root… thì quay về cách thường
    }
  }
  parent.appendChild(node);
  return 'insert';
}

function shallowEqual(a: AnyProps, b: AnyProps) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

let parking: HTMLElement | null = null;

/** "Kho" ẩn trong body: node không được OutPortal nào hiển thị thì nằm ở đây, vẫn ở trong document. */
function getParking(): HTMLElement {
  if (!parking || !parking.isConnected) {
    parking = document.createElement('div');
    parking.dataset.portalParking = '';
    parking.hidden = true;
    document.body.appendChild(parking);
  }
  return parking;
}

export function createPortalNode<P extends AnyProps = AnyProps>(): PortalNode<P> {
  let element: HTMLElement | null = null; // tạo lười: lúc SSR chưa có document
  let host: HTMLElement | null = null;
  let props: Partial<P> = {};
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  const getElement = () => {
    if (!element) {
      element = document.createElement('div');
      // không tạo thêm hộp layout: con bên trong bố cục như con trực tiếp của host
      element.style.display = 'contents';
    }
    return element;
  };

  return {
    getElement,
    getHost: () => host,
    getProps: () => props,
    setProps(next) {
      props = next;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    mount(nextHost) {
      const el = getElement();
      if (host === nextHost && el.parentNode === nextHost) return 'noop';
      host = nextHost;
      const how = moveInto(nextHost, el);
      notify();
      return how;
    },
    unmount(prevHost) {
      // OutPortal khác đã nhận node rồi (mount mới chạy trước cleanup cũ): bỏ qua
      if (host !== prevHost) return;
      host = null;
      // Chuyển vào kho NGAY, trước khi React gỡ host khỏi DOM. Nhờ vậy node luôn ở trong
      // document và lần mount sau dùng được moveBefore.
      if (element) moveInto(getParking(), element);
      props = {};
      notify();
    },
  };
}

/** Giữ một PortalNode ổn định suốt vòng đời component (tạo một lần). */
export function usePortalNode<P extends AnyProps = AnyProps>(): PortalNode<P> {
  const [node] = useState(() => createPortalNode<P>());
  return node;
}

/** Biết node đang được hiển thị ở đâu (vd: tự dừng video khi không ai hiển thị). */
export function usePortalHost<P extends AnyProps>(node: PortalNode<P>): HTMLElement | null {
  return useSyncExternalStore(node.subscribe, node.getHost, () => null);
}

/**
 * Render children MỘT lần vào element của node. Đặt InPortal ở chỗ "sống lâu" (cha chung của
 * mọi vị trí), không đặt bên trong vị trí sẽ biến mất.
 */
export function InPortal<P extends AnyProps>({
  node,
  children,
}: {
  node: PortalNode<P>;
  children: ReactNode;
}) {
  const props = useSyncExternalStore(node.subscribe, node.getProps, node.getProps);
  const content = Children.map(children, (child) =>
    isValidElement(child) ? cloneElement(child, props as Partial<unknown>) : child,
  );
  return createPortal(content, node.getElement());
}

export type OutPortalProps<P extends AnyProps> = { node: PortalNode<P> } & Partial<P>;

/** Chỗ hiển thị: lấy element của node về đây, kèm props (nếu có) cho component bên trong. */
export function OutPortal<P extends AnyProps>({ node, ...props }: OutPortalProps<P>) {
  const hostRef = useRef<HTMLDivElement>(null);

  // useLayoutEffect: gắn trước khi trình duyệt vẽ (không nháy), và cleanup chạy TRƯỚC khi React
  // gỡ host khỏi DOM, nên unmount() kịp chuyển node vào kho.
  useLayoutEffect(() => {
    const host = hostRef.current!;
    node.mount(host);
    return () => node.unmount(host);
  }, [node]);

  // props đổi thì chỉ cập nhật props, không tháo/gắn lại DOM.
  // Không có mảng deps: `props` là object mới mỗi render, nên tự so nông với lần trước.
  useLayoutEffect(() => {
    if (node.getHost() !== hostRef.current) return;
    if (!shallowEqual(node.getProps(), props)) node.setProps(props as unknown as Partial<P>);
  });

  return <div ref={hostRef} style={{ display: 'contents' }} />;
}
