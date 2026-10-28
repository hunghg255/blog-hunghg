---
title: 'Học từ Facebook #21: Smart Compose, gợi ý chữ mờ khi gõ'
description: 'Cách hộp thư Pages của Facebook gợi ý phần còn lại của câu: chỉ hỏi server khi gõ xong một từ, ẩn khi gõ nhanh, và bản viết lại bằng TypeScript chạy được ngay.'
date: '2026-10-27T16:02'
series: facebook
seriesOrder: 21
author: hunghg255
image: https://blog.hunghg.me/blogs/fb-smart-compose.png
tags: ['facebook', 'typeahead', 'ux', 'react', 'performance']
---

Gmail có Smart Compose: bạn gõ "Cảm ơn bạn đã", chữ "đặt hàng" hiện mờ phía sau con trỏ, bấm Tab là nhận. Tính năng trông đơn giản, nhưng làm vội thì gặp ngay ba vấn đề:

1. **Gọi server mỗi phím gõ.** Một tin 60 ký tự thành 60 request, đa số trả về khi người dùng đã gõ tiếp.
2. **Gợi ý nhảy múa.** Gõ nhanh thì chữ mờ hiện rồi biến liên tục, gây rối mắt hơn là giúp.
3. **Gợi ý vô ích.** Đoán đúng 2 ký tự cuối của một từ thì người dùng đã gõ xong trước khi kịp nhìn.

Facebook có một bản Smart Compose cho hộp thư Pages (chủ trang trả lời tin nhắn khách) và giải cả ba vấn đề bằng vài quy tắc rất cụ thể.

> [!TIP]
> **Tóm tắt**
> - Chỉ gửi query khi text vừa kết thúc bằng "một từ + khoảng trắng". Các phím sau đó lọc ứng viên **ngay ở client** theo tiền tố.
> - Chỉ hiện gợi ý khi phần còn thiếu dài **≥ 6 ký tự** và hai phím cách nhau **≥ 100ms**. Gợi ý đã hiện một lần thì giữ, không chớp tắt.
> - Chữ mờ là một lớp đặt **sau** ô nhập: cùng font, cùng cách xuống dòng, phần đã gõ để trong suốt, nên gợi ý luôn nằm đúng sau con trỏ.
> - Query cũ bị huỷ khi có query mới; phím đầu tiên bắn một query rỗng để "làm ấm" kết nối.

<iframe class="demo-frame" src="/demos/facebook-patterns/index.html?theme=dark#/smart-compose" title="Demo smart-compose" loading="lazy" style="height: 900px"></iframe>

<p class="demo-links">▶ <a href="/demos/facebook-patterns/index.html#/smart-compose" target="_blank" rel="noopener">Mở demo toàn màn hình ↗</a> · <a href="https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns?file=src/lib/smartCompose.ts" target="_blank" rel="noopener">Sửa code trên StackBlitz ↗</a> · <a href="https://github.com/hunghg255/blog-hunghg/blob/master/examples/facebook-patterns/src/lib/smartCompose.ts" target="_blank" rel="noopener">Xem source trên GitHub ↗</a></p>

## Facebook làm thế nào?

Lớp chính là `SmartComposeTypeaheadHelper` (bundle `56.js` trong [facebook-codebase](https://github.com/hunghg255/facebook-codebase)). Chỗ dùng duy nhất trong bản dump là `PagesTypeaheadSuggestionInput.react` (`182.js`), khởi tạo với surface `"p2b_messaging"`, tức là ô trả lời tin nhắn từ người dùng tới Page.

### Hai hằng số và một Set

Đầu module là hai hằng số đặt tên kiểu minify:

```js
var g, h = b("React"), i = 6, j = 100, k = /* SmartComposeTypeaheadHelperQuery.graphql */;
```

`i = 6` là độ dài tối thiểu của phần còn thiếu, `j = 100` là khoảng cách tối thiểu giữa hai phím (ms). Hàm tính gợi ý (đã đổi tên biến):

```js
computeSuggestion(candidates = this.candidates) {
  if (candidates.length === 0 || this.text.indexOf(this.lastQuery) < 0 || this.isDeleting() || !this.cursorAtEnd)
    return null;
  const typed = this.text.substring(this.lastQuery.length).toLowerCase(); // gõ thêm sau lần query
  if (typed.length === 0) return null;
  const c = candidates.find(c => c.text.toLowerCase().indexOf(typed) === 0);
  if (c == null) return null;
  if (c.text.length <= typed.length && this.shown.has(c.text)) { logMatchingSuggestion(); return null; }
  if (!this.shown.has(c.text) && (c.text.length - typed.length < 6 || this.keyInterval !== -1 && this.keyInterval < 100))
    return null;
  ...
}
```

Ba chi tiết đáng chú ý:

- **`typed.length === 0` thì không hiện.** Ngay sau khoảng trắng, chưa có gợi ý nào. Phải gõ chữ cái đầu của từ tiếp theo thì gợi ý mới xuất hiện. Có lẽ để chắc người dùng định viết tiếp, và để chữ mờ không chen vào lúc người dùng đang nghĩ.
- **`shown` là một `Set`.** Ứng viên nào đã hiện một lần thì được miễn hai điều kiện "≥ 6 ký tự" và "≥ 100ms". Không có Set này, gợi ý sẽ biến mất khi người dùng gõ nhanh hơn một chút hoặc khi phần còn thiếu ngắn lại dưới 6, rồi hiện lại: nhấp nháy.
- **Tự gõ hết đúng câu gợi ý** (`c.text.length <= typed.length` và đã hiện) được log riêng thành `SmartComposeMatchingSuggestionFalcoEvent`: tín hiệu "gợi ý đúng nhưng người dùng không cần". Model phía server có lẽ dùng tín hiệu này để chỉnh.

### Khi nào hỏi server

```js
maybeQuery() {
  if (!this.warmedUp && this.text.length > 0) { this.query(""); this.warmedUp = true; return; }
  if (this.text.trim() === "" || !/[^\s]+\s$/.test(this.text) || this.currentQuery === this.text ||
      this.lastQuery === this.text || this.isDeleting() || this.suggestion != null)
    return;
  this.query(this.text, candidates => { /* thay bộ ứng viên nếu dùng được */ });
}
```

- **Phím đầu tiên bắn query rỗng, không có callback.** Kết quả bị bỏ. Mục đích có lẽ là mở kết nối và làm ấm cache phía server, để query thật sau đó nhanh hơn.
- Query thật chỉ đi khi text khớp `/[^\s]+\s$/`: vừa gõ xong một từ. Đang xoá, hoặc đang có gợi ý dùng được thì không hỏi.
- Mỗi query là một `CancelablePromise` bọc `RelayModern.fetchQuery`; query mới huỷ query cũ.

### Chữ mờ nằm ở đâu

`PagesTypeaheadSuggestionInput` vẽ **hai** editor Draft.js chồng lên nhau. Editor phía sau là bản `readOnly`, chứa toàn bộ nội dung đã gõ với inline style `GHOST: { visibility: "hidden" }`, rồi chèn chuỗi gợi ý vào cuối. Editor phía trước là editor thật, nền trong suốt. Vì hai editor có cùng font và cùng chiều rộng, phần đã gõ trong editor sau chiếm đúng chỗ của chữ thật, và chuỗi gợi ý rơi đúng vào sau con trỏ, kể cả khi xuống dòng. `Tab` và `→` gọi `insertTypeahead`: chèn chuỗi gợi ý vào editor thật.

## Bên trong trình duyệt: vì sao lớp phủ khớp được

Không có API nào để vẽ chữ "ở sau con trỏ" trong `<textarea>`. Mẹo của Facebook (và của bản viết lại) dựa trên một điều: hai hộp có cùng font, cùng `padding`, cùng `white-space: pre-wrap` và cùng chiều rộng thì trình duyệt ngắt dòng giống hệt nhau. Phần chữ đã gõ được vẽ trong suốt (`visibility: hidden` hoặc `color: transparent`) chỉ để giữ chỗ, chuỗi gợi ý theo sau nó.

```mermaid
flowchart LR
  K["Phím gõ"] --> U["update(text)"]
  U --> S{"Có bộ ứng viên khớp tiền tố?"}
  S -- "có, đủ 6 ký tự, gõ chậm" --> G["Hiện chữ mờ"]
  S -- "không" --> W{"Text kết thúc bằng từ + khoảng trắng?"}
  W -- "có" --> Q["Query server, huỷ query cũ"]
  W -- "không" --> N["Chờ phím sau"]
  Q --> R["Ứng viên mới"] --> S
  G --> T["Tab: chèn gợi ý"]
```

## Viết lại

Phần lõi là một lớp không phụ thuộc React: nhận text và vị trí con trỏ, trả ra chuỗi gợi ý qua callback. Hàm tính gợi ý chỉ chạy trên bộ ứng viên đang có, không gọi mạng:

```ts title=src/lib/smartCompose.ts
  /** Tính gợi ý từ bộ ứng viên đang có, không gọi mạng. */
  private computeSuggestion(candidates = this.candidates): { candidate: Candidate; rest: string } | null {
    if (candidates.length === 0 || !this.cursorAtEnd || this.isDeleting()) return null;
    // Khác bản gốc: FB dùng indexOf(base) >= 0 (base nằm ở đâu cũng được). Sửa đoạn đầu câu
    // thì substring(base.length) cắt sai chỗ. Ở đây đòi base phải là tiền tố.
    if (!this.text.startsWith(this.baseText)) return null;
    const typed = this.text.slice(this.baseText.length).toLowerCase();
    // vừa gõ xong từ (typed rỗng) thì chưa hiện: chờ chữ cái đầu của từ tiếp theo
    if (typed.length === 0) return null;
    const candidate = candidates.find((c) => c.text.toLowerCase().startsWith(typed));
    if (!candidate) return null;

    const remaining = candidate.text.length - typed.length;
    if (remaining <= 0) {
      // người dùng tự gõ hết đúng câu đã gợi ý: tín hiệu "gợi ý đúng" cho model.
      // Khác bản gốc: FB cũng log sự kiện này ngay sau khi người dùng bấm Tab nhận gợi ý.
      if (this.shown.has(candidate.text) && !this.accepting) this.opts.onEvent?.({ type: 'typed-it-all', candidate: candidate.text });
      return null;
    }
    const tooShort = remaining < this.opts.minRemaining;
    const typingFast = this.keyIntervalMs !== -1 && this.keyIntervalMs < this.opts.minKeyIntervalMs;
    if (!this.shown.has(candidate.text) && (tooShort || typingFast)) return null;
    return { candidate, rest: candidate.text.slice(typed.length) };
  }
```

Quyết định khi nào hỏi server:

```ts title=src/lib/smartCompose.ts
  private maybeQuery() {
    // phím đầu tiên: bắn một query rỗng để "làm ấm" kết nối, bỏ kết quả
    if (!this.warmedUp && this.text.length > 0) {
      this.warmedUp = true;
      void this.query('', true);
      return;
    }
    if (
      this.text.trim() === '' ||
      !ENDS_WITH_WORD_AND_SPACE.test(this.text) ||
      this.text === this.queryText ||
      this.text === this.baseText ||
      this.isDeleting() ||
      this.suggestion !== '' // đang có gợi ý dùng được thì khỏi hỏi lại
    ) {
      return;
    }
    void this.query(this.text, false);
  }
```

::: spoiler Xem toàn bộ src/lib/smartCompose.ts

```ts title=src/lib/smartCompose.ts
/**
 * Smart Compose: gợi ý phần còn lại của câu bằng chữ mờ (ghost text).
 * Ý tưởng từ SmartComposeTypeaheadHelper của Facebook (hộp thư Pages Manager):
 * - chỉ hỏi server khi người dùng vừa gõ xong một từ (text kết thúc bằng "từ + khoảng trắng"),
 *   các phím sau đó lọc ứng viên ngay ở client;
 * - chỉ hiện gợi ý khi phần còn thiếu đủ dài (≥ 6 ký tự) và người dùng gõ chậm (≥ 100ms/phím);
 * - gợi ý đã hiện một lần thì giữ, không chớp tắt theo tốc độ gõ.
 */

export interface Candidate {
  /** phần chữ server đoán sẽ đến SAU đoạn text đã gửi đi */
  text: string;
  confidence: number;
}

export type FetchCandidates = (text: string, signal: AbortSignal) => Promise<Candidate[]>;

export type SmartComposeEvent =
  | { type: 'query'; text: string; warmUp: boolean }
  | { type: 'query-done'; text: string; count: number; ms: number }
  | { type: 'query-cancelled'; text: string }
  | { type: 'displayed'; suggestion: string; keyIntervalMs: number }
  | { type: 'accepted'; suggestion: string }
  | { type: 'typed-it-all'; candidate: string };

export interface SmartComposeOptions {
  fetchCandidates: FetchCandidates;
  /** phần còn thiếu phải dài ít nhất bấy nhiêu ký tự mới đáng hiện (FB: 6) */
  minRemaining?: number;
  /** khoảng cách giữa hai phím phải ít nhất bấy nhiêu ms (FB: 100) */
  minKeyIntervalMs?: number;
  onSuggestionChange?: (suggestion: string) => void;
  onEvent?: (event: SmartComposeEvent) => void;
  now?: () => number;
}

const ENDS_WITH_WORD_AND_SPACE = /\S+\s$/;

export class SmartCompose {
  private text = '';
  private prevText = '';
  private cursorAtEnd = true;
  /** text của request đang bay (hoặc vừa gửi) */
  private queryText: string | null = null;
  /** text đã dùng để lấy bộ ứng viên hiện tại: gợi ý = phần ứng viên còn lại sau `baseText` */
  private baseText = '';
  private candidates: Candidate[] = [];
  /** ứng viên đã từng hiện: được giữ dù tốc độ gõ thay đổi */
  private shown = new Set<string>();
  private suggestion = '';
  private warmedUp = false;
  private accepting = false;
  private inFlight: AbortController | null = null;
  private lastKeyAt = -1;
  private keyIntervalMs = -1;
  private readonly opts: Required<Omit<SmartComposeOptions, 'onSuggestionChange' | 'onEvent'>> &
    Pick<SmartComposeOptions, 'onSuggestionChange' | 'onEvent'>;

  constructor(options: SmartComposeOptions) {
    this.opts = { minRemaining: 6, minKeyIntervalMs: 100, now: () => performance.now(), ...options };
  }

  getSuggestion() {
    return this.suggestion;
  }

  /** Gọi ở mỗi lần nội dung đổi do người dùng gõ. */
  update(text: string, cursorAtEnd: boolean) {
    const now = this.opts.now();
    this.keyIntervalMs = this.lastKeyAt < 0 ? -1 : now - this.lastKeyAt;
    this.lastKeyAt = now;
    this.setText(text.normalize('NFC'), cursorAtEnd);
  }

  /** Con trỏ di chuyển (click, phím mũi tên): không tính là một lần gõ. */
  setCursorAtEnd(cursorAtEnd: boolean) {
    this.setText(this.text, cursorAtEnd);
  }

  /** Người dùng bấm Tab/→: trả về đoạn cần chèn ('' nếu không có gợi ý). */
  accept(): string {
    const suggestion = this.suggestion;
    if (!suggestion) return '';
    this.opts.onEvent?.({ type: 'accepted', suggestion });
    // nội dung mới = text + gợi ý; không tính là một lần gõ phím
    this.accepting = true;
    try {
      this.setText(this.text + suggestion, true);
    } finally {
      this.accepting = false;
    }
    return suggestion;
  }

  dispose() {
    this.inFlight?.abort();
    this.inFlight = null;
  }

  private setText(text: string, cursorAtEnd: boolean) {
    if (text === this.text && cursorAtEnd === this.cursorAtEnd) return;
    this.prevText = this.text;
    this.text = text;
    this.cursorAtEnd = cursorAtEnd;
    this.refreshSuggestion();
    this.maybeQuery();
  }

  private isDeleting() {
    return this.text.length < this.prevText.length;
  }

  /** Tính gợi ý từ bộ ứng viên đang có, không gọi mạng. */
  private computeSuggestion(candidates = this.candidates): { candidate: Candidate; rest: string } | null {
    if (candidates.length === 0 || !this.cursorAtEnd || this.isDeleting()) return null;
    // Khác bản gốc: FB dùng indexOf(base) >= 0 (base nằm ở đâu cũng được). Sửa đoạn đầu câu
    // thì substring(base.length) cắt sai chỗ. Ở đây đòi base phải là tiền tố.
    if (!this.text.startsWith(this.baseText)) return null;
    const typed = this.text.slice(this.baseText.length).toLowerCase();
    // vừa gõ xong từ (typed rỗng) thì chưa hiện: chờ chữ cái đầu của từ tiếp theo
    if (typed.length === 0) return null;
    const candidate = candidates.find((c) => c.text.toLowerCase().startsWith(typed));
    if (!candidate) return null;

    const remaining = candidate.text.length - typed.length;
    if (remaining <= 0) {
      // người dùng tự gõ hết đúng câu đã gợi ý: tín hiệu "gợi ý đúng" cho model.
      // Khác bản gốc: FB cũng log sự kiện này ngay sau khi người dùng bấm Tab nhận gợi ý.
      if (this.shown.has(candidate.text) && !this.accepting) this.opts.onEvent?.({ type: 'typed-it-all', candidate: candidate.text });
      return null;
    }
    const tooShort = remaining < this.opts.minRemaining;
    const typingFast = this.keyIntervalMs !== -1 && this.keyIntervalMs < this.opts.minKeyIntervalMs;
    if (!this.shown.has(candidate.text) && (tooShort || typingFast)) return null;
    return { candidate, rest: candidate.text.slice(typed.length) };
  }

  private refreshSuggestion() {
    const next = this.computeSuggestion();
    const rest = next?.rest ?? '';
    if (next && !this.shown.has(next.candidate.text)) {
      this.shown.add(next.candidate.text);
      this.opts.onEvent?.({ type: 'displayed', suggestion: rest, keyIntervalMs: Math.round(this.keyIntervalMs) });
    }
    if (rest !== this.suggestion) {
      this.suggestion = rest;
      this.opts.onSuggestionChange?.(rest);
    }
  }

  private maybeQuery() {
    // phím đầu tiên: bắn một query rỗng để "làm ấm" kết nối, bỏ kết quả
    if (!this.warmedUp && this.text.length > 0) {
      this.warmedUp = true;
      void this.query('', true);
      return;
    }
    if (
      this.text.trim() === '' ||
      !ENDS_WITH_WORD_AND_SPACE.test(this.text) ||
      this.text === this.queryText ||
      this.text === this.baseText ||
      this.isDeleting() ||
      this.suggestion !== '' // đang có gợi ý dùng được thì khỏi hỏi lại
    ) {
      return;
    }
    void this.query(this.text, false);
  }

  private async query(text: string, warmUp: boolean) {
    this.inFlight?.abort(); // request cũ hết giá trị: người dùng đã gõ thêm
    const controller = new AbortController();
    this.inFlight = controller;
    this.queryText = text;
    const started = this.opts.now();
    this.opts.onEvent?.({ type: 'query', text, warmUp });
    try {
      const result = await this.opts.fetchCandidates(text, controller.signal);
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      this.opts.onEvent?.({ type: 'query-done', text, count: result.length, ms: Math.round(this.opts.now() - started) });
      if (warmUp || result.length === 0) return;
      // Chỉ thay bộ ứng viên nếu chưa có gợi ý, hoặc bộ mới cho ra gợi ý.
      const previousBase = this.baseText;
      this.baseText = text;
      if (this.suggestion !== '' && this.computeSuggestion(result) == null) {
        this.baseText = previousBase;
        return;
      }
      this.candidates = result;
      this.shown = new Set();
      this.refreshSuggestion();
    } catch (error) {
      if ((error as Error).name === 'AbortError') this.opts.onEvent?.({ type: 'query-cancelled', text });
      else throw error;
    } finally {
      if (this.inFlight === controller) this.inFlight = null;
    }
  }
}
```

:::

**Khác bản gốc:**

- FB kiểm tra `text.indexOf(lastQuery) >= 0`: đoạn đã query nằm *ở đâu cũng được* trong text. Nếu người dùng sửa chữ ở đầu câu (thêm "Dạ, " phía trước), `substring(lastQuery.length)` cắt sai chỗ và gợi ý lệch. Bản viết lại đòi `startsWith`.
- Ngay sau khi người dùng bấm Tab, text khớp trọn ứng viên đã hiện, nên FB log luôn sự kiện "người dùng tự gõ hết" (có lẽ ngoài ý muốn). Bản viết lại bỏ qua trường hợp này.
- Huỷ request bằng `AbortController` thay cho `CancelablePromise`, và chuẩn hoá Unicode `NFC` để chữ tiếng Việt gõ bằng bộ gõ tổ hợp vẫn so khớp được.

## Đi qua code

- `update(text, cursorAtEnd)` ghi lại khoảng cách từ phím trước (`keyIntervalMs`), rồi tính lại gợi ý và cân nhắc hỏi server. Click hay mũi tên chỉ đổi vị trí con trỏ thì gọi `setCursorAtEnd`, không tính là gõ phím.
- `computeSuggestion` lấy phần gõ thêm sau `baseText` (text đã gửi đi), tìm ứng viên đầu tiên bắt đầu bằng phần đó, trả về đoạn còn lại. Hai điều kiện "≥ 6 ký tự" và "≥ 100ms" chỉ áp cho ứng viên **chưa từng hiện**.
- `maybeQuery` chỉ hỏi khi vừa gõ xong một từ và hiện chưa có gợi ý. Đang có gợi ý dùng được nghĩa là bộ ứng viên cũ vẫn đúng, hỏi thêm là lãng phí.
- Khi kết quả về, bộ ứng viên mới chỉ thay bộ cũ nếu chưa có gợi ý, hoặc bộ mới cho ra gợi ý. Có lẽ để một response "rỗng ý" không xoá mất gợi ý đang hiện.

Phía giao diện, demo dùng một `div` bản sao đặt sau `<textarea>`:

```tsx
<div className='sc-editor'>
  <div className='sc-mirror' aria-hidden='true'>
    <span className='sc-typed'>{text}</span>
    <span className='sc-ghost'>{suggestion}</span>
  </div>
  <textarea className='sc-input' value={text} onChange={…} onKeyDown={…} />
</div>
```

`.sc-mirror` và `.sc-input` dùng chung một khối CSS cho font, padding, `white-space: pre-wrap`, `overflow-wrap`, `box-sizing`. `.sc-typed` có `visibility: hidden`, textarea có nền trong suốt nên chữ mờ phía sau lộ ra.

## Tại sao không làm cách khác?

- **Debounce 300ms rồi gọi server.** Ít request hơn mỗi phím, nhưng vẫn gọi giữa chừng một từ ("đã đ", "đã đặ") và luôn trễ ít nhất 300ms. Cách của FB gắn query với ranh giới từ: đúng lúc ngữ cảnh thay đổi nhiều nhất.
- **Gọi server và để server tự lọc.** Lọc theo tiền tố ở client là phép so chuỗi rẻ, phản hồi ngay ở phím tiếp theo, không phụ thuộc mạng.
- **Hiện gợi ý trong một dropdown** (như autocomplete). Phù hợp khi có nhiều lựa chọn. Smart Compose chỉ đưa ra một đoạn văn bản, ghost text không che nội dung và không cướp phím mũi tên lên/xuống.
- **`contenteditable` với một `<span>` gợi ý chèn thẳng vào DOM.** Con trỏ, undo, copy và trình đọc màn hình đều sẽ "thấy" đoạn gợi ý như văn bản thật. Lớp phủ tách biệt hoàn toàn khỏi nội dung.

## Edge case và cạm bẫy

- **Font hoặc padding lệch một chút** là chữ mờ lệch dòng. Giữ CSS của lớp phủ và ô nhập trong cùng một selector, và đặt `box-sizing` giống nhau. Scrollbar dọc của textarea cũng làm hẹp vùng chữ: nên cho textarea tự giãn chiều cao, hoặc đồng bộ `scrollTop` cho lớp phủ.
- **Bộ gõ tiếng Việt (IME).** Trong lúc soạn ký tự, `onChange` có thể bắn nhiều lần với chữ chưa hoàn chỉnh. Ngưỡng 100ms giúp một phần; nếu muốn chắc, bỏ qua cập nhật khi `event.nativeEvent.isComposing`.
- **Gợi ý không dành cho trình đọc màn hình** vì lớp phủ có `aria-hidden`. Demo đặt thêm một dòng `aria-live` ("Gợi ý: … (Tab để nhận)") để người dùng trình đọc màn hình biết có gợi ý.
- **Tab là phím điều hướng.** Chỉ chặn Tab khi đang có gợi ý; không có gợi ý thì để Tab đi tiếp như bình thường (FB gọi `onTab` gốc trong trường hợp này).
- **Ứng viên chứa thông tin nhạy cảm.** Gợi ý sinh từ lịch sử tin nhắn có thể lộ dữ liệu của khách khác nếu model dùng chung. Đây là việc của server, nhưng client nên log được tỉ lệ nhận/bỏ để phát hiện gợi ý lạ.

## Dùng trong dự án

```tsx
const engine = useMemo(
  () =>
    new SmartCompose({
      fetchCandidates: (text, signal) =>
        fetch(`/api/compose?q=${encodeURIComponent(text)}`, { signal }).then((r) => r.json()),
      onSuggestionChange: setSuggestion,
      onEvent: (e) => analytics.track(`smart_compose_${e.type}`, e),
    }),
  [],
);
useEffect(() => () => engine.dispose(), [engine]);
```

Server trả về danh sách `{ text, confidence }`, trong đó `text` là phần câu **tiếp theo** sau đoạn đã gửi. Ghi lại các sự kiện `displayed`, `accepted`, `typed-it-all` để đo tỉ lệ nhận: gợi ý hiện nhiều mà ít được nhận thì nên tăng ngưỡng 6 ký tự.

## Kiểm thử

::: spoiler Ví dụ test (bản phác, không có trong repo)

```ts
import { describe, expect, it } from 'vitest';
import { SmartCompose, type Candidate } from './smartCompose';

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(candidatesFor: (text: string) => Candidate[] = () => [{ text: 'đặt hàng, shop sẽ giao', confidence: 1 }]) {
  let clock = 0;
  const queries: string[] = [];
  const events: string[] = [];
  let suggestion = '';
  const sc = new SmartCompose({
    now: () => clock,
    fetchCandidates: (text) => {
      queries.push(text);
      return Promise.resolve(candidatesFor(text));
    },
    onSuggestionChange: (s) => (suggestion = s),
    onEvent: (e) => events.push(e.type),
  });
  // gõ từng ký tự, mỗi phím cách nhau `gap` ms
  const type = async (text: string, from = '', gap = 150) => {
    for (let i = from.length + 1; i <= text.length; i++) {
      clock += gap;
      sc.update(text.slice(0, i), true);
    }
    await flush();
  };
  return { sc, queries, events, type, get suggestion() { return suggestion; } };
}

describe('SmartCompose', () => {
  it('chỉ hỏi server khi vừa gõ xong một từ (cộng một query rỗng để làm ấm)', async () => {
    const t = setup(() => []);
    await t.type('cảm ơn bạn');
    expect(t.queries).toEqual(['', 'cảm ', 'cảm ơn ']);
  });

  it('gõ chậm thì hiện phần còn lại, Tab để nhận', async () => {
    const t = setup();
    await t.type('cảm ơn bạn đã ');
    await t.type('cảm ơn bạn đã đ', 'cảm ơn bạn đã ');
    expect(t.suggestion).toBe('ặt hàng, shop sẽ giao');
    expect(t.sc.accept()).toBe('ặt hàng, shop sẽ giao');
    expect(t.events).not.toContain('typed-it-all');
  });

  it('gõ nhanh hơn 100ms/phím thì không hiện gợi ý mới', async () => {
    const t = setup();
    await t.type('cảm ơn bạn đã ', '', 50);
    await t.type('cảm ơn bạn đã đ', 'cảm ơn bạn đã ', 50);
    expect(t.suggestion).toBe('');
  });

  it('phần còn thiếu ngắn hơn 6 ký tự thì bỏ qua', async () => {
    const t = setup(() => [{ text: 'đặt', confidence: 1 }]);
    await t.type('cảm ơn bạn đã ');
    await t.type('cảm ơn bạn đã đ', 'cảm ơn bạn đã ');
    expect(t.suggestion).toBe('');
  });

  it('query cũ bị huỷ khi có query mới', async () => {
    let resolveFirst!: (c: Candidate[]) => void;
    let n = 0;
    const aborted: string[] = [];
    const sc = new SmartCompose({
      now: () => (n += 200),
      fetchCandidates: (text, signal) => {
        signal.addEventListener('abort', () => aborted.push(text));
        return text === 'a ' ? new Promise((r) => (resolveFirst = r)) : Promise.resolve([]);
      },
    });
    sc.update('a', true); // query rỗng làm ấm
    sc.update('a ', true);
    sc.update('a b', true);
    sc.update('a b ', true);
    resolveFirst([]);
    await flush();
    expect(aborted).toEqual(['', 'a ']);
  });
});
```

:::

## So với thư viện và chuẩn web

- Chưa có API chuẩn cho "inline suggestion" trong ô nhập (tính tới 10/2026). Các editor lớn (Monaco, CodeMirror) tự vẽ ghost text bằng decoration riêng, cùng ý tưởng lớp phủ không thuộc nội dung.
- [`AbortSignal`](https://developer.mozilla.org/docs/Web/API/AbortSignal) giờ được mọi trình duyệt hỗ trợ và là cách chuẩn để huỷ `fetch`. `CancelablePromise` của FB chỉ bỏ qua kết quả, request vẫn chạy tới cùng.
- Phần khó nhất của Smart Compose là model sinh câu, không nằm ở client. Bài này chỉ bàn phần client: khi nào hỏi, khi nào hiện, hiện ở đâu.

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
- [#16 Khung chat không giật](/blogs/facebook-chat-scroller)
- [#17 Thuật toán chọn bố cục collage ảnh](/blogs/facebook-photo-collage-layout)
- [#18 Keep-alive tab trong SPA](/blogs/facebook-keep-alive-tabs)
- [#19 Tự đo Visual Completion & interaction tracing](/blogs/facebook-visual-completion)
- [#20 Router SPA bền bỉ & tải chunk có retry](/blogs/facebook-spa-router-resilient-loading)

*Phần 3*

- **#21 Smart Compose: gợi ý chữ mờ khi gõ** (bài này)
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
