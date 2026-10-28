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
