---
title: 'Học từ Facebook #67: Cặp min/max-heap tái dùng node DOM trong danh sách ảo'
description: 'IntegerBufferSet của Facebook gán dòng vào một số "chỗ" cố định; khi hết chỗ, dòng xa vùng nhìn thấy nhất nhường chỗ. Một min-heap và một max-heap chung entry, xoá lười, dọn rác khi một heap phình gấp 10 lần.'
date: '2026-10-28T09:20'
series: facebook
seriesOrder: 67
author: hunghg255
image: https://blog.hunghg.me/blogs/fb-buffer-set.png
tags: ['facebook', 'virtual-list', 'data-structure', 'performance', 'react']
---

Danh sách ảo chỉ render những dòng đang nhìn thấy. Câu hỏi tiếp theo ít người để ý: khi cuộn, dòng 41 ra khỏi màn hình và dòng 57 đi vào, ta **xoá** node của dòng 41 rồi **tạo** node mới cho dòng 57, hay **dùng lại** node cũ?

Với React, nếu đặt `key={rowIndex}`, mỗi dòng mới là một lần mount: tạo component, chạy effect, tạo DOM. Cuộn nhanh qua 1.000 dòng là 1.000 lần mount và 1.000 lần unmount. Nếu đặt `key` theo **chỗ** (slot) thì React giữ nguyên node, chỉ đổi props: không mount, DOM chỉ đổi nội dung chữ và `transform`.

FixedDataTable của Facebook làm cách thứ hai. Phần khó là **chọn chỗ nào để lấy**: phải là chỗ đang giữ dòng **xa vùng nhìn thấy nhất**, để lúc người dùng cuộn ngược lại, các dòng gần vẫn còn sẵn.

> [!TIP]
> **Tóm tắt**
> - `IntegerBufferSet` giữ map `dòng → chỗ` và hai heap trên chỉ số dòng: **min-heap** (dòng nhỏ nhất) và **max-heap** (dòng lớn nhất). Dòng xa vùng `[low, high]` nhất luôn là đỉnh của một trong hai heap.
> - Hai heap **dùng chung một object entry**. Khi lấy chỗ chỉ `pop` ở một heap; entry ở heap kia thành rác và bị bỏ **lười** khi nổi lên đỉnh.
> - Rác có giới hạn: khi heap lớn hơn gấp 10 lần heap nhỏ, dựng lại cả hai từ entry còn sống.
> - `FixedDataTableRowBuffer` cấp số chỗ = số dòng vừa khung nhìn + 2 × vùng đệm (3 tới 6 dòng mỗi phía), trả về mảng `chỗ → dòng` để render với `key = chỗ`.

<iframe class="demo-frame" src="/demos/facebook-patterns/index.html?theme=dark#/buffer-set" title="Demo buffer-set" loading="lazy" style="height: 900px"></iframe>

<p class="demo-links">▶ <a href="/demos/facebook-patterns/index.html#/buffer-set" target="_blank" rel="noopener">Mở demo toàn màn hình ↗</a> · <a href="https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns?file=src/lib/bufferSet.ts" target="_blank" rel="noopener">Sửa code trên StackBlitz ↗</a> · <a href="https://github.com/hunghg255/blog-hunghg/blob/master/examples/facebook-patterns/src/lib/bufferSet.ts" target="_blank" rel="noopener">Xem source trên GitHub ↗</a></p>

## Facebook làm thế nào?

### IntegerBufferSet

Module `IntegerBufferSet` (bundle `233.js`) dựa trên một `Heap` tự viết (min-heap theo comparator, mảng phẳng). Giải mã, đổi tên biến:

```js
class IntegerBufferSet {
  valueToPosition = {};          // dòng → chỗ
  size = 0;                      // số chỗ đã cấp
  minHeap = new Heap([], (a, b) => a.value < b.value);
  maxHeap = new Heap([], (a, b) => a.value > b.value);

  getValuePosition = (value) => this.valueToPosition[value] ?? null;

  getNewPositionForValue = (value) => {
    invariant(this.valueToPosition[value] === undefined, '…');
    const position = this.size++;
    this.pushToHeaps(position, value);
    this.valueToPosition[value] = position;
    return position;
  };

  replaceFurthestValuePosition = (low, high, newValue) => {
    invariant(this.valueToPosition[newValue] === undefined, '…');
    this.cleanHeaps();
    if (this.minHeap.empty() || this.maxHeap.empty()) return null;
    const min = this.minHeap.peek().value;
    const max = this.maxHeap.peek().value;
    if (min >= low && max <= high) return null;      // mọi dòng đều đang hiện: không được lấy

    let victim;
    if (low - min > max - high) { victim = min; this.minHeap.pop(); }
    else { victim = max; this.maxHeap.pop(); }
    const position = this.valueToPosition[victim];
    delete this.valueToPosition[victim];
    this.valueToPosition[newValue] = position;
    this.pushToHeaps(position, newValue);
    return position;
  };

  pushToHeaps(position, value) {
    const entry = { position, value };              // MỘT object, đẩy vào CẢ HAI heap
    this.minHeap.push(entry);
    this.maxHeap.push(entry);
  }

  cleanHeaps() {
    this.cleanHeap(this.minHeap);
    this.cleanHeap(this.maxHeap);
    const small = Math.min(this.minHeap.size(), this.maxHeap.size());
    const big = Math.max(this.minHeap.size(), this.maxHeap.size());
    if (big > 10 * small) this.recreateHeaps();      // rác quá nhiều thì dựng lại
  }

  cleanHeap(heap) {                                   // bỏ entry đã chết ở đỉnh
    while (!heap.empty() && this.valueToPosition[heap.peek().value] === undefined) heap.pop();
  }

  recreateHeaps() {
    const source = this.minHeap.size() < this.maxHeap.size() ? this.minHeap : this.maxHeap;
    const newMin = new Heap([], minCmp), newMax = new Heap([], maxCmp);
    while (!source.empty()) {
      const entry = source.pop();
      if (this.valueToPosition[entry.value] !== undefined) { newMin.push(entry); newMax.push(entry); }
    }
    this.minHeap = newMin;
    this.maxHeap = newMax;
  }
}
```

Vì sao dòng xa nhất luôn ở đỉnh một heap? Vùng nhìn thấy là đoạn `[low, high]`. Một dòng nằm ngoài đoạn thì hoặc nhỏ hơn `low`, hoặc lớn hơn `high`. Dòng nhỏ nhất (đỉnh min-heap) là dòng xa nhất **về phía trên**; dòng lớn nhất (đỉnh max-heap) là dòng xa nhất **về phía dưới**. So `low − min` với `max − high` để biết bên nào xa hơn. Cả thao tác là O(log n) cho mỗi dòng mới.

Vì sao không xoá entry khỏi heap kia? Heap nhị phân không hỗ trợ xoá phần tử bất kỳ một cách rẻ (phải biết vị trí của nó trong mảng). Thay vào đó Facebook để entry "chết" nằm đó; nó chỉ phiền khi nổi lên đỉnh, và lúc đó `cleanHeap` nhận ra (dòng không còn trong map) rồi bỏ đi. Đây là kỹ thuật **xoá lười** (lazy deletion), cũng thấy trong cài đặt Dijkstra bằng heap.

Rác có thể tích lại: cuộn mãi xuống dưới, mỗi lần lấy chỗ từ min-heap thì entry tương ứng nằm chết trong max-heap (ở đáy, không bao giờ nổi lên vì giá trị nhỏ). Điều kiện "heap lớn gấp 10 lần heap nhỏ thì dựng lại" giới hạn bộ nhớ ở O(số chỗ). Khi thử cuộn ngẫu nhiên hơn 100.000 bước với 8 chỗ, kết quả luôn khớp mô hình đối chiếu và heap chỉ giữ cỡ vài chục entry.

### FixedDataTableRowBuffer

Người dùng của `IntegerBufferSet` là `FixedDataTableRowBuffer` (bundle `51.js`):

```js
constructor(rowsCount, defaultRowHeight, viewportHeight, rowHeightGetter, bufferRowCount) {
  this.bufferSet = new IntegerBufferSet();
  this.maxVisibleRowCount = Math.ceil(viewportHeight / defaultRowHeight) + 1;
  this.bufferRowCount = bufferRowCount ?? clamp(Math.floor(this.maxVisibleRowCount / 2), 3, 6);
  this.rows = [];                                   // chỗ → dòng
}

addRowToBuffer(row, first, last) {
  let position = this.bufferSet.getValuePosition(row);
  const limit = last - first + 1 + 2 * this.bufferRowCount;
  if (position === null && this.bufferSet.getSize() >= limit)
    position = this.bufferSet.replaceFurthestValuePosition(first, last, row);
  if (position === null) position = this.bufferSet.getNewPositionForValue(row);
  this.rows[position] = row;
}
```

`getRows(first, …)` gọi `addRowToBuffer` cho từng dòng đang hiện và trả mảng `rows`. Component bảng render `rows.map((row, position) => <Row key={position} index={row} />)`. Có thêm `getRowsWithUpdatedBuffer()` để lấp `bufferRowCount` dòng phía trên và phía dưới khi rảnh, nên cuộn nhẹ không thấy dòng trắng.

`SimpleList.react` trong thư mục `FacebookVirtualizedList` cũng dùng `IntegerBufferSet` theo cùng cách.

## Viết lại

Bản viết lại có `Heap<T>` generic, `BufferSet` dùng `Map` và cờ `stale` trên entry, và hàm tiện ích `assignRows` cho danh sách ảo.

```ts title=src/lib/bufferSet.ts
interface Entry {
  value: number;
  position: number;
  /** đánh dấu entry này đã hết hiệu lực (thay cho việc tra map như bản gốc) */
  stale: boolean;
}

export class BufferSet {
  private readonly byValue = new Map<number, Entry>();
  private nextPosition = 0;
  private minHeap = new Heap<Entry>((a, b) => a.value < b.value);
  private maxHeap = new Heap<Entry>((a, b) => a.value > b.value);

  /** Số chỗ đã cấp. */
  get size() {
    return this.nextPosition;
  }

  /** Số entry đang nằm trong hai heap (kể cả entry đã hết hiệu lực), để quan sát dọn rác. */
  get heapSizes() {
    return { min: this.minHeap.size, max: this.maxHeap.size };
  }

  positionOf(value: number) {
    return this.byValue.get(value)?.position ?? null;
  }

  /** Cấp chỗ mới hoàn toàn (khi chưa đạt giới hạn số node). */
  addNew(value: number) {
    if (this.byValue.has(value)) throw new Error(`dòng ${value} đã có chỗ`);
    const position = this.nextPosition++;
    this.track(value, position);
    return position;
  }

  /**
   * Lấy chỗ của dòng nằm ngoài [low, high] và xa nhất để giao cho newValue.
   * Trả null nếu mọi dòng đang giữ chỗ đều nằm trong [low, high] (không được đá dòng đang hiện).
   */
  replaceFurthest(low: number, high: number, newValue: number) {
    if (this.byValue.has(newValue)) throw new Error(`dòng ${newValue} đã có chỗ`);
    this.dropStaleTops();
    const min = this.minHeap.peek();
    const max = this.maxHeap.peek();
    if (!min || !max) return null;
    if (min.value >= low && max.value <= high) return null;

    // bên nào lệch khỏi vùng nhìn thấy nhiều hơn thì bị lấy chỗ
    const victim = low - min.value > max.value - high ? this.minHeap.pop()! : this.maxHeap.pop()!;
    victim.stale = true;
    this.byValue.delete(victim.value);
    this.track(newValue, victim.position);
    this.compactIfBloated();
    return victim.position;
  }

  private track(value: number, position: number) {
    const entry: Entry = { value, position, stale: false };
    this.byValue.set(value, entry);
    this.minHeap.push(entry);
    this.maxHeap.push(entry);
  }

  private dropStaleTops() {
    while (this.minHeap.peek()?.stale) this.minHeap.pop();
    while (this.maxHeap.peek()?.stale) this.maxHeap.pop();
  }

  /**
   * Mỗi lần thay chỉ pop ở MỘT heap; heap kia giữ lại entry cũ. Khi một heap lớn hơn 10 lần
   * số dòng đang sống thì dựng lại cả hai từ map (bản gốc so hai heap với nhau).
   */
  private compactIfBloated() {
    const live = this.byValue.size;
    if (Math.max(this.minHeap.size, this.maxHeap.size) <= 10 * Math.max(live, 1)) return;
    this.minHeap = new Heap<Entry>((a, b) => a.value < b.value);
    this.maxHeap = new Heap<Entry>((a, b) => a.value > b.value);
    for (const entry of this.byValue.values()) {
      this.minHeap.push(entry);
      this.maxHeap.push(entry);
    }
  }
}
```

```ts title=src/lib/bufferSet.ts
/**
 * Tiện ích cho danh sách ảo: với dải dòng cần hiện [first, last] và giới hạn số node,
 * trả về map row → position. Dòng đã có chỗ giữ nguyên chỗ (node DOM không đổi).
 */
export function assignRows(set: BufferSet, first: number, last: number, maxNodes: number) {
  const assignment = new Map<number, number>();
  for (let row = first; row <= last; row++) {
    let position = set.positionOf(row);
    if (position === null) {
      position = set.size < maxNodes ? set.addNew(row) : set.replaceFurthest(first, last, row);
    }
    if (position !== null) assignment.set(row, position);
  }
  return assignment;
}
```

::: spoiler Xem toàn bộ src/lib/bufferSet.ts

```ts title=src/lib/bufferSet.ts
/**
 * Gán dòng (row index) vào một số "chỗ" (position) cố định để tái dùng node DOM khi cuộn
 * (ý tưởng từ IntegerBufferSet của Facebook, dùng trong FixedDataTable).
 *
 * Khi một dòng mới cần hiện ra mà hết chỗ, ta lấy chỗ của dòng ở XA vùng nhìn thấy nhất.
 * Dòng xa nhất là dòng nhỏ nhất hoặc lớn nhất, nên giữ cùng lúc một min-heap và một
 * max-heap trên row index, xoá kiểu lười (lazy): entry đã bị thay vẫn nằm trong heap,
 * chỉ bị bỏ khi nó nổi lên đỉnh.
 */

export class Heap<T> {
  private items: T[] = [];

  constructor(private readonly less: (a: T, b: T) => boolean) {}

  get size() {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(item: T) {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(items[i], items[parent])) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      i = parent;
    }
  }

  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let best = i;
        if (l < items.length && this.less(items[l], items[best])) best = l;
        if (r < items.length && this.less(items[r], items[best])) best = r;
        if (best === i) break;
        [items[i], items[best]] = [items[best], items[i]];
        i = best;
      }
    }
    return top;
  }
}

interface Entry {
  value: number;
  position: number;
  /** đánh dấu entry này đã hết hiệu lực (thay cho việc tra map như bản gốc) */
  stale: boolean;
}

export class BufferSet {
  private readonly byValue = new Map<number, Entry>();
  private nextPosition = 0;
  private minHeap = new Heap<Entry>((a, b) => a.value < b.value);
  private maxHeap = new Heap<Entry>((a, b) => a.value > b.value);

  /** Số chỗ đã cấp. */
  get size() {
    return this.nextPosition;
  }

  /** Số entry đang nằm trong hai heap (kể cả entry đã hết hiệu lực), để quan sát dọn rác. */
  get heapSizes() {
    return { min: this.minHeap.size, max: this.maxHeap.size };
  }

  positionOf(value: number) {
    return this.byValue.get(value)?.position ?? null;
  }

  /** Cấp chỗ mới hoàn toàn (khi chưa đạt giới hạn số node). */
  addNew(value: number) {
    if (this.byValue.has(value)) throw new Error(`dòng ${value} đã có chỗ`);
    const position = this.nextPosition++;
    this.track(value, position);
    return position;
  }

  /**
   * Lấy chỗ của dòng nằm ngoài [low, high] và xa nhất để giao cho newValue.
   * Trả null nếu mọi dòng đang giữ chỗ đều nằm trong [low, high] (không được đá dòng đang hiện).
   */
  replaceFurthest(low: number, high: number, newValue: number) {
    if (this.byValue.has(newValue)) throw new Error(`dòng ${newValue} đã có chỗ`);
    this.dropStaleTops();
    const min = this.minHeap.peek();
    const max = this.maxHeap.peek();
    if (!min || !max) return null;
    if (min.value >= low && max.value <= high) return null;

    // bên nào lệch khỏi vùng nhìn thấy nhiều hơn thì bị lấy chỗ
    const victim = low - min.value > max.value - high ? this.minHeap.pop()! : this.maxHeap.pop()!;
    victim.stale = true;
    this.byValue.delete(victim.value);
    this.track(newValue, victim.position);
    this.compactIfBloated();
    return victim.position;
  }

  private track(value: number, position: number) {
    const entry: Entry = { value, position, stale: false };
    this.byValue.set(value, entry);
    this.minHeap.push(entry);
    this.maxHeap.push(entry);
  }

  private dropStaleTops() {
    while (this.minHeap.peek()?.stale) this.minHeap.pop();
    while (this.maxHeap.peek()?.stale) this.maxHeap.pop();
  }

  /**
   * Mỗi lần thay chỉ pop ở MỘT heap; heap kia giữ lại entry cũ. Khi một heap lớn hơn 10 lần
   * số dòng đang sống thì dựng lại cả hai từ map (bản gốc so hai heap với nhau).
   */
  private compactIfBloated() {
    const live = this.byValue.size;
    if (Math.max(this.minHeap.size, this.maxHeap.size) <= 10 * Math.max(live, 1)) return;
    this.minHeap = new Heap<Entry>((a, b) => a.value < b.value);
    this.maxHeap = new Heap<Entry>((a, b) => a.value > b.value);
    for (const entry of this.byValue.values()) {
      this.minHeap.push(entry);
      this.maxHeap.push(entry);
    }
  }
}

/**
 * Tiện ích cho danh sách ảo: với dải dòng cần hiện [first, last] và giới hạn số node,
 * trả về map row → position. Dòng đã có chỗ giữ nguyên chỗ (node DOM không đổi).
 */
export function assignRows(set: BufferSet, first: number, last: number, maxNodes: number) {
  const assignment = new Map<number, number>();
  for (let row = first; row <= last; row++) {
    let position = set.positionOf(row);
    if (position === null) {
      position = set.size < maxNodes ? set.addNew(row) : set.replaceFurthest(first, last, row);
    }
    if (position !== null) assignment.set(row, position);
  }
  return assignment;
}
```

:::

## Đi qua code

- **`Heap<T>`** là binary heap chuẩn với comparator `less`: `push` nổi lên (`(i − 1) >> 1` là cha), `pop` lấy phần tử cuối đặt lên đỉnh rồi chìm xuống, chọn con nhỏ hơn.
- **`Entry.stale`**: bản gốc kiểm tra entry chết bằng cách tra map `valueToPosition[entry.value] === undefined`. Bản viết lại đánh dấu ngay trên object (`victim.stale = true`). Hai heap chia sẻ object nên heap kia "thấy" cờ ngay. Cách này cũng tránh một trường hợp tinh tế: dòng 5 bị lấy chỗ rồi sau đó lại được cấp chỗ mới, khi đó entry cũ của dòng 5 trong heap kia vẫn "trông như sống" nếu chỉ tra theo giá trị. Bản gốc vẫn đúng nhờ luôn đọc chỗ từ map, nhưng cờ trên entry thì hiển nhiên hơn.
- **`replaceFurthest`** dọn đỉnh hai heap, trả `null` nếu mọi dòng đang giữ chỗ nằm trong `[low, high]` (không được đá dòng đang hiện), chọn bên xa hơn, pop, đánh dấu, cấp chỗ cho dòng mới.
- **`compactIfBloated`** so heap lớn nhất với **số dòng còn sống** (`byValue.size`), không so hai heap với nhau như bản gốc. Hai heap có thể cùng phình nếu người dùng cuộn lên xuống liên tục; so với số dòng sống thì giới hạn chắc chắn hơn.
- **`assignRows`** tương đương `getRows` của FixedDataTableRowBuffer: dòng đã có chỗ giữ nguyên, chưa có thì cấp mới khi còn hạn mức, hết thì lấy chỗ xa nhất.
- Demo dùng `useRef` cho `BufferSet` và đổi nó **ngoài** `setState`: hàm cập nhật state có thể bị React gọi hai lần trong StrictMode, đổi cấu trúc dữ liệu trong đó sẽ cấp chỗ hai lần.

**Khác bản gốc:**
- Khi mọi chỗ đều đang hiện (`replaceFurthest` trả `null`), FixedDataTable **cấp thêm chỗ mới** (danh sách tự nới khi khung nhìn cao lên). `assignRows` bỏ qua dòng đó; muốn giống bản gốc, gọi `addNew` khi nhận `null`.
- `Map` thay object thường làm map (key số trong object bị đổi thành chuỗi, và `delete` liên tục trên object thường chậm hơn `Map.delete`).

## Tại sao không làm cách khác?

**Mảng vòng (ring buffer) theo `row % N`?** Dòng `r` luôn vào chỗ `r % N`. Đơn giản, O(1), và khi cuộn đều thì đúng là "chỗ xa nhất". Nhưng khi nhảy cóc (kéo thanh cuộn, `scrollToRow(5000)`), nhiều dòng đang hiện có thể trùng chỗ (`r` và `r + N` cùng hiện nếu N nhỏ hơn số dòng hiện). Heap không có giả định nào về cách cuộn.

**Quét tuyến tính tìm dòng xa nhất?** Với 15 chỗ, quét 15 phần tử còn nhanh hơn heap. Đây là lời khuyên thật: nếu tự viết, quét tuyến tính là đủ. Cấu trúc heap đáng giá khi số chỗ lớn (lưới ảnh 200 ô, bảng nhiều cột ảo hoá cả hai chiều).

**`key={row}` và để React lo?** Đơn giản nhất, và với dòng nhẹ thì không sao. Khi mỗi dòng có component nặng (ô nhập, ảnh, menu), mount/unmount liên tục gây giật khi cuộn nhanh. Tái dùng node còn giữ được trạng thái DOM như ảnh đã giải mã.

**Tái dùng mà không cần cấu trúc: dùng chỉ số trong mảng render làm key** (`visibleRows.map((row, i) => <Row key={i} …/>)`)? Cũng là tái dùng node, nhưng khi cuộn 1 dòng, **mọi** chỗ đều đổi dòng (chỗ 0 từ dòng 10 thành 11, chỗ 1 từ 11 thành 12…), mọi dòng re-render. Với BufferSet chỉ đúng một chỗ đổi.

## Edge case và cạm bẫy

- **Trạng thái nội bộ đi theo node.** Tái dùng node nghĩa là state React (`useState` trong `Row`) của dòng 41 giờ thuộc về dòng 57. Component dòng phải **không giữ state theo dòng**, hoặc reset khi prop `index` đổi. Ô `<input>` không kiểm soát (uncontrolled) sẽ giữ chữ của dòng cũ.
- **Focus và trình đọc màn hình.** Node đang có focus bị đổi sang dòng khác thì focus "nhảy" theo. Trước khi lấy chỗ, kiểm tra `node.contains(document.activeElement)` và không lấy chỗ đó.
- **Ẩn chỗ thừa thay vì xoá.** Chỗ giữ dòng ngoài vùng nhìn được ẩn (`visibility: hidden` hoặc dịch ra ngoài) chứ không xoá, nếu không thì mất ý nghĩa tái dùng. Demo ẩn bằng `visibility`.
- **Số dòng giảm** (lọc danh sách): dòng đang giữ chỗ không còn tồn tại. Đơn giản nhất là tạo `BufferSet` mới khi dữ liệu đổi hẳn.
- **Ảnh trong dòng tái dùng** cần đổi `src` ngay, nếu không người dùng thấy ảnh của dòng cũ trong một khung hình. Đặt `key` cho riêng thẻ `<img>` theo dòng nếu cần.

## Dùng trong dự án

```tsx
const setRef = useRef(new BufferSet());
const slotsRef = useRef<number[]>([]);           // chỗ → dòng
const [slots, setSlots] = useState<number[]>([]);

function onScroll(scrollTop: number) {
  const first = Math.floor(scrollTop / ROW_H);
  const last = Math.min(rows.length - 1, Math.floor((scrollTop + viewportH) / ROW_H));
  const assignment = assignRows(setRef.current, first - 3, last + 3, last - first + 1 + 6);
  const next = slotsRef.current.slice();
  for (const [row, position] of assignment) next[position] = row;
  slotsRef.current = next;
  setSlots(next);
}

return slots.map((row, position) => (
  <Row key={position} item={rows[row]} style={{ transform: `translateY(${row * ROW_H}px)` }} />
));
```

## Kiểm thử

::: spoiler Ví dụ test (bản phác, không có trong repo)

```ts
import { describe, expect, it } from 'vitest';
import { BufferSet } from './bufferSet';
import { alea } from './seededRandom';

describe('BufferSet', () => {
  it('luôn lấy chỗ của dòng xa vùng nhìn nhất, heap không phình mãi', () => {
    const random = alea('buffer');
    const set = new BufferSet();
    const rows = new Map<number, number>();               // dòng → chỗ, mô hình đối chiếu
    for (let r = 0; r < 8; r++) rows.set(r, set.addNew(r));
    for (let step = 0; step < 20_000; step++) {
      const low = Math.floor(random() * 500), high = low + 7;
      const row = low + Math.floor(random() * 8);
      if (set.positionOf(row) !== null) continue;
      const dist = (r: number) => (r < low ? low - r : r > high ? r - high : 0);
      const furthest = Math.max(...[...rows.keys()].map(dist));
      const position = set.replaceFurthest(low, high, row);
      if (position === null) { expect(furthest).toBe(0); continue; }
      const victim = [...rows].find(([, p]) => p === position)![0];
      expect(dist(victim)).toBe(furthest);
      rows.delete(victim);
      rows.set(row, position);
      expect(Math.max(set.heapSizes.min, set.heapSizes.max)).toBeLessThanOrEqual(10 * 8 + 2);
    }
  });
});
```

:::

## So với thư viện và chuẩn web

- **react-window**, **TanStack Virtual**, **react-virtuoso** dùng `key` theo chỉ số dòng: mount/unmount khi cuộn, đơn giản, đủ tốt cho phần lớn trường hợp.
- Tái dùng node theo kiểu "recycling" là chuẩn trên mobile: `UITableView` (iOS) với `dequeueReusableCell`, `RecyclerView` (Android). **FlashList** của Shopify mang ý tưởng đó sang React Native và giải thích rõ vì sao nhanh hơn `FlatList`.
- Trên web, `content-visibility: auto` để trình duyệt bỏ qua layout/paint phần ngoài màn hình là lựa chọn không cần JavaScript cho danh sách vài nghìn dòng.

Bài liên quan: [Học từ Facebook #63: cây tổng và vị trí dòng cao không đều](/blogs/facebook-fenwick-weighted-random), [Học từ Facebook #1: dùng chung IntersectionObserver + infinite scroll](/blogs/facebook-shared-intersection-observer).

---

Bài này thuộc series **[Học từ mã nguồn Facebook](/series/facebook)** (83 bài, đọc theo thứ tự).

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
- **#67 Cặp min/max-heap tái dùng vị trí trong danh sách ảo** (bài này)
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

:::

Code + demo: [`examples/facebook-patterns`](https://github.com/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns) · [Mở trên StackBlitz](https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns)
