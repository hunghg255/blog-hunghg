/**
 * Bitmap "tài nguyên đã có ở client", nén bằng run-length + mã Elias-gamma + base64 URL-safe
 * (ý tưởng từ BitMap / CSRBitMap trong Bootloader của Facebook).
 *
 * Facebook gửi chuỗi này kèm MỌI request async (tham số trong getAsyncParams), để server
 * khỏi gửi lại JS/CSS mà tab đã tải. Mỗi tài nguyên có một số thứ tự cố định do server cấp.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';

/** Elias-gamma: n (≥ 1) viết nhị phân, thêm (số bit - 1) số 0 ở trước để tự mô tả độ dài. */
export function eliasGamma(n: number) {
  const bits = n.toString(2);
  return '0'.repeat(bits.length - 1) + bits;
}

/** Chuỗi bit -> base64 URL-safe theo bảng riêng (đệm số 0 cho đủ bội số của 6). */
function packBits(bits: string) {
  let out = '';
  for (let i = 0; i < bits.length; i += 6) {
    out += ALPHABET[parseInt(bits.slice(i, i + 6).padEnd(6, '0'), 2)];
  }
  return out;
}

function unpackBits(text: string) {
  let bits = '';
  for (const ch of text) {
    const value = ALPHABET.indexOf(ch);
    if (value === -1) throw new Error(`Ký tự không hợp lệ: ${ch}`);
    bits += value.toString(2).padStart(6, '0');
  }
  return bits;
}

export class ResourceBitmap {
  private bits: number[] = [];
  /** cache chuỗi nén; chỉ huỷ khi có bit MỚI được bật */
  private cached: string | null = null;

  set(index: number) {
    if (!this.bits[index]) this.cached = null;
    this.bits[index] = 1;
    return this;
  }

  has(index: number) {
    return this.bits[index] === 1;
  }

  get length() {
    return this.bits.length;
  }

  /** Không nén: mỗi tài nguyên một bit. */
  toRawString() {
    let bits = '';
    for (let i = 0; i < this.bits.length; i++) bits += this.bits[i] ? '1' : '0';
    return bits ? packBits(bits) : '';
  }

  /**
   * Nén: bit đầu tiên cho biết run đầu là 0 hay 1, sau đó độ dài từng run (dãy bit giống
   * nhau liên tiếp) mã Elias-gamma. Tài nguyên thường được tải theo cụm nên run rất dài.
   */
  toCompressedString() {
    if (this.bits.length === 0) return '';
    if (this.cached != null) return this.cached;
    let current = this.bits[0] ? 1 : 0;
    let out = String(current);
    let run = 1;
    for (let i = 1; i < this.bits.length; i++) {
      const bit = this.bits[i] ? 1 : 0;
      if (bit === current) run++;
      else {
        out += eliasGamma(run);
        current = bit;
        run = 1;
      }
    }
    out += eliasGamma(run);
    return (this.cached = packBits(out));
  }
}

/**
 * Giải nén (phía server làm việc này; ở đây để chứng minh mã hoá không mất thông tin).
 * Phần đệm số 0 ở cuối không bao giờ thành một mã Elias-gamma hợp lệ nên tự bị bỏ qua.
 */
export function decodeCompressed(text: string): number[] {
  if (!text) return [];
  const bits = unpackBits(text);
  let value = bits[0] === '1' ? 1 : 0;
  const out: number[] = [];
  let i = 1;
  while (i < bits.length) {
    let zeros = 0;
    while (i + zeros < bits.length && bits[i + zeros] === '0') zeros++;
    if (i + zeros + zeros + 1 > bits.length) break; // chỉ còn phần đệm
    const run = parseInt(bits.slice(i + zeros, i + zeros + zeros + 1), 2);
    for (let k = 0; k < run; k++) out.push(value);
    value = 1 - value;
    i += zeros + zeros + 1;
  }
  return out;
}

// ---- Client consistency: deploy mới thì chỉ reload khi CODE ĐANG DÙNG bị đổi ----

export type RefreshLevel = 'soft' | 'hard';
const LEVELS: Record<string, RefreshLevel | undefined> = { '2': 'soft', '3': 'hard' };
const RANK: Record<RefreshLevel, number> = { soft: 1, hard: 2 };

/** Phiên bản tối giản của requireWeak: gọi callback khi module được nạp (ngay nếu đã nạp). */
export interface ModuleRegistry {
  onLoaded(name: string, callback: () => void): void;
}

export interface ConsistencyPayload {
  /** revision của bản deploy server đang chạy */
  rev: number;
  /** mức hành động -> các module bị đổi; mảng rỗng = áp dụng cho mọi client */
  actions: Record<string, string[]>;
}

/**
 * Server đính kèm `{ rev, actions }` vào response. Ví dụ `{ "3": ["Payments"], "2": ["Composer"] }`:
 * client nào ĐÃ hoặc SẼ nạp Payments phải hard refresh, nạp Composer thì soft refresh.
 *
 * Khác bản gốc (ClientConsistency): bản gốc chỉ đăng ký theo dõi mỗi module MỘT lần trong
 * suốt vòng đời tab, nên nếu một deploy sau nâng module từ soft lên hard thì có lẽ không bao
 * giờ phát hard refresh. Ở đây nhớ mức đã phát cho từng module và phát lại khi mức tăng.
 */
export function createConsistencyChecker(
  clientRevision: number,
  registry: ModuleRegistry,
  emit: (level: RefreshLevel, reason: string) => void,
) {
  const required = new Map<string, RefreshLevel>(); // mức cao nhất server yêu cầu cho module
  const emitted = new Map<string, RefreshLevel>(); // mức đã phát cho module
  const watching = new Set<string>();
  const loaded = new Set<string>(); // module đã nạp (biết qua callback của registry)

  const fire = (module: string) => {
    const level = required.get(module);
    if (!level) return;
    const already = emitted.get(module);
    if (already && RANK[already] >= RANK[level]) return;
    emitted.set(module, level);
    emit(level, module);
  };

  return function handle(payload: ConsistencyPayload) {
    if (payload.rev === clientRevision) return;
    // mức cao xét trước: "3" rồi mới "2"
    const keys = Object.keys(payload.actions).sort((a, b) => Number(b) - Number(a));
    for (const key of keys) {
      const level = LEVELS[key];
      if (!level) continue;
      const modules = payload.actions[key] ?? [];
      if (modules.length === 0) {
        // không kèm module: mọi tab đều phải làm, và không cần xét mức thấp hơn
        emit(level, '*');
        return;
      }
      for (const module of modules) {
        const previous = required.get(module);
        if (!previous || RANK[level] > RANK[previous]) required.set(module, level);
        if (watching.has(module)) {
          // đã theo dõi từ deploy trước: nếu module đang chạy thì kiểm lại với mức mới
          if (loaded.has(module)) fire(module);
        } else {
          watching.add(module);
          registry.onLoaded(module, () => {
            loaded.add(module);
            fire(module);
          });
        }
      }
    }
  };
}
