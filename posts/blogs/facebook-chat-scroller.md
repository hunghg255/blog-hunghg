---
title: 'Học từ Facebook #16: Khung chat không giật khi tải tin cũ'
description: 'Cách Messenger giữ khung chat dính đáy và không nhảy khi tải tin cũ, và bản viết lại bằng React neo theo tin nhắn để xử lý cả spinner lẫn ảnh tải chậm.'
date: '2026-10-27T09:50'
series: facebook
seriesOrder: 16
author: hunghg255
image: https://blog.hunghg.me/blogs/fb-chat-scroller.png
tags: ['facebook', 'react', 'chat', 'scroll', 'ux']
---

Khung chat là một trong những thứ khó làm "cho đúng" nhất trên web, dù trông chỉ là một `div` có `overflow-y: auto`. Người dùng mong đợi:

1. Mở cuộc trò chuyện là thấy **tin mới nhất ở đáy**.
2. Đang ở đáy mà có tin mới thì **tự cuộn theo**. Đang kéo lên đọc tin cũ thì **đứng yên**, chỉ hiện nút "↓ 3 tin mới".
3. Kéo lên đỉnh thì **tải tin cũ hơn**, và chỗ đang đọc **không nhảy** đi đâu cả.
4. Ảnh trong tin nhắn tải xong làm tin cao thêm 200px: vẫn không nhảy.
5. Cuộn tới mép khung chat thì **dừng**, không kéo luôn cả trang bên ngoài.

Làm ngây thơ thì gặp đủ cả năm lỗi. Thử ngay trong demo: bật "Cách ngây thơ", kéo lên đỉnh. Khi tin cũ được chèn vào, tin bạn đang đọc bị đẩy văng xuống hơn 500px.

> [!TIP]
> **Tóm tắt**
> - Lưu vị trí khi người dùng cuộn, khôi phục trong `useLayoutEffect` (sau khi DOM đổi, trước khi vẽ) và trong callback ResizeObserver.
> - Facebook lưu "khoảng cách tới đáy". Bản viết lại neo theo **tin nhắn đang hiện** (anchor), đúng cả khi nội dung đổi ở phía trên lẫn phía dưới.
> - Bắn sự kiện **theo cạnh** (chỉ khi chuyển vào đỉnh/đáy) để không gọi tải tin cũ lặp lại.
> - `overscroll-behavior: contain` để cuộn tới mép không kéo theo trang bên ngoài.

<iframe class="demo-frame" src="/demos/facebook-patterns/index.html?theme=dark#/chat-scroller" title="Demo chat-scroller" loading="lazy" style="height: 640px"></iframe>

<p class="demo-links">▶ <a href="/demos/facebook-patterns/index.html#/chat-scroller" target="_blank" rel="noopener">Mở demo toàn màn hình ↗</a> · <a href="https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns?file=src/lib/useChatScroller.ts" target="_blank" rel="noopener">Sửa code trên StackBlitz ↗</a> · <a href="https://github.com/hunghg255/blog-hunghg/blob/master/examples/facebook-patterns/src/lib/useChatScroller.ts" target="_blank" rel="noopener">Xem source trên GitHub ↗</a></p>

## Facebook làm thế nào?

Messenger trên facebook.com dùng module `MWChatConversationScroller_DEPRECATED.bs` (nằm trong bundle `99 ChatComposer/all.js` của [facebook-codebase](https://github.com/hunghg255/facebook-codebase)). Đuôi `.bs` cho biết module được viết bằng **ReasonML** và biên dịch qua BuckleScript. Vì vậy trong code có những thứ như `{TAG: 0, _0: b}`: đó là cách ReasonML biểu diễn một biến thể (variant) có kèm dữ liệu.

### Bốn trạng thái vị trí

Giải mã hàm cập nhật vị trí (đã đổi tên biến, viết gọn lại):

```js
function isAtBottom(el, tolerance = 20) { return el.scrollTop + el.clientHeight >= el.scrollHeight - tolerance }
function isAtTop(el, tolerance = 20) { return el.scrollTop <= tolerance }

const distFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
state.current = isAtBottom(el) ? (hasMoreAfter ? 1 : 0)
              : isAtTop(el) ? { TAG: 0, _0: distFromBottom }   // NearTop(dist)
                            : { TAG: 1, _0: distFromBottom };  // Middle(dist)
```

Dịch ra kiểu TypeScript:

```ts
type Position =
  | 'AtBottom'                 // 0: ở đáy, không còn tin mới hơn chưa tải
  | 'AtBottomWithMoreAfter'    // 1: ở đáy nhưng phía sau còn tin (đang xem lịch sử, nhảy tới tin cũ)
  | { NearTop: number }        // ở đỉnh, lưu khoảng cách tới ĐÁY
  | { Middle: number };        // ở giữa, lưu khoảng cách tới ĐÁY
```

Dung sai 20px được export thành hằng `scrollTolerance = 20`. Facebook có 4 trạng thái; bản viết lại bên dưới gộp hai trạng thái "ở đáy" làm một, còn 3.

Điểm mấu chốt: vị trí được lưu dưới dạng **khoảng cách tới đáy**, không phải `scrollTop`. Khi tin cũ chèn lên trên, `scrollHeight` tăng, nhưng khoảng cách từ chỗ đang xem tới đáy **không đổi**. Khôi phục khoảng cách đó là giữ nguyên chỗ đang đọc.

### Sự kiện theo cạnh (edge-triggered)

Hàm cập nhật không gọi "tải tin cũ" mỗi khi thấy đang ở đỉnh. Nó so **trạng thái cũ với trạng thái mới**:

- Đi từ AtBottom hoặc Middle **vào** NearTop: `dispatch(2)` (tải tin cũ).
- Đi từ NearTop hoặc Middle **về** đáy: `dispatch(1)` (về đáy: đánh dấu đã đọc, tải tin mới hơn nếu có).
- Đứng yên ở đỉnh, cuộn qua lại vài pixel: không gọi gì thêm.

Đây là khác biệt giữa "level-triggered" (cứ ở trạng thái X là gọi) và "edge-triggered" (chỉ gọi khi **chuyển** vào X). Kiểu thứ hai tự nhiên chống gọi trùng mà không cần cờ `isLoading`.

```mermaid
stateDiagram-v2
  [*] --> AtBottom
  AtBottom --> Middle: kéo lên
  Middle --> NearTop: chạm đỉnh / tải tin cũ
  NearTop --> Middle: tin cũ chèn vào, vị trí được giữ
  Middle --> AtBottom: kéo xuống / đánh dấu đã đọc
  NearTop --> AtBottom: nhảy xuống cuối
  AtBottom --> AtBottom: tin mới đến, dính đáy
```

### Khôi phục sau mỗi lần render

```js
useLayoutEffect(() => {                         // không có deps: chạy sau MỌI lần render
  const s = state.current;
  if (typeof s === "number") { if (s === 0) scrollToBottom() }    // AtBottom: dính đáy
  else if (s.TAG /* Middle */ && gkx("1600131")) { /* bỏ qua */ }
  else scrollTop = scrollHeight - (s._0 + clientHeight);          // giữ khoảng cách tới đáy
});
```

- `useLayoutEffect` chạy **sau khi DOM đã đổi nhưng trước khi trình duyệt vẽ**. Người dùng không bao giờ thấy khung hình "đang nhảy".
- `AtBottomWithMoreAfter` thì **không** dính đáy: đang xem lịch sử (ví dụ vừa nhảy tới một tin cũ được trả lời), tin mới đến không nên kéo người dùng đi.
- `Middle`: mặc định cũng giữ khoảng cách tới đáy, **trừ khi** gatekeeper `1600131` bật. Lý do có cờ này: đang đọc ở giữa mà có tin mới thêm vào **cuối**, giữ khoảng cách tới đáy sẽ làm nội dung đang đọc **trôi lên** đúng bằng chiều cao tin mới. Việc đặt nó sau một gatekeeper cho thấy Facebook đang thử bỏ hành vi đó. Bản viết lại bên dưới giải quyết triệt để chuyện này.

Một layout effect khác lo trường hợp **nội dung chưa lấp đầy khung**:

```js
useLayoutEffect(() => {
  if (el.clientHeight > 0 && Math.abs(el.clientHeight - el.scrollHeight) < 20) dispatch(0);
});
```

Cuộc trò chuyện mới chỉ có 3 tin thì không có thanh cuộn, người dùng không thể "kéo lên đỉnh" để kích hoạt tải tin cũ, nên phải tự tải tiếp.

### Lắng nghe gì, và tại sao lạ vậy

```js
const disableElasticScroll = document.body.style.overscrollBehavior === undefined
                          && document.body.style.scrollBoundaryBehavior === undefined;
// …
mouseenter -> addEventListener("wheel", onWheel, { passive: !disableElasticScroll })  // ưu tiên "mousewheel" nếu trình duyệt có
mouseleave -> removeEventListener("wheel", …)
scroll     -> throttle(update, 50, { trailing: true })   // chỉ khi gkx("1283332") bật
mouseup / mousedown -> update
```

- CSS của khung có `overscroll-behavior: contain`. Cuộn tới mép thì dừng, không "chain" sang trang cha. Trình duyệt **không** hỗ trợ thuộc tính này (cả tên cũ `scroll-boundary-behavior`) thì `onWheel` gọi `preventDefault()` khi cuộn xuống lúc đã ở đáy hoặc cuộn lên lúc đã ở đỉnh. Ngày nay mọi trình duyệt chính đều có `overscroll-behavior` (Safari từ bản 16, 2022), nên nhánh này chỉ còn ý nghĩa với trình duyệt cũ.
- Listener `wheel` phải **non-passive** mới gọi được `preventDefault`. Mà listener non-passive làm trình duyệt phải chờ JS trước khi cuộn (chậm). Vì vậy họ chỉ gắn nó khi chuột **đang ở trên** khung chat (`mouseenter`), và gỡ khi rời đi. Trình duyệt hỗ trợ `overscroll-behavior` thì listener là passive.
- Sự kiện `scroll` được throttle 50ms (trailing) và nằm sau một gatekeeper. Khi cờ tắt, vị trí chỉ được cập nhật ở `wheel`, `mouseup`, `mousedown`. Có lẽ họ đang đo xem nghe `scroll` có đáng không (suy đoán).

Ngoài ra, scroller còn cung cấp `BaseScrollableAreaContext`. Nhờ đó popover, tooltip mở bên trong khung chat biết container cuộn của mình để tự định vị lại khi cuộn (xem [bài #12 về popover](/blogs/facebook-popover-tooltip)). Imperative handle có `scrollToBottom()` và `scrollToElement(el, offset)`: `scrollIntoView` rồi `scrollBy(0, -offset)` để chừa chỗ cho header.

## Bên trong trình duyệt: scroll anchoring và column-reverse

Hai "đường tắt" hay được nhắc tới, kèm lý do Facebook không dựa vào chúng:

**Scroll anchoring (`overflow-anchor`).** Chrome và Firefox có cơ chế tự giữ vị trí khi nội dung phía trên thay đổi. Trình duyệt chọn một "anchor node" đang hiện trong khung, và sau mỗi lần layout dịch `scrollTop` để anchor đứng yên. Đó chính xác là thứ ta cần khi chèn tin cũ. Nhưng:

- Hỗ trợ không đồng đều: Safari có một thời gian dài không hỗ trợ `overflow-anchor` (tình trạng hiện tại: xem [caniuse](https://caniuse.com/css-overflow-anchor)). Khung chat phải chạy đúng trên iPhone.
- Trình duyệt tự chọn anchor theo heuristic, và nó không biết khái niệm "dính đáy".
- Code tự khôi phục vị trí **cộng** với anchoring của trình duyệt có thể bù hai lần.

Vì vậy bản viết lại đặt `overflow-anchor: none` cho khung chat và tự làm mọi thứ, để hành vi giống nhau ở mọi nơi. Khung "ngây thơ" trong demo cũng đặt `overflow-anchor: none` để mô phỏng trình duyệt không có anchoring.

**`flex-direction: column-reverse`.** Đảo chiều flex làm vị trí cuộn bắt đầu từ đáy: tin mới tự dính đáy và chèn tin cũ (vào cuối DOM) không làm nhảy. Rất gọn, nhưng:

- Thứ tự DOM ngược với thứ tự hiển thị. Trình đọc màn hình đọc từ tin mới nhất ngược lên, bôi đen chữ hay `Tab` cũng đi ngược. Muốn đúng phải đảo cả dữ liệu.
- `scrollTop` mang giá trị âm (0 là đáy). Các trình duyệt từng không thống nhất chuyện này, và code nào giả định `scrollTop >= 0` đều sai.
- Vẫn phải tự xử lý "ở giữa thì đừng nhảy khi có tin mới".

## Viết lại: thay "khoảng cách tới đáy" bằng anchor

Khi viết demo, mình làm theo đúng Facebook (lưu khoảng cách tới đáy cho NearTop) và gặp ngay một lỗi. Lỗi này đến từ cách **demo** hiển thị trạng thái tải, không phải lỗi của Messenger, nhưng rất dễ gặp trong app của bạn. Ngay khi chạm đỉnh, demo hiện dòng "Đang tải tin cũ…" ở đầu danh sách, **bên trong vùng cuộn, phía trên tin nhắn**. Dòng này cao khoảng 30px, chèn lên trên, nên vị trí được khôi phục về `scrollTop ≈ 30`, tức là trạng thái chuyển từ NearTop sang **Middle**. 800ms sau, tin cũ về, nhưng lúc này đang là Middle nên không còn được giữ chỗ. Đo bằng Playwright: tin `#1000` nhảy từ **11px xuống 529px**.

Nói cách khác, chiến lược "giữ khoảng cách tới đáy" chỉ đúng khi mọi thay đổi xảy ra **phía trên** chỗ đang đọc. Còn chiến lược "không làm gì" chỉ đúng khi mọi thay đổi xảy ra **phía dưới**. Spinner, ảnh tải chậm, tin mới đều có thể xảy ra ở cả hai phía.

Lời giải là **neo theo phần tử** (giống tinh thần của scroll anchoring):

- Mỗi lần cuộn, ghi lại **tin nhắn đầu tiên đang hiện** ở mép trên khung và khoảng cách của nó tới mép trên.
- Sau khi DOM đổi, đo lại xem tin đó bị đẩy đi bao nhiêu và cộng đúng bấy nhiêu vào `scrollTop`.
- Đang ở đáy thì vẫn dính đáy như Facebook.

Sau khi sửa, cùng kịch bản đó tin `#1000` đứng ở 11px → 10px (lệch 1px do làm tròn).

Tìm anchor: con đầu tiên còn nhìn thấy ở mép trên khung.

```ts title=src/lib/useChatScroller.ts

/** Phần tử "neo": con đầu tiên còn nhìn thấy ở mép trên khung, kèm khoảng cách tới mép trên. */
interface Anchor {
  element: Element;
  offset: number;
}

function findAnchor(scroller: HTMLElement, content: Element, itemSelector?: string): Anchor | null {
  const viewportTop = scroller.getBoundingClientRect().top;
  const children = itemSelector ? content.querySelectorAll(`:scope > ${itemSelector}`) : content.children;
  // Tìm nhị phân con đầu tiên có đáy nằm dưới mép trên khung: O(log n) lần đo.
  // GIẢ ĐỊNH: vị trí các con tăng dần theo thứ tự DOM. Header sticky (luôn dính ở trên),
  // phần tử display:none (rect = 0) hay absolute phá giả định này -> loại bằng itemSelector.
  let lo = 0;
  let hi = children.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (children[mid].getBoundingClientRect().bottom > viewportTop) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  if (found === -1) return null;
  const element = children[found];
  return { element, offset: element.getBoundingClientRect().top - viewportTop };
}
```

Khôi phục và cập nhật vị trí:

```ts title=src/lib/useChatScroller.ts
  /** Đặt lại scrollTop theo vị trí đã ghi nhận. Idempotent: gọi nhiều lần không sao. */
  const restore = useCallback(() => {
    if (!scroller) return;
    const pos = positionRef.current;
    if (pos.kind === 'bottom') {
      scroller.scrollTop = scroller.scrollHeight;
      return;
    }
    const anchor = anchorRef.current;
    if (anchor && anchor.element.isConnected) {
      // Neo bị đẩy xuống/kéo lên bao nhiêu thì bù scrollTop đúng bấy nhiêu.
      const viewportTop = scroller.getBoundingClientRect().top;
      const delta = anchor.element.getBoundingClientRect().top - viewportTop - anchor.offset;
      if (Math.abs(delta) >= 1) scroller.scrollTop += delta;
    } else {
      // Không còn neo (bị xoá): quay về cách của Facebook, giữ khoảng cách tới đáy.
      scroller.scrollTop = scroller.scrollHeight - (pos.fromBottom + scroller.clientHeight);
    }
  }, [scroller]);

  // Ghi nhận vị trí + neo, và bắn sự kiện khi CHUYỂN trạng thái (edge-triggered, giống Facebook):
  // nằm yên ở đỉnh không gọi tải tin cũ liên tục.
  const update = useCallback(() => {
    if (!scroller) return;
    const prev = positionRef.current;
    const next = measureChatPosition(scroller, threshold);
    positionRef.current = next;
    const contentEl = getContent();
    anchorRef.current =
      next.kind === 'bottom' || !contentEl ? null : findAnchor(scroller, contentEl, itemSelector);
    if (next.kind !== prev.kind) optionsRef.current.onPositionChange?.(next);
    if (next.kind === 'top' && prev.kind !== 'top') optionsRef.current.onReachTop?.();
    if (next.kind === 'bottom' && prev.kind !== 'bottom') optionsRef.current.onReachBottom?.();
  }, [scroller, threshold, getContent, itemSelector]);
```

::: spoiler Xem toàn bộ src/lib/useChatScroller.ts

```ts title=src/lib/useChatScroller.ts
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Khung cuộn cho chat (ý tưởng từ MWChatConversationScroller của Facebook Messenger):
 * - đang ở đáy thì tin mới đến vẫn dính đáy
 * - nội dung phía trên thay đổi (tải tin cũ, spinner, ảnh tải xong) thì chỗ đang đọc đứng yên
 * - chạm đỉnh -> gọi tải tin cũ; nội dung chưa lấp đầy khung -> gọi tải thêm ngay
 * - cuộn tới mép không "lan" ra trang bên ngoài (overscroll containment)
 *
 * Bí quyết: ghi lại vị trí TRƯỚC khi nội dung đổi (trong sự kiện scroll), rồi khôi phục SAU khi
 * DOM đổi nhưng TRƯỚC khi trình duyệt vẽ (useLayoutEffect / ResizeObserver).
 */

export type ChatScrollPosition =
  | { kind: 'bottom' }
  | { kind: 'top'; fromBottom: number }
  | { kind: 'middle'; fromBottom: number };

export interface UseChatScrollerOptions {
  /** vừa cuộn chạm đỉnh: tải tin cũ hơn */
  onReachTop?: () => void;
  /** vừa cuộn về đáy: đánh dấu đã đọc, tải tin mới hơn… */
  onReachBottom?: () => void;
  /** nội dung chưa đủ cao để cuộn: nên tải thêm luôn (người dùng không thể cuộn để kích hoạt) */
  onNotFilled?: () => void;
  onPositionChange?: (position: ChatScrollPosition) => void;
  /** dung sai coi là "ở đáy" / "ở đỉnh", Facebook dùng 20px */
  threshold?: number;
  /** theo dõi thay đổi kích thước không qua React (ảnh tải xong, bàn phím mobile bật lên…) */
  observeResize?: boolean;
  /**
   * Chỉ chọn neo trong các con khớp selector (vd '[data-msg]'). Cần khi danh sách có phần tử
   * không nằm theo thứ tự dọc thông thường: header ngày `position: sticky`, phần tử ẩn hoặc
   * định vị tuyệt đối. Mặc định: mọi con trực tiếp.
   */
  itemSelector?: string;
}

export function measureChatPosition(el: HTMLElement, threshold = 20): ChatScrollPosition {
  const fromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
  if (fromBottom <= threshold) return { kind: 'bottom' };
  if (el.scrollTop <= threshold) return { kind: 'top', fromBottom };
  return { kind: 'middle', fromBottom };
}

/** Phần tử "neo": con đầu tiên còn nhìn thấy ở mép trên khung, kèm khoảng cách tới mép trên. */
interface Anchor {
  element: Element;
  offset: number;
}

function findAnchor(scroller: HTMLElement, content: Element, itemSelector?: string): Anchor | null {
  const viewportTop = scroller.getBoundingClientRect().top;
  const children = itemSelector ? content.querySelectorAll(`:scope > ${itemSelector}`) : content.children;
  // Tìm nhị phân con đầu tiên có đáy nằm dưới mép trên khung: O(log n) lần đo.
  // GIẢ ĐỊNH: vị trí các con tăng dần theo thứ tự DOM. Header sticky (luôn dính ở trên),
  // phần tử display:none (rect = 0) hay absolute phá giả định này -> loại bằng itemSelector.
  let lo = 0;
  let hi = children.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (children[mid].getBoundingClientRect().bottom > viewportTop) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  if (found === -1) return null;
  const element = children[found];
  return { element, offset: element.getBoundingClientRect().top - viewportTop };
}

const supportsOverscrollBehavior =
  typeof CSS !== 'undefined' && CSS.supports?.('overscroll-behavior', 'contain');

export function useChatScroller<S extends HTMLElement = HTMLDivElement, C extends HTMLElement = HTMLDivElement>(
  options: UseChatScrollerOptions = {},
) {
  const { threshold = 20, observeResize = true, itemSelector } = options;
  const [scroller, setScroller] = useState<S | null>(null);
  const [content, setContent] = useState<C | null>(null);
  // Chat mở ra là đang ở tin mới nhất.
  const positionRef = useRef<ChatScrollPosition>({ kind: 'bottom' });
  const anchorRef = useRef<Anchor | null>(null);

  // "latest ref" cho các callback: listener gắn 1 lần nhưng luôn gọi bản mới nhất
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const getContent = useCallback(
    () => content ?? scroller?.firstElementChild ?? null,
    [content, scroller],
  );

  /** Đặt lại scrollTop theo vị trí đã ghi nhận. Idempotent: gọi nhiều lần không sao. */
  const restore = useCallback(() => {
    if (!scroller) return;
    const pos = positionRef.current;
    if (pos.kind === 'bottom') {
      scroller.scrollTop = scroller.scrollHeight;
      return;
    }
    const anchor = anchorRef.current;
    if (anchor && anchor.element.isConnected) {
      // Neo bị đẩy xuống/kéo lên bao nhiêu thì bù scrollTop đúng bấy nhiêu.
      const viewportTop = scroller.getBoundingClientRect().top;
      const delta = anchor.element.getBoundingClientRect().top - viewportTop - anchor.offset;
      if (Math.abs(delta) >= 1) scroller.scrollTop += delta;
    } else {
      // Không còn neo (bị xoá): quay về cách của Facebook, giữ khoảng cách tới đáy.
      scroller.scrollTop = scroller.scrollHeight - (pos.fromBottom + scroller.clientHeight);
    }
  }, [scroller]);

  // Ghi nhận vị trí + neo, và bắn sự kiện khi CHUYỂN trạng thái (edge-triggered, giống Facebook):
  // nằm yên ở đỉnh không gọi tải tin cũ liên tục.
  const update = useCallback(() => {
    if (!scroller) return;
    const prev = positionRef.current;
    const next = measureChatPosition(scroller, threshold);
    positionRef.current = next;
    const contentEl = getContent();
    anchorRef.current =
      next.kind === 'bottom' || !contentEl ? null : findAnchor(scroller, contentEl, itemSelector);
    if (next.kind !== prev.kind) optionsRef.current.onPositionChange?.(next);
    if (next.kind === 'top' && prev.kind !== 'top') optionsRef.current.onReachTop?.();
    if (next.kind === 'bottom' && prev.kind !== 'bottom') optionsRef.current.onReachBottom?.();
  }, [scroller, threshold, getContent, itemSelector]);

  // Sau MỖI lần render (không deps): DOM đã đổi nhưng chưa vẽ -> khôi phục vị trí.
  useLayoutEffect(() => {
    if (!scroller) return;
    restore();
    if (scroller.clientHeight > 0 && Math.abs(scroller.scrollHeight - scroller.clientHeight) < threshold) {
      optionsRef.current.onNotFilled?.();
    }
  });

  useEffect(() => {
    if (!scroller) return;
    // Tắt scroll anchoring của trình duyệt: ta tự neo, để hành vi giống nhau trên mọi trình
    // duyệt (hỗ trợ overflow-anchor không đồng đều, Safari có thời gian dài không có) và để
    // không bị bù hai lần.
    scroller.style.overflowAnchor = 'none';
    scroller.style.overscrollBehavior = 'contain';

    // Chỉ đọc layout (không ghi), nên chạy ở mỗi sự kiện scroll vẫn rẻ.
    scroller.addEventListener('scroll', update, { passive: true });

    // Fallback cho trình duyệt CŨ không có overscroll-behavior (vd Safari < 16): chặn wheel ở
    // mép bằng preventDefault. Trình duyệt hiện đại không chạy nhánh này. Listener non-passive
    // làm chậm cuộn, nên chỉ gắn khi chuột đang ở trên khung chat.
    const onWheel = (event: WheelEvent) => {
      const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 0;
      if ((event.deltaY > 0 && atBottom) || (event.deltaY < 0 && scroller.scrollTop <= 0)) {
        event.preventDefault();
      }
    };
    const onEnter = () => scroller.addEventListener('wheel', onWheel, { passive: false });
    const onLeave = () => scroller.removeEventListener('wheel', onWheel);
    if (!supportsOverscrollBehavior) {
      scroller.addEventListener('mouseenter', onEnter);
      scroller.addEventListener('mouseleave', onLeave);
    }

    return () => {
      scroller.removeEventListener('scroll', update);
      scroller.removeEventListener('mouseenter', onEnter);
      scroller.removeEventListener('mouseleave', onLeave);
      onLeave();
    };
  }, [scroller, update]);

  // Kích thước đổi KHÔNG qua React render: ảnh/video tải xong, font tải xong, bàn phím ảo bật
  // làm khung chat thấp đi… useLayoutEffect không chạy trong các trường hợp này.
  useEffect(() => {
    if (!scroller || !observeResize || typeof ResizeObserver === 'undefined') return;
    // Callback của ResizeObserver chạy sau layout, trước paint -> sửa vị trí không bị giật.
    const observer = new ResizeObserver(() => restore());
    observer.observe(scroller);
    const contentEl = getContent();
    if (contentEl) observer.observe(contentEl);
    return () => observer.disconnect();
  }, [scroller, observeResize, restore, getContent]);

  const scrollToBottom = useCallback(() => {
    if (!scroller) return;
    positionRef.current = { kind: 'bottom' };
    anchorRef.current = null;
    scroller.scrollTop = scroller.scrollHeight;
  }, [scroller]);

  return {
    /** gắn vào phần tử có overflow-y: auto */
    scrollerRef: setScroller,
    /** gắn vào phần tử bọc trực tiếp danh sách tin nhắn (mỗi con = một tin) */
    contentRef: setContent,
    scrollToBottom,
    getPosition: () => positionRef.current,
  };
}
```

:::

## Đi qua code

**1. `measureChatPosition`.** Giữ đúng ba trạng thái và dung sai 20px của Facebook. Biến thể `AtBottomWithMoreAfter` được bỏ cho gọn: nếu bạn có tính năng "nhảy tới tin cũ" thì nên thêm lại, vì lúc đó đáy khung chưa phải tin mới nhất.

**2. `update`, chạy ở mỗi sự kiện `scroll`.**

- Đo trạng thái mới và ghi anchor.
- Nếu trạng thái **đổi** thì gọi `onPositionChange`. Nếu đổi **vào** đỉnh thì gọi `onReachTop`, nếu đổi **về** đáy thì gọi `onReachBottom`.
- Không throttle như Facebook. Hàm chỉ **đọc** layout (`scrollTop`, `scrollHeight`, `getBoundingClientRect`), không ghi gì, nên không gây "layout thrashing". Sự kiện `scroll` vốn chỉ bắn tối đa một lần mỗi khung hình. Throttle còn có cái giá: trong 50ms trễ, một lần render có thể khôi phục theo vị trí **cũ**.

**3. `findAnchor`.** Tìm nhị phân trên các con của `content` cho con đầu tiên có `bottom > mép trên khung`. Với 5.000 tin nhắn chỉ cần khoảng 13 lần đo thay vì 5.000. Đây là lý do hook cần `contentRef` gắn vào phần tử bọc **trực tiếp** các tin nhắn. Tìm nhị phân có một giả định: vị trí các con **tăng dần theo thứ tự DOM**. Header ngày `position: sticky` (luôn dính ở trên), phần tử `display: none` (rect bằng 0) hay định vị tuyệt đối phá giả định đó và có thể làm chọn sai anchor. Khi có những phần tử như vậy, truyền `itemSelector` (vd `'[data-msg]'`) để chỉ xét tin nhắn. Scroll anchoring của trình duyệt cũng loại phần tử sticky/fixed khỏi danh sách ứng viên anchor vì cùng lý do.

**4. `restore`.**

- `bottom` → `scrollTop = scrollHeight`.
- Còn lại: nếu anchor còn trong DOM, bù đúng độ lệch. Nếu anchor đã bị xoá (ví dụ tin bị thu hồi), quay về cách của Facebook: giữ khoảng cách tới đáy.
- Hàm **idempotent**: gọi lại khi không có gì đổi thì độ lệch bằng 0, không làm gì. Nhờ vậy gọi nó ở mỗi lần render và mỗi callback ResizeObserver đều an toàn.

**5. `useLayoutEffect` không deps.** Giống Facebook: sau mỗi lần render, trước khi vẽ. Kèm kiểm tra "chưa lấp đầy" để gọi `onNotFilled`.

**6. ResizeObserver: phần Facebook không có.** Ảnh trong tin nhắn tải xong, font web tải xong, bàn phím ảo bật lên làm khung chat thấp đi… tất cả đều đổi chiều cao **mà không qua React render**, nên `useLayoutEffect` không chạy. ResizeObserver theo dõi cả khung (`clientHeight` đổi) lẫn phần nội dung (chiều cao đổi). Callback của nó chạy **sau layout, trước paint**, trong cùng bước "update the rendering" của event loop, nên sửa vị trí ở đó cũng không bị giật. Demo: bật "Tin mới có ảnh tải chậm", đứng ở đáy. Có ResizeObserver thì vẫn dính đáy. Tắt đi thì sau khi ảnh tải xong, khung lệch khỏi đáy **140px** (đúng chiều cao ảnh).

**7. `overflow-anchor: none` và `overscroll-behavior: contain`** được đặt từ JS để hook tự đủ, không phụ thuộc CSS bên ngoài. Fallback `wheel` giữ đúng mẹo của Facebook (chỉ gắn listener non-passive khi chuột ở trên khung), nhưng chỉ chạy trên trình duyệt cũ không có `overscroll-behavior`. Nếu không cần hỗ trợ Safari < 16, có thể xoá hẳn nhánh này.

**Khác bản gốc:** neo theo phần tử thay vì khoảng cách tới đáy; 3 trạng thái thay vì 4; nghe `scroll` không throttle; thêm ResizeObserver; có tuỳ chọn `itemSelector`.

## Tại sao không làm cách khác?

**"Dùng `useEffect` thay `useLayoutEffect`?"** `useEffect` chạy **sau** khi trình duyệt đã vẽ. Người dùng sẽ thấy một khung hình nội dung bị đẩy đi, rồi khung sau mới nhảy về: đúng cái "giật" ta đang muốn tránh.

**"Lưu `scrollTop` thay vì khoảng cách tới đáy hay anchor?"** `scrollTop` đo từ **đỉnh**. Chèn tin cũ lên đỉnh làm mọi thứ dịch xuống, nên `scrollTop` cũ chỉ vào nội dung khác. Đó chính là lỗi của cách ngây thơ.

**"Sao không gọi tải tin cũ ở `IntersectionObserver` trên tin đầu tiên?"** Hoàn toàn được, và nhẹ hơn (xem [bài #1](/blogs/facebook-shared-intersection-observer)). Nhưng bạn vẫn cần nghe `scroll` để biết vị trí (đáy/giữa) và để ghi anchor, nên gộp lại một chỗ cho đơn giản.

**"Virtual list?"** Cuộc trò chuyện hàng chục nghìn tin thì nên ảo hoá. Nguyên lý giữ chỗ vẫn y hệt: đo chiều cao các mục mới, bù `scrollTop`. Các thư viện như react-virtuoso có sẵn tuỳ chọn `followOutput` (dính đáy) và `firstItemIndex` (chèn mục phía trên mà không nhảy) cho đúng bài toán này.

## Edge case và cạm bẫy

- **`scroll-behavior: smooth` trên khung chat.** Mọi lần gán `scrollTop` để khôi phục sẽ biến thành một animation cuộn, và nội dung "trượt" về chỗ cũ thay vì đứng yên. Giữ `scroll-behavior: auto` cho container này. Muốn cuộn mượt khi bấm "↓ Xuống cuối" thì gọi `scrollTo({ behavior: 'smooth' })` riêng lúc đó.
- **Trang tin cũ quá ngắn.** Tải 15 tin cũ mà tổng cao chưa tới 20px (hiếm, nhưng có thể với tin hệ thống) thì sau khi chèn vẫn đang ở đỉnh. Trạng thái không **đổi** nên `onReachTop` không bắn lại. Hãy tải đủ nhiều tin mỗi trang, hoặc sau khi tải xong tự kiểm tra `getPosition()` và gọi tiếp.
- **`onNotFilled` gọi ở mọi lần render** khi nội dung chưa đầy. Phía gọi phải tự chặn bằng cờ "đang tải" (demo dùng `loadingRef`). Facebook cũng vậy: reducer phía sau tự bỏ qua khi đang tải.
- **Ảnh không có kích thước.** ResizeObserver cứu được vị trí, nhưng tốt nhất vẫn là gửi kèm `width`/`height` từ server và đặt `aspect-ratio` cho khung ảnh. Chiều cao đúng ngay từ đầu thì không có gì phải bù.
- **iOS và cuộn quán tính.** Gán `scrollTop` trong lúc người dùng đang cuộn quán tính (momentum) trên iOS có thể làm cú cuộn khựng lại. Nếu có thể, hãy dời việc chèn tin cũ cho tới khi cuộn dừng hẳn.
- **Header ngày (sticky), phần tử ẩn hoặc absolute trong danh sách.** Chúng phá giả định "vị trí tăng dần theo thứ tự DOM" của tìm nhị phân, nên có thể làm chọn sai anchor (không chỉ là đo một phần tử vô nghĩa). Đánh dấu tin nhắn bằng `data-msg` và truyền `itemSelector: '[data-msg]'`.

## Kiểm thử

Kiểm bằng trình duyệt thật là đáng tin nhất, vì jsdom không tính layout.

::: spoiler Ví dụ test Playwright (bản phác, không có trong repo)

```ts
import { expect, test } from '@playwright/test';

test('tải tin cũ không làm nhảy tin đang đọc', async ({ page }) => {
  await page.goto('/#/chat-scroller');
  const chat = page.getByTestId('chat');
  const topOf = (id: number) =>
    chat.evaluate((el, id) => {
      const msg = [...el.querySelectorAll('.cs-msg')].find((m) => m.textContent!.startsWith(`#${id} `))!;
      return msg.getBoundingClientRect().top - el.getBoundingClientRect().top;
    }, id);

  await page.getByLabel('Tin mới mỗi 2 giây').uncheck(); // tắt tin mới cho dễ đếm
  await chat.evaluate((el) => (el.scrollTop = 0)); // chạm đỉnh -> tải tin cũ
  const before = await topOf(1000);
  await expect(chat.locator('.cs-msg')).toHaveCount(35); // 20 tin ban đầu + 15 tin cũ vừa tải
  expect(Math.abs((await topOf(1000)) - before)).toBeLessThanOrEqual(1);
});

test('đang ở đáy thì tin mới dính đáy', async ({ page }) => {
  await page.goto('/#/chat-scroller');
  await page.waitForTimeout(4500); // 2 tin mới đến
  const fromBottom = await page
    .getByTestId('chat')
    .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  expect(fromBottom).toBeLessThanOrEqual(1);
});
```

:::

## Dùng trong dự án

Kết hợp với `useInfiniteQuery` của TanStack Query, theo chiều ngược (trang mới nhất trước):

```tsx
function Conversation({ threadId }: { threadId: string }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['messages', threadId],
    queryFn: ({ pageParam }) => fetchMessages(threadId, pageParam), // trang cũ hơn
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.olderCursor,
  });
  const loadOlder = () => hasNextPage && !isFetchingNextPage && fetchNextPage();
  const { scrollerRef, contentRef } = useChatScroller({
    onReachTop: loadOlder,
    onNotFilled: loadOlder,
    itemSelector: '[data-msg]', // chỉ tin nhắn làm anchor, bỏ qua spinner/header ngày
  });

  // pages[0] là trang mới nhất -> đảo lại để tin cũ nằm trên
  const messages = data?.pages.slice().reverse().flatMap((p) => p.items) ?? [];
  return (
    <div ref={scrollerRef} style={{ overflowY: 'auto', height: '100%' }}>
      <div ref={contentRef}>
        {isFetchingNextPage && <div className='spinner'>Đang tải tin cũ…</div>}
        {messages.map((m) => (
          // con TRỰC TIẾP của contentRef: đừng bọc thêm wrapper quanh từng tin
          <MessageRow key={m.id} message={m} data-msg />
        ))}
      </div>
    </div>
  );
}
```

Spinner "Đang tải tin cũ…" cứ đặt thoải mái ở đầu danh sách: anchor lo phần còn lại. Lưu ý mỗi tin (`MessageRow`, render ra phần tử có `data-msg`) phải là con **trực tiếp** của phần tử gắn `contentRef`; nếu bọc thêm một lớp, `findAnchor` sẽ không thấy tin nào.

---

Bài này thuộc series **[Học từ mã nguồn Facebook](/series/facebook)** (106 bài, đọc theo thứ tự).

::: spoiler Xem nhanh danh sách bài trong series

*Phần 1*

- [Mở đầu: cách đọc code minify của Facebook](/blogs/learn-from-facebook-source-code)
- [#1 Dùng chung IntersectionObserver + infinite scroll](/blogs/facebook-shared-intersection-observer)
- [#2 useViewportDuration: đo thời gian thực sự được xem](/blogs/facebook-use-viewport-duration)
- [#3 Preload code + data khi hover](/blogs/facebook-preload-on-hover)
- [#4 Toast manager với external store](/blogs/facebook-toast-manager)
- [#5 Network status + heartbeat backoff](/blogs/facebook-network-status-heartbeat)
- [#6 ErrorGuard: bắt lỗi theo ngữ cảnh](/blogs/facebook-error-guard)
- [#7 Banzai: gom log theo lô + sendBeacon](/blogs/facebook-batch-logger)
- [#8 Focus trap + Esc theo layer](/blogs/facebook-focus-trap)

*Phần 2*

- [#9 Mẹo calc(… * 9999): container query, line-clamp, mũi tên carousel bằng CSS](/blogs/facebook-css-9999-trick)
- [#10 Thanh cuộn tuỳ biến bằng CSS 3D](/blogs/facebook-css-3d-scrollbar)
- [#11 Modal cuộn bằng window, giữ vị trí trang nền](/blogs/facebook-document-scroll-modal)
- [#12 Popover, tooltip group và hovercard](/blogs/facebook-popover-tooltip)
- [#13 Primitive Pressable + focus-visible](/blogs/facebook-pressable)
- [#14 Tab "Xem thêm" + sticky header bằng IntersectionObserver](/blogs/facebook-priority-tabs-sticky-header)
- [#15 Avatar khoét mask, gradient Messenger, skeleton steps()](/blogs/facebook-visual-tricks)
- **#16 Khung chat không giật** (bài này)
- [#17 Thuật toán chọn bố cục collage ảnh](/blogs/facebook-photo-collage-layout)
- [#18 Keep-alive tab trong SPA](/blogs/facebook-keep-alive-tabs)
- [#19 Tự đo Visual Completion & interaction tracing](/blogs/facebook-visual-completion)
- [#20 Router SPA bền bỉ & tải chunk có retry](/blogs/facebook-spa-router-resilient-loading)

*Phần 3*

- [#21 Smart Compose: gợi ý chữ mờ khi gõ](/blogs/facebook-smart-compose-ghost-text)
- [#22 MQTT ngay trong trình duyệt, tự chuyển sang long-poll](/blogs/facebook-mqtt-in-browser)
- [#23 Đo thời gian dùng bằng bitmap 64 giây](/blogs/facebook-time-spent-bitmap)
- [#24 Bảng reaction nhấn giữ rồi trượt](/blogs/facebook-reaction-press-slide)
- [#25 Tìm kiếm gấp dấu, phiên âm và highlight đầu từ](/blogs/facebook-search-diacritics-tokenize)
- [#26 Ring buffer biết trace nào đã mất log](/blogs/facebook-trace-ring-buffer)
- [#27 Engine animation JS: một vòng rAF và solver cubic-bezier](/blogs/facebook-keyframes-loop-cubic-bezier)
- [#28 Bootloader: bitmap tài nguyên đã tải, chỉ reload khi cần](/blogs/facebook-bootloader-bitmap-consistency)
- [#29 Nhận biết click do screen reader tạo ra](/blogs/facebook-virtual-cursor-detection)
- [#30 Tải trước feed theo chất lượng mạng, đoán hạng thiết bị](/blogs/facebook-network-aware-prefetch)
- [#31 Hàng đợi gửi tin chat giữ đúng thứ tự](/blogs/facebook-ordered-send-queue)
- [#32 Gộp lời gọi API trong cùng một tick](/blogs/facebook-api-batcher)
- [#33 Resize ảnh trong pool Web Worker](/blogs/facebook-jpeg-resize-worker-pool)
- [#34 Crop ảnh theo nhiều khuôn mặt](/blogs/facebook-face-aware-crop)
- [#35 Kéo-thả sắp xếp và vùng thả file không nhấp nháy](/blogs/facebook-flicker-free-drag-drop)
- [#36 Tiện ích UI: fade-out, sticky event, hàm huỷ được](/blogs/facebook-ui-utility-hooks)
- [#37 Hạ tầng nhỏ: cookie, hash lỗi, prefetch khi chuột dừng](/blogs/facebook-small-infra-cookie-hash-idle)

*Phần 4–6*

- [#38 Đồng bộ tin nhắn: phát hiện lỗ seqID và fetch bù theo tầng](/blogs/facebook-messenger-sync-seqid-gaps)
- [#39 OTID: ID tin nhắn kiểu Snowflake sinh ở client](/blogs/facebook-otid-client-snowflake)
- [#40 QPL: lấy mẫu từ lúc bắt đầu, đo RTT gửi tin đầu-cuối](/blogs/facebook-qpl-send-rtt)
- [#41 Bộ điều phối request bảy chế độ gộp và chống trùng](/blogs/facebook-request-dispatcher-modes)
- [#42 Thread list theo mốc thời gian, cookie presence có version](/blogs/facebook-threadlist-ranged-presence)
- [#43 Composer dạng plugin: reducer, dirty checker, chuỗi kiểm tra](/blogs/facebook-plugin-composer)
- [#44 Thanh toán bất đồng bộ: subscribe trước, poll dự phòng](/blogs/facebook-async-checkout)
- [#45 Validate số thẻ: sửa lỗi gõ, dải BIN, Luhn](/blogs/facebook-card-validation)
- [#46 Lịch chọn khoảng ngày: bo góc dải chọn, phím đủ bộ, RTL](/blogs/facebook-range-calendar-a11y)
- [#47 Giờ mở cửa theo tuần: qua đêm, gộp khoảng, phần bù](/blogs/facebook-weekly-hours-intervals)
- [#48 Tiến độ đăng realtime: giữ event chờ snapshot, watchdog](/blogs/facebook-realtime-publish-snapshot)
- [#49 Tiền tệ theo đơn vị nhỏ nhất và ô nhập tiền](/blogs/facebook-currency-minor-units)
- [#50 Sửa hàng loạt Empty/Uniform/Mixed, seen/read bằng 2 bit](/blogs/facebook-bulk-edit-seen-bits)
- [#51 Phát hiện script lạ hook vào hàm native](/blogs/facebook-native-hook-detection)
- [#52 localStorage tự dọn khi đầy quota](/blogs/facebook-quota-aware-storage)
- [#53 Cache tuyến do server phân giải, chờ sẵn promise](/blogs/facebook-route-cache-prefetch)
- [#54 Lưới phím mũi tên 2D và focus không làm cuộn trang](/blogs/facebook-focus-table-grid)
- [#55 Tách emoji bằng máy trạng thái](/blogs/facebook-emoji-segmentation)
- [#56 Đọc trước ghi sau trong một frame, con tự biết vị trí](/blogs/facebook-read-then-write-dom)
- [#57 Hàng đợi lệnh cho video và stream sắp lại chunk](/blogs/facebook-video-command-queue)

*Phần 7–10*

- [#58 Ước lượng băng thông EWMA: loại outlier, nhớ qua phiên](/blogs/facebook-bandwidth-ewma-estimator)
- [#59 ABR theo độ tự tin phát và cắt bậc bitrate theo MOS](/blogs/facebook-abr-playback-confidence)
- [#60 Prefetch segment dự đoán từ manifest, parse hộp sidx](/blogs/facebook-dash-predicted-segments)
- [#61 Đọc metadata MP4/MOV ngay trên client](/blogs/facebook-mp4-metadata-client)
- [#62 Upload tiếp tục được: offset, hash dedupe, phát hiện treo](/blogs/facebook-resumable-upload)
- [#63 Fenwick tree: chọn ngẫu nhiên có trọng số và offset dòng](/blogs/facebook-fenwick-weighted-random)
- [#64 Vạch trục số và trục thời gian "đẹp"](/blogs/facebook-nice-axis-ticks)
- [#65 Damerau-Levenshtein theo dải chéo và tự sửa tên gõ sai](/blogs/facebook-damerau-levenshtein)
- [#66 PRNG có seed, shuffle tái lập và lấy mẫu trace](/blogs/facebook-seeded-prng-sampling)
- [#67 Cặp min/max-heap tái dùng vị trí trong danh sách ảo](/blogs/facebook-dual-heap-buffer-set)
- [#68 Memo nhiều đối số bằng Map/WeakMap và interning object](/blogs/facebook-multikey-memo-interning)
- [#69 Thống kê cửa sổ trượt và đại số khoảng thời gian](/blogs/facebook-moving-stat-intervals)
- [#70 Int64 từ hai số 32-bit, decode UTF, offset theo code point](/blogs/facebook-int64-utf-codepoints)
- [#71 Engine múi giờ IANA trên client, phát hiện lệch giờ](/blogs/facebook-client-iana-timezone)
- [#72 Tự cài semver range](/blogs/facebook-semver-range)
- [#73 Auto-link URL, cắt chữ an toàn, giới hạn LaTeX](/blogs/facebook-autolink-safe-truncate)
- [#74 Parser query kiểu PHP chống prototype pollution](/blogs/facebook-php-query-serializer)
- [#75 Popover tự lật theo phần tràn nhỏ nhất](/blogs/facebook-popover-auto-flip)
- [#76 Tiền tố for(;;) chống JSON hijacking, đọc stream](/blogs/facebook-csrf-prefix-streaming)
- [#77 Chống lộ Referer, linkshim, xoá token trên URL](/blogs/facebook-referrer-linkshim-url-scrub)
- [#78 setImmediate bằng postMessage, gom delta chuột theo frame](/blogs/facebook-setimmediate-mouse-batching)
- [#79 Phát hiện crash qua heartbeat, dò proxy cache hỏng](/blogs/facebook-crash-heartbeat-proxy-check)
- [#80 DPR vào cookie cho ảnh @2x, che khoá trong log](/blogs/facebook-dpr-cookie-secret-redaction)
- [#81 Flux waitFor tự viết và proxy có đệm](/blogs/facebook-flux-dispatch-buffered-proxy)
- [#82 Crop đúng tỉ lệ, xoay sticker bằng ma trận](/blogs/facebook-image-crop-rotation-geometry)

*Phần 11–15*

- [#83 Chia subdomain giữa các tab bằng lease, long-poll theo bảng trạng thái](/blogs/facebook-tab-subdomain-lease-longpoll)
- [#84 MQTT QoS1: giữ publish chờ ack, gửi lại khi kết nối lại](/blogs/facebook-mqtt-qos1-republish)
- [#85 Cache Promise gộp request, cache lỗi ngắn, đua dữ liệu nhúng sẵn](/blogs/facebook-promise-cache-preload-race)
- [#86 Lịch retry: backoff có trần, Fibonacci, báo lỗi CDN mỗi N ngày](/blogs/facebook-retry-backoff-schedules)
- [#87 Giữ nguyên tham chiếu nhánh dữ liệu không đổi](/blogs/facebook-relay-recycle-nodes)
- [#88 Store optimistic: copy-on-write, rollback rồi áp lại](/blogs/facebook-relay-optimistic-store)
- [#89 Chỉ mục subscription theo record, hàng đợi task theo chiều sâu](/blogs/facebook-relay-subscription-index)
- [#90 Phân trang connection: cursor khớp đầu, edge không trùng](/blogs/facebook-relay-connection-pagination)
- [#91 Profiler kiểu middleware và memo selector có lấy mẫu kiểm tra](/blogs/facebook-profiler-middleware-memo-check)
- [#92 Đọc EBML/WebM Cues để tìm byte range của segment](/blogs/facebook-webm-ebml-cues)
- [#93 Stream HTTP Range tạm dừng được, tải tiếp đúng byte](/blogs/facebook-pausable-range-stream)
- [#94 Bảng khoảng thời gian gắn nhãn và nhảy qua lỗ buffer](/blogs/facebook-tagged-time-ranges-gaps)
- [#95 Gom chunk cho SourceBuffer, đồng bộ video bằng playbackRate](/blogs/facebook-sourcebuffer-video-sync)
- [#96 Gom tin nhắn thành cụm, vạch ngày và avatar đã xem](/blogs/facebook-message-grouping)
- [#97 Bao nhiêu tab chat vừa màn hình, chuỗi luật mở tab](/blogs/facebook-chat-tab-policy)
- [#98 Phím tắt Markdown trong editor, Backspace để hoàn tác](/blogs/facebook-markdown-shortcuts-editor)
- [#99 Offset theo code point hay UTF-16: bốn bug cùng một gốc](/blogs/facebook-codepoint-offset-bugs)
- [#100 Typeahead không nhảy: cache tiền tố, chặn reflow, khoá hover](/blogs/facebook-typeahead-stable-results)
- [#101 Hit-test trên canvas bằng phát lại path, nét đứt và cung Bézier](/blogs/facebook-canvas-hit-regions)
- [#102 Vòng tròn theo mét trên bản đồ Mercator](/blogs/facebook-mercator-meter-circles)
- [#103 Dò tính năng trình duyệt: ảnh EXIF 2×1, getter bẫy, scrollbar](/blogs/facebook-feature-probe-tricks)
- [#104 Bug định dạng số và kiểm tra dữ liệu theo locale](/blogs/facebook-locale-validation-bugs)
- [#105 Dispose cho đúng: idle callback, splice(-1), xoá nhầm key](/blogs/facebook-dispose-leak-bugs)

:::

Code + demo: [`examples/facebook-patterns`](https://github.com/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns) · [Mở trên StackBlitz](https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns)
