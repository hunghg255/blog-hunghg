/**
 * Thống kê trên cửa sổ thời gian trượt, gộp mẫu vào bucket (ý tưởng từ MovingStat của Facebook).
 *
 * Không lưu từng mẫu: mẫu rơi vào cùng một bucket (mặc định 1 giây) thì cộng dồn.
 * Hỏi `tally()` thì bỏ các bucket đã ra khỏi cửa sổ rồi trả sum/count/trung bình.
 *
 * Khác bản gốc:
 * - Bản gốc không bao giờ bỏ bucket cuối cùng (điều kiện vòng lặp đòi bucket phải có `next`),
 *   nên sau một lúc im lặng `tally()` vẫn trả số liệu cũ. Bản này bỏ cả bucket cuối.
 * - Bucket được bỏ theo thời điểm KẾT THÚC (start + bucketMs), không theo lúc bắt đầu.
 * - Trung bình chia cho phần cửa sổ đã thực sự trôi qua, không chia cả cửa sổ khi vừa khởi tạo.
 * - Đồng hồ truyền vào được, để test và demo tua thời gian.
 */

interface Bucket {
  start: number;
  sum: number;
  count: number;
}

export interface MovingStatOptions {
  windowMs?: number;
  bucketMs?: number;
  now?: () => number;
}

export class MovingStat {
  private buckets: Bucket[] = [];
  private sum = 0;
  private count = 0;
  private readonly createdAt: number;
  readonly windowMs: number;
  private readonly bucketMs: number;
  private readonly now: () => number;

  constructor({ windowMs = 60_000, bucketMs = 1_000, now = Date.now }: MovingStatOptions = {}) {
    this.windowMs = windowMs > 0 ? windowMs : 60_000;
    this.bucketMs = bucketMs;
    this.now = now;
    this.createdAt = now();
  }

  add(value: number) {
    const t = this.now();
    this.evict(t);
    this.sum += value;
    this.count++;
    const last = this.buckets[this.buckets.length - 1];
    if (last && t - last.start < this.bucketMs) {
      last.sum += value;
      last.count++;
    } else {
      this.buckets.push({ start: t, sum: value, count: 1 });
    }
  }

  /** `per`: trung bình trên mỗi `per` ms, mặc định "mỗi giây". */
  tally(per = 1_000) {
    const t = this.now();
    this.evict(t);
    const elapsed = Math.min(this.windowMs, Math.max(t - this.createdAt, this.bucketMs));
    return { sum: this.sum, count: this.count, ratePer: (this.sum * per) / elapsed, buckets: this.buckets.length };
  }

  private evict(t: number) {
    const cutoff = t - this.windowMs;
    let drop = 0;
    while (drop < this.buckets.length && this.buckets[drop].start + this.bucketMs <= cutoff) {
      this.sum -= this.buckets[drop].sum;
      this.count -= this.buckets[drop].count;
      drop++;
    }
    if (drop > 0) this.buckets.splice(0, drop);
  }
}
