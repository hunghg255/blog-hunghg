/**
 * Proof-of-work (PoW) phía client: trước khi gọi một API ẩn danh, trình duyệt phải tìm một
 * chuỗi `nonce` sao cho HMAC-SHA256(salt, message + nonce) có N bit đầu bằng 0.
 * Server kiểm tra chỉ tốn MỘT lần băm; client phải thử trung bình 2^N lần.
 *
 * Ý tưởng từ udemy.com (webpack---/src/udemy/js/utils/upow.js), dùng cho form "chia sẻ
 * khoá học qua email". Bản viết lại dùng Web Crypto (crypto.subtle) thay cho thư viện
 * create-hmac, thêm challenge do server cấp (chống tính trước + dùng lại), huỷ được và báo
 * tiến độ.
 */

/** 0 → "A", 25 → "Z", 26 → "AA", 27 → "AB"… (giống tên cột Excel, cơ số 26 "song ánh"). */
export function intToAlphaString(i: number): string {
  let out = '';
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) {
    out = String.fromCharCode(65 + (n % 26)) + out;
  }
  return out;
}

/** `bits` bit đầu tiên của mảng byte có bằng 0 hết không. */
export function hasLeadingZeroBits(bytes: Uint8Array, bits: number): boolean {
  let i = 0;
  for (; bits >= 8; bits -= 8, i++) {
    if (bytes[i] !== 0) return false;
  }
  // còn lẻ `bits` bit (0–7): mặt nạ lấy `bits` bit cao nhất của byte kế tiếp
  return bits === 0 || (bytes[i] & (0xff << (8 - bits)) & 0xff) === 0;
}

const encoder = new TextEncoder();

export function importHmacKey(salt: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function hmac(key: CryptoKey, text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text)));
}

export interface SolveOptions {
  salt: string;
  /** dữ liệu cần "trả phí": email người nhận + challenge server cấp… */
  message: string;
  /** số bit 0 ở đầu; mỗi bit thêm vào làm số lần thử trung bình gấp đôi */
  difficulty: number;
  signal?: AbortSignal;
  onProgress?: (attempts: number) => void;
  /** số lần băm chạy song song mỗi đợt (crypto.subtle là async) */
  batch?: number;
}

export interface Solution {
  nonce: string;
  attempts: number;
  ms: number;
}

export async function solve({ salt, message, difficulty, signal, onProgress, batch = 256 }: SolveOptions): Promise<Solution> {
  const key = await importHmacKey(salt);
  const started = performance.now();
  for (let base = 0; ; base += batch) {
    signal?.throwIfAborted();
    const nonces = Array.from({ length: batch }, (_, k) => intToAlphaString(base + k));
    const hashes = await Promise.all(nonces.map((nonce) => hmac(key, message + nonce)));
    // lấy nonce NHỎ NHẤT đạt yêu cầu trong đợt, để kết quả giống hệt bản chạy tuần tự
    const hit = hashes.findIndex((h) => hasLeadingZeroBits(h, difficulty));
    if (hit !== -1) {
      return { nonce: nonces[hit], attempts: base + hit + 1, ms: performance.now() - started };
    }
    onProgress?.(base + batch);
  }
}

/** Phía server: chỉ băm đúng một lần. */
export async function verify(salt: string, message: string, nonce: string, difficulty: number): Promise<boolean> {
  return hasLeadingZeroBits(await hmac(await importHmacKey(salt), message + nonce), difficulty);
}

// ---- Challenge do server cấp ----

export interface Challenge {
  /** chuỗi ngẫu nhiên, chỉ dùng được một lần */
  id: string;
  difficulty: number;
  /** hết hạn (ms since epoch): lời giải cũ không dùng lại được mãi */
  expiresAt: number;
}

/** Thông điệp được băm: gắn cả dữ liệu lẫn challenge, đổi một trong hai là phải giải lại. */
export const challengeMessage = (payload: string, challenge: Challenge) =>
  `${payload}|${challenge.id}|${challenge.expiresAt}`;

export type VerifyResult = 'ok' | 'bad-proof' | 'unknown-challenge' | 'expired' | 'reused';

/**
 * Phía server (mô phỏng trong trình duyệt cho demo; thật thì nằm ở backend): cấp challenge,
 * kiểm lời giải, và đánh dấu challenge đã dùng để không gửi lại được.
 */
export function createChallengeIssuer({ salt, difficulty, ttlMs = 5 * 60_000, now = Date.now }: {
  salt: string;
  difficulty: number;
  ttlMs?: number;
  now?: () => number;
}) {
  const open = new Map<string, Challenge>();
  const used = new Set<string>();

  return {
    issue(): Challenge {
      const challenge = { id: crypto.randomUUID(), difficulty, expiresAt: now() + ttlMs };
      open.set(challenge.id, challenge);
      return challenge;
    },
    async redeem(payload: string, challengeId: string, nonce: string): Promise<VerifyResult> {
      if (used.has(challengeId)) return 'reused';
      const challenge = open.get(challengeId);
      if (!challenge) return 'unknown-challenge';
      if (now() > challenge.expiresAt) {
        open.delete(challengeId);
        return 'expired';
      }
      // độ khó lấy từ challenge server đã lưu, không tin con số client gửi lên
      if (!(await verify(salt, challengeMessage(payload, challenge), nonce, challenge.difficulty))) return 'bad-proof';
      open.delete(challengeId);
      used.add(challengeId);
      return 'ok';
    },
  };
}
