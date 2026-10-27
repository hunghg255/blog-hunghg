/**
 * OTID (offline threading ID): ID tin nhắn do client tự sinh, sắp được theo thời gian
 * (ý tưởng từ MercuryLocalIDs.generateOfflineThreadingID của Messenger web).
 *
 *   63 bit = [ 41 bit Date.now() ][ 22 bit ngẫu nhiên ]
 *
 * - Sinh ngay khi bấm gửi, không cần hỏi server.
 * - Hai OTID sinh ở hai mili-giây khác nhau luôn so được đúng thứ tự thời gian.
 * - Server dội tin về kèm lại OTID, client dùng nó để ghép bản "đang gửi" với bản thật.
 */

export const OTID_TIME_BITS = 41;
export const OTID_RANDOM_BITS = 22;
/** Mốc Date.now() làm phần thời gian vượt 41 bit: 2^41 ms ≈ 2039-09-07 15:47 UTC. */
export const OTID_TIME_LIMIT = 2 ** OTID_TIME_BITS;

const RANDOM_MASK = (1n << BigInt(OTID_RANDOM_BITS)) - 1n;
const ID_MASK = (1n << 63n) - 1n;

function random22(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] & Number(RANDOM_MASK);
}

export interface OtidOptions {
  /** mặc định Date.now() */
  now?: number;
  /** 22 bit ngẫu nhiên, mặc định lấy từ crypto.getRandomValues */
  random?: number;
}

/** Sinh OTID dạng chuỗi số thập phân (JSON và server đều nhận chuỗi, không mất chính xác). */
export function generateOtid({ now = Date.now(), random = random22() }: OtidOptions = {}): string {
  if (!Number.isInteger(now) || now < 0) throw new RangeError(`now không hợp lệ: ${now}`);
  if (now >= OTID_TIME_LIMIT) {
    // Bản gốc cắt lấy 63 bit cuối nên tới mốc này ID sẽ quay vòng về số nhỏ.
    // Ở đây báo lỗi rõ ràng thay vì âm thầm sinh ID sai thứ tự.
    throw new RangeError('Date.now() đã vượt 41 bit, cần đổi định dạng OTID');
  }
  const id = ((BigInt(now) << BigInt(OTID_RANDOM_BITS)) | (BigInt(random) & RANDOM_MASK)) & ID_MASK;
  return id.toString();
}

/** Lấy lại thời điểm sinh (ms) từ một OTID. */
export function otidTime(otid: string): number {
  return Number(BigInt(otid) >> BigInt(OTID_RANDOM_BITS));
}

/** So hai OTID theo giá trị số (không so chuỗi: "999" > "1000" theo chuỗi). */
export function compareOtid(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Bản chép lại thuật toán gốc để so sánh: ghép chuỗi nhị phân, cắt 63 ký tự cuối,
 * rồi đổi nhị phân → thập phân bằng phép chia dài thủ công (thời chưa có BigInt).
 */
export function generateOtidFbStyle(now: number, random: number): string {
  const randBits = ('0000000000000000000000' + (random >>> 0).toString(2)).slice(-22);
  const bits = (now.toString(2) + randBits).slice(-63);
  return binaryToDecimal(bits);
}

function binaryToDecimal(bits: string): string {
  let out = '';
  let rest = bits;
  while (rest !== '0') {
    let carry = 0;
    let quotient = '';
    for (let i = 0; i < rest.length; i++) {
      carry = 2 * carry + Number(rest[i]);
      if (carry >= 10) {
        quotient += '1';
        carry -= 10;
      } else {
        quotient += '0';
      }
    }
    out = carry.toString() + out;
    rest = quotient.slice(quotient.indexOf('1'));
  }
  return out;
}
