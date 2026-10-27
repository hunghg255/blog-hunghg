/**
 * Mô phỏng hành vi của Resizer bản gốc (không phải mã của Udemy) để so sánh trong demo:
 * - mousedown trên CẢ khối gọi preventDefault;
 * - mousemove/mouseup nghe trên document;
 * - mỗi lần di chuột đọc lại getBoundingClientRect và tính width = rect.width - x (mép trái).
 */
import { cursorFor, edgeAt, hasEdge, type Box, type Edge, type EdgeHit } from '../lib/udResizer';

export function attachUdemyStyleResizer(
  el: HTMLElement,
  edges: Partial<Record<Edge, boolean>>,
  onMove: (size: Box) => void,
  margin = 5,
): () => void {
  let hit: EdgeHit | null = null;

  const measure = (event: MouseEvent) => {
    const rect = el.getBoundingClientRect();
    return { rect, x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onDown = (event: MouseEvent) => {
    event.preventDefault(); // cả khối: chọn chữ bên trong cũng bị chặn
    const { rect, x, y } = measure(event);
    const h = edgeAt(rect, x, y, margin, edges);
    hit = hasEdge(h) ? h : null;
    if (hit) document.body.style.cursor = cursorFor(hit);
  };

  const onDocMove = (event: MouseEvent) => {
    if (!hit) return;
    const { rect, x, y } = measure(event);
    let { width, height } = rect;
    if (hit.top) height = rect.height - y;
    else if (hit.bottom) height = y;
    if (hit.left) width = rect.width - x;
    else if (hit.right) width = x;
    onMove({ width, height });
  };

  const onDocUp = () => {
    hit = null;
    document.body.style.cursor = '';
  };

  el.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onDocMove);
  document.addEventListener('mouseup', onDocUp);
  return () => {
    el.removeEventListener('mousedown', onDown);
    document.removeEventListener('mousemove', onDocMove);
    document.removeEventListener('mouseup', onDocUp);
    document.body.style.cursor = '';
  };
}
