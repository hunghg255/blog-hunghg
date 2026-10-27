import {
  createElement,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { usePressability, type InteractionState, type PressEvent } from './pressable';

/**
 * <Pressable>: một primitive cho mọi thứ "bấm được" (theo Pressable.react của Facebook).
 * - role quyết định thẻ HTML (link -> <a>, navigation -> <nav>…), mặc định <div>.
 * - Enter (mọi role) / Space (button, checkbox, menuitem…) kích hoạt phần tử không phải nút gốc.
 * - Link: click thường -> preventDefault để app tự điều hướng (onPress); Ctrl/Cmd/Shift/Alt+click
 *   -> để trình duyệt tự mở tab mới / cửa sổ mới / tải xuống.
 * - children / className / style có thể là hàm nhận trạng thái tương tác.
 */

const ROLE_TO_TAG: Record<string, string> = {
  article: 'article',
  banner: 'header',
  complementary: 'aside',
  contentinfo: 'footer',
  figure: 'figure',
  form: 'form',
  heading: 'h1',
  label: 'label',
  link: 'a',
  list: 'ul',
  listitem: 'li',
  main: 'main',
  navigation: 'nav',
  none: 'div',
  region: 'section',
};

const SPACE_ROLES = new Set([
  'button',
  'checkbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'switch',
]);

type StateFn<T> = T | ((state: InteractionState) => T);
const resolve = <T,>(value: StateFn<T>, state: InteractionState): T =>
  typeof value === 'function' ? (value as (s: InteractionState) => T)(state) : value;

export interface PressableProps {
  role?: string;
  link?: { url: string; target?: string; rel?: string };
  onPress?: (e: MouseEvent | KeyboardEvent) => void;
  onPressStart?: (e: PressEvent) => void;
  onPressEnd?: (e: PressEvent) => void;
  disabled?: boolean;
  label?: string;
  className?: StateFn<string | undefined>;
  style?: StateFn<CSSProperties | undefined>;
  children?: StateFn<ReactNode>;
}

/** Bản thân phần tử đã tự xử lý Enter/Space (nút gốc, ô nhập, link có href…) thì để yên. */
function isNativelyActivatable(el: HTMLElement) {
  return (
    el.isContentEditable ||
    (el.tagName === 'A' && (el as HTMLAnchorElement).hasAttribute('href')) ||
    ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)
  );
}

export function Pressable({
  role,
  link,
  onPress,
  onPressStart,
  onPressEnd,
  disabled = false,
  label,
  className,
  style,
  children,
}: PressableProps) {
  const ref = useRef<HTMLElement>(null);
  const state = usePressability(ref, { disabled, onPressStart, onPressEnd });
  const tag = role ? (ROLE_TO_TAG[role] ?? 'div') : link ? 'a' : 'div';
  const isLink = tag === 'a' && !disabled;

  const onClick = (e: MouseEvent) => {
    onPress?.(e);
    if (onPress || link) e.stopPropagation(); // Pressable lồng nhau: chỉ cái trong cùng
    const modified = e.altKey || e.ctrlKey || e.metaKey || e.shiftKey;
    // Link + click thường: app tự điều hướng (client-side). Có phím bổ trợ: trả cho trình duyệt.
    if (isLink && !modified) e.preventDefault();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el !== ref.current || el.tabIndex < 0 || isNativelyActivatable(el)) return;
    const isSpace = e.key === ' ' || e.key === 'Spacebar';
    if (e.key === 'Enter' || (isSpace && SPACE_ROLES.has(el.getAttribute('role') ?? ''))) {
      if (isSpace) e.preventDefault(); // Space mặc định cuộn trang
      if (onPress) {
        onPress(e);
        e.stopPropagation();
      }
    }
  };

  return createElement(
    tag,
    {
      ref,
      role: role === 'none' ? 'presentation' : role === 'label' ? undefined : role,
      'aria-label': label,
      'aria-disabled': disabled || undefined,
      tabIndex: disabled ? -1 : 0,
      href: isLink ? link?.url : undefined,
      target: isLink ? link?.target : undefined,
      rel: isLink ? link?.rel : undefined,
      onClick: disabled ? undefined : onClick,
      onKeyDown: disabled ? undefined : onKeyDown,
      className: resolve(className, state),
      // tự quản lý vòng focus qua state.focusVisible, tắt outline mặc định khi không cần
      style: { outline: state.focusVisible ? undefined : 'none', ...resolve(style, state) },
      'data-hovered': state.hovered || undefined,
      'data-pressed': state.pressed || undefined,
      'data-focus-visible': state.focusVisible || undefined,
    },
    resolve(children, state),
  );
}

/**
 * Lớp phủ hover/pressed/focus (giống CometPressableOverlay): NHỚ trạng thái cuối cùng để khi
 * mờ dần (opacity -> 0) màu không bị nhảy sang màu khác giữa chừng.
 */
export function PressableOverlay({ state, offset = 0 }: { state: InteractionState; offset?: number }) {
  const last = useRef<'pressed' | 'focused' | 'hovered' | null>(null);
  if (state.pressed) last.current = 'pressed';
  else if (state.focusVisible) last.current = 'focused';
  else if (state.hovered) last.current = 'hovered';
  const visible = state.pressed || state.focusVisible || state.hovered;
  return (
    <span
      aria-hidden
      className={`pressable-overlay is-${last.current ?? 'none'}${visible ? ' is-visible' : ''}`}
      // offset âm: vùng highlight to hơn nút (nút icon tròn nhỏ)
      style={{ inset: -offset }}
    />
  );
}
