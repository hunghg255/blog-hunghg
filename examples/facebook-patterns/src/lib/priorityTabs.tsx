import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useContextualLayer, useOutsideClick } from './contextualLayer';

/**
 * Thanh tab "priority+": tab nào không đủ chỗ thì tự chui vào menu "Xem thêm".
 * Theo CometTabs / CometTab của Facebook, KHÔNG đo chiều rộng bằng JS:
 * 1. Thanh tab có chiều cao cố định + overflow: hidden.
 * 2. Nút "Xem thêm" là inline-block đứng TRƯỚC các tab trong DOM, các tab thì float.
 *    Float được xếp vào dòng đầu chỉ khi còn đủ chỗ CẠNH nút "Xem thêm"; không đủ thì rơi
 *    xuống dòng 2 (bị overflow che). Nút "Xem thêm" tự trôi tới ngay sau tab cuối còn vừa.
 * 3. Mỗi tab có IntersectionObserver (root = thanh tab, threshold 0.5): bị che quá nửa -> ẩn.
 */

export interface TabItem {
  key: string;
  label: ReactNode;
}

export interface PriorityTabsProps {
  tabs: TabItem[];
  selectedKey: string;
  onSelect: (key: string) => void;
  height?: number;
  moreLabel?: ReactNode;
  className?: string;
  /** báo ra ngoài danh sách tab đang bị ẩn (để debug/demo) */
  onHiddenChange?: (hiddenKeys: string[]) => void;
}

export function PriorityTabs({
  tabs,
  selectedKey,
  onSelect,
  height = 44,
  moreLabel = 'Xem thêm',
  className = 'ptabs',
  onHiddenChange,
}: PriorityTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  // index các tab đang bị ẩn, luôn sắp xếp tăng dần (giống hàm add/remove của CometTabs)
  const [hidden, setHidden] = useState<number[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setHidden((prev) => {
          let next = prev;
          for (const entry of entries) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            const isHidden = entry.intersectionRatio < 0.5;
            if (isHidden && !next.includes(index)) next = [...next, index].sort((a, b) => a - b);
            if (!isHidden && next.includes(index)) next = next.filter((i) => i !== index);
          }
          return next;
        });
      },
      { root: container, threshold: 0.5 },
    );
    tabRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [tabs]);

  const hiddenKeys = hidden.map((i) => tabs[i]?.key).filter(Boolean) as string[];
  const hiddenKeyString = hiddenKeys.join('|');
  const onHiddenChangeRef = useRef(onHiddenChange);
  useLayoutEffect(() => {
    onHiddenChangeRef.current = onHiddenChange;
  });
  useEffect(() => {
    onHiddenChangeRef.current?.(hiddenKeyString ? hiddenKeyString.split('|') : []);
  }, [hiddenKeyString]);

  const selectedHidden = hiddenKeys.includes(selectedKey);
  const hasHidden = hidden.length > 0;

  // ---- roving focus: mũi tên trái/phải đi giữa các tab đang hiện + nút "Xem thêm" ----
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    const items = Array.from(
      containerRef.current!.querySelectorAll<HTMLElement>('[data-ptab]:not([aria-hidden="true"])'),
    ).sort((a, b) => Number(a.dataset.order) - Number(b.dataset.order));
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next = current;
    if (e.key === 'ArrowRight') next = (current + 1) % items.length;
    if (e.key === 'ArrowLeft') next = (current - 1 + items.length) % items.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = items.length - 1;
    e.preventDefault();
    // preventScroll: focus vào phần tử trong vùng overflow:hidden có thể làm trình duyệt
    // tự cuộn vùng đó (scrollLeft/scrollTop) và phá bố cục float.
    items[next]?.focus({ preventScroll: true });
  };

  return (
    <>
      <div
        ref={containerRef}
        role='tablist'
        className={className}
        onKeyDown={onKeyDown}
        style={{ height, overflow: 'hidden', position: 'relative' }}
        // trình duyệt vẫn có thể tự cuộn vùng overflow:hidden (vd: Ctrl+F); kéo về 0
        onScroll={(e) => {
          e.currentTarget.scrollTop = 0;
          e.currentTarget.scrollLeft = 0;
        }}
      >
        {/* (2) inline-block, đứng trước các float trong DOM */}
        <span style={{ display: 'inline-block', height, verticalAlign: 'top', visibility: hasHidden ? 'visible' : 'hidden' }}>
          <button
            ref={moreRef}
            type='button'
            role='tab'
            data-ptab
            data-order={tabs.length}
            aria-haspopup='menu'
            aria-expanded={menuOpen}
            aria-selected={selectedHidden}
            aria-hidden={!hasHidden || undefined}
            tabIndex={selectedHidden ? 0 : -1}
            className={`${className}-tab ${className}-more${selectedHidden ? ' is-selected' : ''}`}
            style={{ height }}
            onClick={() => setMenuOpen((o) => !o)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMenuOpen(true);
              }
            }}
          >
            {moreLabel} ▾
          </button>
        </span>
        {tabs.map((tab, index) => {
          const isHidden = hidden.includes(index);
          const selected = tab.key === selectedKey;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.key, el);
                else tabRefs.current.delete(tab.key);
              }}
              type='button'
              role='tab'
              data-ptab
              data-index={index}
              data-order={index}
              aria-selected={selected}
              // tab bị ẩn: không đọc, không bấm, không Tab tới được
              aria-hidden={isHidden || undefined}
              disabled={isHidden}
              tabIndex={selected && !isHidden ? 0 : -1}
              className={`${className}-tab${selected ? ' is-selected' : ''}`}
              style={{ float: 'left', height }}
              onClick={() => onSelect(tab.key)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {menuOpen && (
        <MoreMenu
          anchorRef={moreRef}
          className={className}
          items={hidden.map((i) => tabs[i]).filter(Boolean)}
          selectedKey={selectedKey}
          onSelect={(key) => {
            onSelect(key);
            setMenuOpen(false);
            moreRef.current?.focus({ preventScroll: true });
          }}
          onClose={() => {
            setMenuOpen(false);
            moreRef.current?.focus({ preventScroll: true });
          }}
          onOutside={() => setMenuOpen(false)}
        />
      )}
    </>
  );
}

function MoreMenu({
  anchorRef,
  items,
  selectedKey,
  className,
  onSelect,
  onClose,
  onOutside,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  items: TabItem[];
  selectedKey: string;
  className: string;
  onSelect: (key: string) => void;
  onClose: () => void;
  onOutside: () => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  useContextualLayer(anchorRef, layerRef, { position: 'below', align: 'end' });
  useOutsideClick([anchorRef, layerRef], onOutside, true);

  useEffect(() => {
    layerRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const menuItems = Array.from(layerRef.current!.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const i = menuItems.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') menuItems[(i + 1) % menuItems.length]?.focus();
    else if (e.key === 'ArrowUp') menuItems[(i - 1 + menuItems.length) % menuItems.length]?.focus();
    else return;
    e.preventDefault();
  };

  return createPortal(
    <div ref={layerRef} style={{ position: 'absolute', top: 0, left: 0, zIndex: 10 }}>
      <div role='menu' className={`${className}-menu`} onKeyDown={onKeyDown}>
        {items.map((item) => (
          <button
            key={item.key}
            type='button'
            role='menuitem'
            aria-current={item.key === selectedKey || undefined}
            onClick={() => onSelect(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
