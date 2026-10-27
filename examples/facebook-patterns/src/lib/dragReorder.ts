import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';

/**
 * Sắp xếp lại danh sách bằng HTML5 drag-and-drop, không nhấp nháy
 * (ý tưởng từ useCometDraggableItems của Facebook).
 *
 * Mẹo chính: lúc bắt đầu kéo, nhớ khoảng cách từ con trỏ tới 4 mép của phần tử đang kéo.
 * Khi kéo lên, chỉ đổi chỗ khi MÉP TRÊN của phần tử đang kéo (con trỏ trừ khoảng cách đó)
 * đã vượt mép trên của phần tử đích; kéo xuống thì xét mép dưới. Nhờ vậy không đổi chỗ
 * qua lại liên tục khi hai phần tử cao khác nhau.
 *
 * Khác bản gốc: chỉ commit khi thật sự thả (drop). Bản gốc commit ở dragend, nên bấm Esc
 * hoặc thả ra ngoài vẫn đổi thứ tự.
 */

export type DragDirection = 'vertical' | 'horizontal';

export interface DragReorderOptions<T> {
  items: T[];
  getKey: (item: T) => string;
  onReorder: (next: T[], from: number, to: number) => void;
  direction?: DragDirection;
  /** 'edge' = cách của Facebook, 'enter' = đổi ngay khi con trỏ chạm phần tử khác */
  swapRule?: 'edge' | 'enter';
  /** true = commit cả khi huỷ (Esc, thả ra ngoài), giống bản gốc */
  commitOnCancel?: boolean;
  /** được gọi mỗi lần thứ tự xem trước thay đổi (để đếm "nhấp nháy") */
  onPreviewChange?: () => void;
}

interface Edges {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function useDragReorder<T>({
  items,
  getKey,
  onReorder,
  direction = 'vertical',
  swapRule = 'edge',
  commitOnCancel = false,
  onPreviewChange,
}: DragReorderOptions<T>) {
  const [from, setFrom] = useState(-1);
  const [to, setTo] = useState(-1);
  const edges = useRef<Edges>({ top: 0, bottom: 0, left: 0, right: 0 });
  const lastPointer = useRef({ x: 0, y: 0 });
  const dropped = useRef(false);

  // danh sách xem trước: phần tử đang kéo đã nằm ở vị trí `to`
  const preview = useMemo(() => {
    const next = items.slice();
    if (from >= 0 && to >= 0 && from !== to) next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
  }, [items, from, to]);

  const onPreviewChangeRef = useRef(onPreviewChange);
  onPreviewChangeRef.current = onPreviewChange;
  useEffect(() => {
    if (from >= 0) onPreviewChangeRef.current?.();
  }, [to, from]);

  const finish = useCallback(() => {
    if ((dropped.current || commitOnCancel) && from >= 0 && to >= 0 && from !== to) {
      onReorder(preview, from, to);
    }
    dropped.current = false;
    setFrom(-1);
    setTo(-1);
  }, [commitOnCancel, from, to, preview, onReorder]);

  const getItemProps = (index: number) => ({
    draggable: true,
    'data-index': index,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      edges.current = {
        top: event.clientY - rect.top,
        bottom: rect.bottom - event.clientY,
        left: event.clientX - rect.left,
        right: rect.right - event.clientX,
      };
      lastPointer.current = { x: event.clientX, y: event.clientY };
      event.dataTransfer.effectAllowed = 'move';
      // Firefox chỉ bắt đầu kéo khi có dữ liệu
      event.dataTransfer.setData('text/plain', getKey(items[index]));
      dropped.current = false;
      setFrom(index);
      setTo(index);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (from < 0) return; // không phải phần tử của danh sách này
      event.preventDefault(); // cho phép thả
      event.dataTransfer.dropEffect = 'move';
      if (index === to) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const vertical = direction === 'vertical';
      const delta = vertical ? event.clientY - lastPointer.current.y : event.clientX - lastPointer.current.x;
      lastPointer.current = { x: event.clientX, y: event.clientY };
      if (swapRule === 'enter') {
        setTo(index);
        return;
      }
      const e = edges.current;
      if (vertical) {
        if (delta < 0 && event.clientY - e.top < rect.top) setTo(index);
        else if (delta > 0 && event.clientY + e.bottom > rect.bottom) setTo(index);
      } else {
        if (delta < 0 && event.clientX - e.left < rect.left) setTo(index);
        else if (delta > 0 && event.clientX + e.right > rect.right) setTo(index);
      }
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (from < 0) return;
      event.preventDefault();
      dropped.current = true;
    },
    onDragEnd: finish,
  });

  return { preview, draggingIndex: to, isDragging: from >= 0, getItemProps };
}

/**
 * Overlay "thả file vào đây" không nhấp nháy (ý tưởng từ useFileDragEvents).
 *
 * dragleave bắn mỗi khi con trỏ đi qua MỘT PHẦN TỬ CON, nên dùng bộ đếm enter/leave
 * thay vì một cờ boolean. Khác bản gốc:
 * - nhận diện kéo file bằng dataTransfer.types.includes('Files'). Bản gốc kiểm
 *   `dataTransfer.files != null`, mà `files` luôn là một FileList (có thể rỗng),
 *   nên kéo một dòng chữ hay một ảnh trong trang cũng hiện overlay;
 * - reset bộ đếm cả khi thả ở nơi khác hoặc khi kéo kết thúc ngoài cửa sổ.
 */
export interface FileDropOptions {
  onFiles: (files: File[]) => void;
  /** 'counter' (mặc định) hoặc 'boolean' (cách ngây thơ, để so sánh) */
  mode?: 'counter' | 'boolean';
  /** 'types' (mặc định) hoặc 'files-not-null' như bản gốc */
  detect?: 'types' | 'files-not-null';
  onToggle?: (visible: boolean) => void;
}

export function useFileDropZone<E extends HTMLElement>({ onFiles, mode = 'counter', detect = 'types', onToggle }: FileDropOptions) {
  const ref = useRef<E>(null);
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const visible = useRef(false);
  const latest = useRef({ onFiles, onToggle });
  latest.current = { onFiles, onToggle };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const isFileDrag = (event: DragEvent | globalThis.DragEvent) => {
      const dt = event.dataTransfer;
      if (!dt) return false;
      return detect === 'types' ? Array.from(dt.types).includes('Files') : dt.files != null;
    };
    const show = (value: boolean) => {
      if (visible.current === value) return;
      visible.current = value;
      setActive(value);
      latest.current.onToggle?.(value);
    };
    const onEnter = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      depth.current++;
      show(true);
    };
    const onLeave = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) return;
      if (mode === 'boolean') show(false);
      else if (--depth.current <= 0) {
        depth.current = 0;
        show(false);
      }
    };
    const onOver = (event: globalThis.DragEvent) => {
      if (isFileDrag(event)) event.preventDefault();
    };
    const onDrop = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      depth.current = 0;
      show(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) latest.current.onFiles(files);
    };
    // kéo kết thúc ở chỗ khác (thả ngoài vùng, Esc): đưa bộ đếm về 0
    const reset = () => {
      depth.current = 0;
      show(false);
    };
    el.addEventListener('dragenter', onEnter);
    el.addEventListener('dragleave', onLeave);
    el.addEventListener('dragover', onOver);
    el.addEventListener('drop', onDrop);
    window.addEventListener('drop', reset);
    window.addEventListener('dragend', reset);
    return () => {
      el.removeEventListener('dragenter', onEnter);
      el.removeEventListener('dragleave', onLeave);
      el.removeEventListener('dragover', onOver);
      el.removeEventListener('drop', onDrop);
      window.removeEventListener('drop', reset);
      window.removeEventListener('dragend', reset);
    };
  }, [mode, detect]);

  return { ref, active };
}
