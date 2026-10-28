/**
 * Cây tổng nhị phân lưu trong mảng (ý tưởng từ BinaryIndexedTree của Facebook).
 *
 * Tên gốc là "Binary Indexed Tree" nhưng cấu trúc thật là một cây nhị phân hoàn chỉnh
 * kiểu heap: lá ở [cap, cap + n), node i là tổng của 2i và 2i + 1, gốc ở 1.
 * - set/get/sumUntil: O(log n)
 * - greatestLowerBound(v): đi XUỐNG từ gốc để tìm chỉ số lớn nhất có tổng tiền tố ≤ v,
 *   cũng O(log n). Đây là thứ cần cho "chọn ngẫu nhiên theo trọng số" và "dòng nào
 *   đang ở pixel y" khi chiều cao từng dòng khác nhau.
 *
 * Khác bản gốc: dùng Float64Array (bản gốc dùng Int32Array nên trọng số 0.5 thành 0,
 * và tổng vượt 2^31 bị tràn ở node gốc).
 */
export class SumTree {
  readonly size: number;
  private readonly cap: number;
  private readonly tree: Float64Array;

  constructor(values: ArrayLike<number>) {
    this.size = values.length;
    let cap = 1;
    while (cap < this.size) cap *= 2;
    this.cap = cap;
    this.tree = new Float64Array(2 * cap);
    for (let i = 0; i < this.size; i++) this.tree[cap + i] = checkWeight(values[i]);
    for (let i = cap - 1; i > 0; i--) this.tree[i] = this.tree[2 * i] + this.tree[2 * i + 1];
  }

  static uniform(size: number, value: number) {
    return new SumTree(new Array<number>(size).fill(value));
  }

  get(index: number) {
    this.checkIndex(index);
    return this.tree[this.cap + index];
  }

  /** Đổi một giá trị rồi tính lại các node cha từ hai con (không cộng dồn delta nên không trôi sai số). */
  set(index: number, value: number) {
    this.checkIndex(index);
    let node = this.cap + index;
    this.tree[node] = checkWeight(value);
    for (node >>= 1; node > 0; node >>= 1) {
      this.tree[node] = this.tree[2 * node] + this.tree[2 * node + 1];
    }
  }

  total() {
    return this.tree[1] ?? 0;
  }

  /** Tổng các phần tử [0, end). */
  sumUntil(end: number) {
    if (end < 0 || end > this.size) throw new RangeError(`end ${end} ngoài [0, ${this.size}]`);
    if (end === 0) return 0;
    let node = this.cap + end - 1;
    let sum = this.tree[node];
    for (; node !== 1; node >>= 1) {
      // node là con phải thì cộng cả anh em bên trái
      if (node % 2 === 1) sum += this.tree[node - 1];
    }
    return sum;
  }

  /**
   * Chỉ số i lớn nhất sao cho sumUntil(i) ≤ value, tức phần tử "chứa" vị trí value.
   * value < 0 → -1; value ≥ total → size.
   */
  greatestLowerBound(value: number) {
    if (value < 0) return -1;
    if (this.tree[1] <= value) return this.size;
    let node = 1;
    while (node < this.cap) {
      const left = this.tree[2 * node];
      if (value < left) {
        node = 2 * node;
      } else {
        value -= left;
        node = 2 * node + 1;
      }
    }
    return node - this.cap;
  }

  private checkIndex(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.size) {
      throw new RangeError(`index ${index} ngoài [0, ${this.size})`);
    }
  }
}

function checkWeight(value: number) {
  if (!(value >= 0) || !Number.isFinite(value)) throw new RangeError(`trọng số phải ≥ 0, nhận ${value}`);
  return value;
}

/** Rút thăm theo trọng số, trọng số đổi được bất cứ lúc nào, mỗi lần O(log n). */
export class WeightedPicker {
  private readonly tree: SumTree;

  constructor(weights: ArrayLike<number>, private readonly random: () => number = Math.random) {
    this.tree = new SumTree(weights);
  }

  setWeight(index: number, weight: number) {
    this.tree.set(index, weight);
  }

  weight(index: number) {
    return this.tree.get(index);
  }

  total() {
    return this.tree.total();
  }

  /** -1 nếu mọi trọng số bằng 0. */
  pick() {
    const total = this.tree.total();
    if (total <= 0) return -1;
    // random() ∈ [0, 1) nên r < total; lá có trọng số 0 không bao giờ "chứa" r
    return this.tree.greatestLowerBound(this.random() * total);
  }
}

/**
 * Vị trí dòng trong danh sách có chiều cao khác nhau (ý tưởng FixedDataTableScrollHelper):
 * dòng chưa đo dùng chiều cao ước lượng, đo xong thì set lại trong cây.
 */
export class RowOffsets {
  private readonly tree: SumTree;

  constructor(rowCount: number, estimatedHeight: number) {
    this.tree = SumTree.uniform(rowCount, estimatedHeight);
  }

  get rowCount() {
    return this.tree.size;
  }

  contentHeight() {
    return this.tree.total();
  }

  setHeight(row: number, height: number) {
    this.tree.set(row, height);
  }

  height(row: number) {
    return this.tree.get(row);
  }

  top(row: number) {
    return this.tree.sumUntil(row);
  }

  /** Dòng đầu tiên nhìn thấy ở scrollTop và phần của nó đã bị cuộn qua. */
  rowAt(scrollTop: number) {
    if (this.tree.size === 0) return { row: 0, offset: 0 };
    const row = Math.min(Math.max(this.tree.greatestLowerBound(scrollTop), 0), this.tree.size - 1);
    return { row, offset: scrollTop - this.tree.sumUntil(row) };
  }
}
