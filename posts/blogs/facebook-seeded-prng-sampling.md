---
title: 'Học từ Facebook #66: PRNG có seed, xáo trộn tái lập và lấy mẫu trace 1/32'
description: 'Facebook mang theo Alea, một bộ sinh số ngẫu nhiên nhận seed, để xáo trộn danh sách giống nhau mỗi lần tải trang và sinh ID trace 63 bit mà ký tự cuối quyết định có lấy mẫu hay không. Bài viết giải mã, chỉ ra seed mặc định chỉ tới giây và việc xáo tại chỗ.'
date: '2026-10-28T09:18'
series: facebook
seriesOrder: 66
author: hunghg255
image: https://blog.hunghg.me/blogs/fb-seeded-random.png
tags: ['facebook', 'random', 'algorithm', 'ab-testing', 'observability']
---

`Math.random()` không nhận seed. Muốn **cùng đầu vào thì ra cùng dãy ngẫu nhiên** là bó tay:

- Xáo thứ tự câu hỏi cho mỗi thí sinh, tải lại trang vẫn giữ thứ tự cũ, không phải lưu thứ tự lên server.
- Chia người dùng vào nhóm A/B ổn định chỉ từ `userId`.
- Test hay demo có yếu tố ngẫu nhiên nhưng cần chạy lại y hệt khi gỡ lỗi.

Bundle Facebook mang theo **Alea**, một bộ sinh số giả ngẫu nhiên (PRNG) nhỏ của Johannes Baagøe (giấy phép MIT), cùng hai chỗ dùng nó: `randomShuffleSeeded` và `ArtilleryTraceIDUtils` (ID cho hệ thống trace hiệu năng Artillery).

> [!TIP]
> **Tóm tắt**
> - **Alea** giữ 3 trạng thái số thực + 1 số nhớ, mỗi lần gọi là một phép nhân-cộng với nhớ (multiply-with-carry). Hàm băm **Mash** biến seed (chuỗi bất kỳ) thành trạng thái ban đầu.
> - Xáo trộn có seed = Fisher-Yates với PRNG có seed. Bản Facebook xáo **tại chỗ**: gọi hai lần trên cùng mảng ra hai thứ tự khác nhau.
> - Seed mặc định của Alea là `new Date()`, bị Mash đổi thành chuỗi **chỉ tới giây**: hai bộ sinh tạo trong cùng một giây cho cùng dãy.
> - ID trace: 11 ký tự base64 = 63 bit (ký tự đầu chỉ 3 bit để vừa int64 có dấu). Lấy mẫu 1/32 bằng **ký tự cuối mod 32**, không cần sinh thêm số ngẫu nhiên, và server, client cùng quyết định giống nhau.

<iframe class="demo-frame" src="/demos/facebook-patterns/index.html?theme=dark#/seeded-random" title="Demo seeded-random" loading="lazy" style="height: 1150px"></iframe>

<p class="demo-links">▶ <a href="/demos/facebook-patterns/index.html#/seeded-random" target="_blank" rel="noopener">Mở demo toàn màn hình ↗</a> · <a href="https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns?file=src/lib/seededRandom.ts" target="_blank" rel="noopener">Sửa code trên StackBlitz ↗</a> · <a href="https://github.com/hunghg255/blog-hunghg/blob/master/examples/facebook-patterns/src/lib/seededRandom.ts" target="_blank" rel="noopener">Xem source trên GitHub ↗</a></p>

## Facebook làm thế nào?

### Mash và Alea

Module `Alea` (có trong bundle `1.js`, `22.js`) gần như nguyên văn bản gốc của Baagøe:

```js
function Mash() {
  let n = 4022871197;                         // 0xefc8249d
  return function (data) {
    data = data.toString();
    for (let i = 0; i < data.length; i++) {
      n += data.charCodeAt(i);
      let h = 0.02519603282416938 * n;
      n = h >>> 0;                              // phần nguyên 32 bit
      h -= n;                                   // phần thập phân
      h *= n;
      n = h >>> 0;
      h -= n;
      n += h * 4294967296;                      // 2^32
    }
    return (n >>> 0) * 2.3283064365386963e-10;  // 2^-32 → [0, 1)
  };
}

function Alea(...args) {
  const seeds = args.length > 0 ? args : [new Date()];
  const mash = Mash();
  let s0 = mash(' '), s1 = mash(' '), s2 = mash(' '), c = 1;
  for (const seed of seeds) {
    s0 -= mash(seed); if (s0 < 0) s0 += 1;
    s1 -= mash(seed); if (s1 < 0) s1 += 1;
    s2 -= mash(seed); if (s2 < 0) s2 += 1;
  }
  return function random() {
    const t = 2091639 * s0 + c * 2.3283064365386963e-10;
    s0 = s1;
    s1 = s2;
    return (s2 = t - (c = t | 0));
  };
}
```

Mỗi lần gọi `random()`: nhân trạng thái cũ nhất với hằng số `2091639`, cộng số nhớ `c` (đã chia cho 2³²), phần nguyên của kết quả thành số nhớ mới, **phần thập phân** là số trả về và trở thành trạng thái mới nhất. Ba trạng thái xoay vòng (`s0 ← s1 ← s2 ← mới`). Đây là phép multiply-with-carry "lag-3", viết bằng số thực để chạy nhanh trên JavaScript mà không cần số nguyên 64 bit. Chu kỳ khoảng 2¹¹⁶ theo tác giả, quá đủ cho UI.

Mash cũng đáng chú ý: nó băm mọi seed (số, chuỗi, Date) qua `toString()` thành số thực trong `[0, 1)`, và **giữ trạng thái `n` giữa các lần gọi**. Vì thế nhiều seed (`Alea('quiz-10', 'user-42')`) được trộn theo thứ tự: `Alea('a', 'b')` khác `Alea('b', 'a')`.

Hệ quả của `toString()`: seed mặc định `new Date()` thành `"Wed Oct 28 2026 09:47:13 GMT+0000 (…)"`, **không có mili-giây**. Hai bộ sinh không truyền seed tạo trong cùng một giây (hai tab mở cùng lúc, hai component khởi tạo cùng lượt render) cho **cùng một dãy số**. Demo có thử điều này với hai thời điểm cách nhau 900ms.

### randomShuffleSeeded

```js
function randomShuffleSeeded(array, ...seeds) {
  const random = Alea(...seeds);
  const randomInt = (max) => Math.floor(random() * max);
  for (let h = array.length - 1; h > 0; h--) {
    const i = randomInt(h + 1);             // 0 ≤ i ≤ h
    if (i != h) [array[i], array[h]] = [array[h], array[i]];
  }
  return array;                             // chính mảng đầu vào
}
```

Đây là Fisher-Yates chuẩn: đi từ cuối về đầu, đổi phần tử `h` với một phần tử ngẫu nhiên trong `[0, h]`. Mọi hoán vị có xác suất bằng nhau (nếu PRNG đều). Cạm bẫy: hàm **sửa mảng đầu vào**. Gọi hai lần với cùng seed trên cùng một mảng không ra cùng thứ tự, vì lần hai xáo một mảng đã bị xáo. Ai lấy mảng từ state React hay từ cache dùng chung mà quên `.slice()` sẽ gặp lỗi khó hiểu: "cùng seed mà sao thứ tự đổi?".

### ArtilleryTraceIDUtils: ID 63 bit và lấy mẫu bằng ký tự cuối

```js
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const random = Alea(ServerNonce.ServerNonce);    // seed là nonce server gửi kèm trang

function once() {
  let bits = 0, pool = 0, id = '';
  for (let i = 10; i >= 0; i--) {
    if (bits < 6) { pool = Math.floor(2147483648 * random()); bits = 32; } // 2^31
    if (i === 0) pool &= 7;                       // ký tự đầu chỉ 3 bit
    id = BASE64.charAt(pool & 63) + id;
    pool >>= 6;
    bits -= 6;
  }
  return id;
}

newTraceId() {
  for (let n = 3; n > 0; n--) {
    const id = once();
    if (id != 'AAAAAAAAAAA') return id;           // ID toàn 0 dành cho "không có trace"
  }
  FBLogger('FIXME').mustfix('failed to generate valid Fbtrace id');
  return 'AAAAAAAAAAA';
}

traceIdToBucket(id) {
  return BASE64.indexOf(id.charAt(id.length - 1)) % 32;
}
```

- **63 bit**: 10 ký tự × 6 bit + 3 bit = 63. ID đổi ngược ra số vừa kiểu `BIGINT` có dấu của MySQL/Java mà không bao giờ âm.
- **Seed là `ServerNonce`** (một chuỗi ngẫu nhiên server nhúng vào trang), không phải thời gian, nên hai tab có ID khác nhau.
- **Lấy mẫu theo ký tự cuối**: ký tự cuối mang 6 bit ngẫu nhiên, `% 32` cho nhóm 0–31 đều nhau. Hệ thống chỉ cần quy định "giữ trace có nhóm < N" để lấy mẫu N/32. Vì quyết định nằm **trong ID**, mọi tầng (client, proxy, backend) nhìn cùng một ID đều đồng ý trace này được giữ hay bỏ, không cần truyền thêm cờ.
- Một chi tiết nhỏ: bộ đếm `bits = 32` trong khi `Math.floor(2^31 * random())` chỉ có 31 bit. Không ảnh hưởng kết quả: sau 5 ký tự (30 bit) bộ đếm còn 2, dưới 6 nên vẫn lấy số mới.

## Viết lại

Bản viết lại giữ nguyên Mash/Alea (thuật toán công khai, cần đúng hằng số để tái lập dãy), đổi phần xung quanh: xáo trên bản sao, seed mặc định bằng `crypto.getRandomValues`, thêm `bucketOf` cho A/B.

```ts title=src/lib/seededRandom.ts
/** Hàm băm Mash: biến chuỗi thành số trong [0, 1). Giữ trạng thái giữa các lần gọi. */
function createMash() {
  let n = 0xefc8249d; // 4022871197
  return (data: string) => {
    for (let i = 0; i < data.length; i++) {
      n += data.charCodeAt(i);
      let h = 0.02519603282416938 * n;
      n = h >>> 0;
      h -= n;
      h *= n;
      n = h >>> 0;
      h -= n;
      n += h * 0x100000000; // 2^32
    }
    return (n >>> 0) * 2.3283064365386963e-10; // 2^-32
  };
}

export type Random = () => number;

/** Tạo PRNG Alea từ một hoặc nhiều seed. Cùng seed → cùng dãy số. */
export function alea(...seeds: Array<string | number>): Random {
  const mash = createMash();
  let s0 = mash(' ');
  let s1 = mash(' ');
  let s2 = mash(' ');
  let carry = 1;
  for (const seed of seeds) {
    const text = String(seed);
    s0 -= mash(text);
    if (s0 < 0) s0 += 1;
    s1 -= mash(text);
    if (s1 < 0) s1 += 1;
    s2 -= mash(text);
    if (s2 < 0) s2 += 1;
  }
  return () => {
    const t = 2091639 * s0 + carry * 2.3283064365386963e-10;
    s0 = s1;
    s1 = s2;
    return (s2 = t - (carry = t | 0));
  };
}
```

```ts title=src/lib/seededRandom.ts
/** Seed khó trùng khi không truyền seed: bản gốc dùng new Date() (Mash đổi ra chuỗi, chỉ tới giây), hai tab mở trong cùng một giây sẽ trùng dãy. */
export function randomSeed() {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return `${buf[0].toString(36)}${buf[1].toString(36)}`;
}

export function randomInt(random: Random, maxExclusive: number) {
  return Math.floor(random() * maxExclusive);
}

/** Fisher-Yates trên bản sao (bản gốc xáo trộn tại chỗ, dễ làm hỏng mảng của người gọi). */
export function shuffleSeeded<T>(items: readonly T[], ...seeds: Array<string | number>) {
  const random = alea(...seeds);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(random, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Chia người dùng vào nhóm A/B ổn định: cùng (experiment, userId) luôn ra cùng nhóm. */
export function bucketOf(experiment: string, userId: string, buckets: number) {
  return randomInt(alea(experiment, userId), buckets);
}
```

ID trace và nhóm lấy mẫu:

```ts title=src/lib/seededRandom.ts
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DUMMY_TRACE_ID = 'AAAAAAAAAAA';

/**
 * ID trace 11 ký tự base64 = 63 bit: ký tự đầu chỉ 3 bit (0..7) để cả số vừa int64 có dấu.
 * Mỗi lần lấy 31 bit từ PRNG, cắt 6 bit một.
 */
export function createTraceIdGenerator(random: Random) {
  function once() {
    let bits = 0;
    let pool = 0;
    let id = '';
    for (let i = 10; i >= 0; i--) {
      if (bits < 6) {
        pool = Math.floor(0x80000000 * random());
        bits = 31;
      }
      if (i === 0) pool &= 7;
      id = BASE64.charAt(pool & 63) + id;
      pool >>= 6;
      bits -= 6;
    }
    return id;
  }
  return () => {
    // giống bản gốc: thử lại vài lần nếu ra đúng ID "rỗng" dùng làm giá trị giả
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = once();
      if (id !== DUMMY_TRACE_ID) return id;
    }
    return DUMMY_TRACE_ID;
  };
}

/** Nhóm 0..31 suy từ ký tự cuối của ID: lấy mẫu 1/32 mà không cần thêm số ngẫu nhiên. */
export function traceIdToBucket(traceId: string) {
  return BASE64.indexOf(traceId.charAt(traceId.length - 1)) % 32;
}
```

::: spoiler Xem toàn bộ src/lib/seededRandom.ts

```ts title=src/lib/seededRandom.ts
/**
 * Số ngẫu nhiên tái lập được theo seed (ý tưởng từ Alea, randomShuffleSeeded và
 * ArtilleryTraceIDUtils trong bundle Facebook).
 *
 * Alea là thuật toán công khai của Johannes Baagøe (giấy phép MIT); Facebook dùng nguyên
 * hằng số của tác giả. KHÔNG dùng cho mật khẩu, token, ID bí mật: dùng crypto.getRandomValues.
 */

/** Hàm băm Mash: biến chuỗi thành số trong [0, 1). Giữ trạng thái giữa các lần gọi. */
function createMash() {
  let n = 0xefc8249d; // 4022871197
  return (data: string) => {
    for (let i = 0; i < data.length; i++) {
      n += data.charCodeAt(i);
      let h = 0.02519603282416938 * n;
      n = h >>> 0;
      h -= n;
      h *= n;
      n = h >>> 0;
      h -= n;
      n += h * 0x100000000; // 2^32
    }
    return (n >>> 0) * 2.3283064365386963e-10; // 2^-32
  };
}

export type Random = () => number;

/** Tạo PRNG Alea từ một hoặc nhiều seed. Cùng seed → cùng dãy số. */
export function alea(...seeds: Array<string | number>): Random {
  const mash = createMash();
  let s0 = mash(' ');
  let s1 = mash(' ');
  let s2 = mash(' ');
  let carry = 1;
  for (const seed of seeds) {
    const text = String(seed);
    s0 -= mash(text);
    if (s0 < 0) s0 += 1;
    s1 -= mash(text);
    if (s1 < 0) s1 += 1;
    s2 -= mash(text);
    if (s2 < 0) s2 += 1;
  }
  return () => {
    const t = 2091639 * s0 + carry * 2.3283064365386963e-10;
    s0 = s1;
    s1 = s2;
    return (s2 = t - (carry = t | 0));
  };
}

/** Seed khó trùng khi không truyền seed: bản gốc dùng new Date() (Mash đổi ra chuỗi, chỉ tới giây), hai tab mở trong cùng một giây sẽ trùng dãy. */
export function randomSeed() {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return `${buf[0].toString(36)}${buf[1].toString(36)}`;
}

export function randomInt(random: Random, maxExclusive: number) {
  return Math.floor(random() * maxExclusive);
}

/** Fisher-Yates trên bản sao (bản gốc xáo trộn tại chỗ, dễ làm hỏng mảng của người gọi). */
export function shuffleSeeded<T>(items: readonly T[], ...seeds: Array<string | number>) {
  const random = alea(...seeds);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(random, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Chia người dùng vào nhóm A/B ổn định: cùng (experiment, userId) luôn ra cùng nhóm. */
export function bucketOf(experiment: string, userId: string, buckets: number) {
  return randomInt(alea(experiment, userId), buckets);
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DUMMY_TRACE_ID = 'AAAAAAAAAAA';

/**
 * ID trace 11 ký tự base64 = 63 bit: ký tự đầu chỉ 3 bit (0..7) để cả số vừa int64 có dấu.
 * Mỗi lần lấy 31 bit từ PRNG, cắt 6 bit một.
 */
export function createTraceIdGenerator(random: Random) {
  function once() {
    let bits = 0;
    let pool = 0;
    let id = '';
    for (let i = 10; i >= 0; i--) {
      if (bits < 6) {
        pool = Math.floor(0x80000000 * random());
        bits = 31;
      }
      if (i === 0) pool &= 7;
      id = BASE64.charAt(pool & 63) + id;
      pool >>= 6;
      bits -= 6;
    }
    return id;
  }
  return () => {
    // giống bản gốc: thử lại vài lần nếu ra đúng ID "rỗng" dùng làm giá trị giả
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = once();
      if (id !== DUMMY_TRACE_ID) return id;
    }
    return DUMMY_TRACE_ID;
  };
}

/** Nhóm 0..31 suy từ ký tự cuối của ID: lấy mẫu 1/32 mà không cần thêm số ngẫu nhiên. */
export function traceIdToBucket(traceId: string) {
  return BASE64.indexOf(traceId.charAt(traceId.length - 1)) % 32;
}
```

:::

## Đi qua code

- **`createMash`** viết lại bằng hằng số hex (`0xefc8249d` = 4022871197) cho dễ tra. Mọi phép `>>> 0` lấy 32 bit thấp của phần nguyên; phép nhân với `0.0251…` rồi tách nguyên/thập phân hai lần là cách Baagøe trộn bit chỉ bằng số thực.
- **`alea(...seeds)`** bắt buộc truyền seed (không có mặc định ngầm). Muốn ngẫu nhiên thật thì gọi `alea(randomSeed())`, để việc "không tái lập" là quyết định có chủ ý.
- **`randomSeed`** lấy 64 bit từ `crypto.getRandomValues`, đổi ra chuỗi base36. Có thể in seed ra log: khi người dùng báo lỗi, chạy lại đúng seed đó.
- **`shuffleSeeded`** nhận `readonly T[]`, copy bằng `slice()` rồi Fisher-Yates trên bản sao. TypeScript chặn luôn việc truyền mảng rồi trông đợi nó bị sửa.
- **`bucketOf(experiment, userId, n)`** = số đầu tiên của `alea(experiment, userId)` nhân `n`. Thêm tên thí nghiệm vào seed để mỗi thí nghiệm chia người dùng **độc lập** nhau: người ở nhóm 0 của thí nghiệm này không mặc nhiên ở nhóm 0 của thí nghiệm khác. Demo chia 20.000 người vào 4 nhóm ra khoảng 5.000 mỗi nhóm.
- **`createTraceIdGenerator(random)`** nhận PRNG từ ngoài (dễ test với seed cố định), đặt `bits = 31` cho đúng số bit thật.

**Khác bản gốc:**
- Xáo trên bản sao, không sửa mảng đầu vào.
- Không còn seed mặc định `new Date()` (độ phân giải giây).
- Bỏ phần ghi log khi sinh ID thất bại 3 lần (xác suất `2^-63` mỗi lần, thực tế không xảy ra).

## Tại sao không làm cách khác?

**Băm `userId` (FNV, murmur) rồi mod số nhóm?** Với A/B chỉ cần **một** số ngẫu nhiên, hàm băm là đủ và nhanh hơn. PRNG có seed hơn ở chỗ sinh được **cả dãy** (xáo trộn, chọn nhiều phần tử, mô phỏng).

**`crypto.getRandomValues` cho mọi thứ?** Không có seed nên không tái lập được. Dùng nó cho thứ cần **không đoán được** (token, ID phiên, mật khẩu, nonce bảo mật); dùng PRNG có seed cho thứ cần **tái lập được**. Alea không an toàn mật mã: biết vài số đầu ra có thể suy ngược trạng thái.

**Mulberry32, xoshiro128\*\*, sfc32?** Đều là PRNG nhỏ tốt, có seed, chất lượng thống kê tốt hơn hoặc ngang Alea, và nhận seed 32/128 bit thay vì chuỗi. Alea tiện ở chỗ seed là chuỗi bất kỳ nhờ Mash. Chọn cái nào cũng được, miễn **cố định một thuật toán**: đổi thuật toán là đổi mọi thứ tự đã lưu ngầm theo seed.

**Lấy mẫu bằng `Math.random() < 1/32` ở mỗi tầng?** Mỗi tầng quyết định riêng: client giữ trace, backend bỏ, ra trace thiếu mảnh. Quyết định dựa trên ID thì nhất quán; OpenTelemetry làm đúng như vậy với `TraceIdRatioBased` sampler.

## Edge case và cạm bẫy

- **`Math.floor(random() * n)` lệch nhẹ** khi `n` không chia hết số giá trị có thể của `random()`. Với `n` nhỏ (vài nghìn) độ lệch không đáng kể (~n/2³²); với `n` cỡ tỉ thì dùng phép từ chối (rejection sampling).
- **Đổi danh sách thì thứ tự đổi hết.** Seed cố định nhưng thêm một câu hỏi vào đề là toàn bộ thứ tự xáo khác đi. Muốn ổn định từng phần tử, xếp theo `hash(seed + item.id)` thay vì Fisher-Yates.
- **Seed từ dữ liệu người dùng** (userId) thì ai biết userId cũng tính được nhóm hoặc thứ tự. Không sao với A/B; không được dùng cho thứ cần bí mật (thứ tự đáp án trong bài thi có thưởng).
- **Số thực khác nhau giữa engine?** Alea chỉ dùng phép nhân, cộng, trừ, `>>> 0`, `| 0` trên số double theo IEEE 754, nên mọi trình duyệt và Node cho cùng một dãy. Đừng "tối ưu" bằng `Math.fround` hay đổi thứ tự phép tính.
- **Bộ sinh dùng chung giữa các tính năng.** Hai tính năng cùng gọi một `random()` thì thứ tự gọi quyết định kết quả; thêm một lời gọi ở tính năng A làm đổi kết quả của B. Mỗi việc một bộ sinh, seed riêng.

## Dùng trong dự án

```ts
import { alea, bucketOf, randomSeed, shuffleSeeded } from './seededRandom';

// Đề thi: mỗi thí sinh một thứ tự, ổn định khi tải lại
const ordered = shuffleSeeded(questions, exam.id, user.id);

// A/B: 10% người dùng thấy giao diện mới
const inTreatment = bucketOf('new-checkout-2026', user.id, 100) < 10;

// Test/demo tái lập: in seed ra để chạy lại
const seed = new URLSearchParams(location.search).get('seed') ?? randomSeed();
console.info('seed =', seed);
const random = alea(seed);
```

## Kiểm thử

::: spoiler Ví dụ test (bản phác, không có trong repo)

```ts
import { describe, expect, it } from 'vitest';
import { alea, createTraceIdGenerator, shuffleSeeded, traceIdToBucket } from './seededRandom';

describe('alea', () => {
  it('cùng seed cùng dãy, thứ tự seed có ý nghĩa', () => {
    const a = alea('x', 'y'), b = alea('x', 'y'), c = alea('y', 'x');
    const first = a();
    expect(b()).toBe(first);
    expect(c()).not.toBe(first);
  });
  it('shuffle không sửa mảng gốc và ổn định theo seed', () => {
    const input = [1, 2, 3, 4, 5, 6];
    const once = shuffleSeeded(input, 'quiz', 'u1');
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
    expect(shuffleSeeded(input, 'quiz', 'u1')).toEqual(once);
    expect([...once].sort()).toEqual(input);
  });
  it('ID trace 11 ký tự, ký tự đầu A–H, nhóm lấy mẫu ~1/32', () => {
    const next = createTraceIdGenerator(alea('trace'));
    let zero = 0;
    for (let i = 0; i < 64_000; i++) {
      const id = next();
      expect(id).toMatch(/^[A-H][A-Za-z0-9+/]{10}$/);
      if (traceIdToBucket(id) === 0) zero++;
    }
    expect(zero / 64_000).toBeCloseTo(1 / 32, 2);
  });
});
```

:::

## So với thư viện và chuẩn web

- **seedrandom** (npm) có chính Alea cùng nhiều PRNG khác (xor4096, tychei), API `seedrandom('hello')`. Nếu không muốn tự giữ code, dùng nó.
- **pure-rand** (dùng trong fast-check) có xoroshiro128+, mersenne twister, API bất biến hợp cho property-based testing.
- **Faker**, **fast-check**, **Playwright** đều có tham số seed để test tái lập; nguyên tắc giống bài này: in seed khi test hỏng.
- Lấy mẫu trace: **OpenTelemetry** `TraceIdRatioBasedSampler` quyết định từ các bit của trace ID, W3C Trace Context mang cờ `sampled` để các dịch vụ sau tôn trọng.
- TC39 có đề xuất "Seeded Pseudo-Random Numbers" (`Random.Seeded`), có thể đưa PRNG có seed vào JavaScript chuẩn; tính tới 10/2026 vẫn chưa dùng được trong trình duyệt.

Bài liên quan: [Học từ Facebook #26: ring buffer biết trace nào đã mất log](/blogs/facebook-trace-ring-buffer), [Học từ Facebook #63: cây tổng và rút thăm theo trọng số](/blogs/facebook-fenwick-weighted-random).

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
- **#66 PRNG có seed, shuffle tái lập và lấy mẫu trace** (bài này)
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

:::

Code + demo: [`examples/facebook-patterns`](https://github.com/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns) · [Mở trên StackBlitz](https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns)
