/**
 * Mô phỏng vòng drain của MercurySyncDeltaHandler bản gốc để so sánh trong demo
 * (viết lại theo logic đã giải mã, KHÔNG phải mã nguồn của Meta).
 *
 * Hai điểm khác bản viết lại:
 *  1. Gặp lỗ là gọi global fetch NGAY, không chờ delta tới trễ.
 *  2. Sau khi xử lý một lệnh trong hàng "fake DFF", hàm đệ quy rồi CHẠY TIẾP xuống phần
 *     dưới mà không return. Nếu lệnh vừa xử lý đã bắt đầu một fetch, khung ngoài vẫn
 *     peek/áp dụng delta, hoặc bắt đầu fetch thứ hai và đụng invariant 5134.
 */

export interface FbStyleOptions {
  apply: (seqId: number) => void;
  fetchGlobal: () => Promise<number>;
  onEvent: (text: string, tone?: 'ok' | 'warn' | 'err') => void;
}

export function createFbStyleSync({ apply, fetchGlobal, onEvent }: FbStyleOptions) {
  const ids: number[] = [];
  let last = 0;
  let busy = 0; // $4
  const fakeDffQueue: string[] = []; // $5: lệnh forced fetch toàn cục do server đẩy

  const peek = () => ids.sort((a, b) => a - b)[0];
  const pop = () => ids.sort((a, b) => a - b).shift();

  function globalDff() {
    if (busy) {
      onEvent('invariant 5134: bắt đầu fetch khi đã có fetch đang chạy', 'err');
      throw new Error('invariant 5134');
    }
    busy++;
    onEvent('global DFF: tải lại toàn bộ…', 'warn');
    fetchGlobal().then((seq) => {
      busy--;
      last = seq;
      onEvent(`global DFF xong, lastSeqID = ${seq}`, 'ok');
      drain();
    });
  }

  function drain(): void {
    if (busy > 0) return;
    if (fakeDffQueue.length > 0) {
      fakeDffQueue.shift();
      globalDff();
      drain(); // trả về ngay vì busy > 0…
      // …nhưng bản gốc KHÔNG return ở đây: chạy tiếp xuống dưới dù đang fetch
    }
    const next = peek();
    if (next === undefined) return;
    const diff = next - last;
    if (diff === 1) {
      pop();
      last = next;
      apply(next);
      onEvent(`áp dụng #${next}${busy ? ' (trong lúc global DFF đang chạy!)' : ''}`, busy ? 'warn' : undefined);
      drain();
    } else if (diff > 1) {
      onEvent(`lỗ: last=${last}, next=${next} → global DFF ngay`, 'warn');
      globalDff();
    } else {
      pop();
      drain();
    }
  }

  return {
    init(seq: number) {
      last = seq;
    },
    receive(seq: number) {
      if (!ids.includes(seq)) ids.push(seq);
      drain();
    },
    pause() {
      busy++;
    },
    resume() {
      busy--;
      drain();
    },
    receiveFakeGlobalDff() {
      fakeDffQueue.push('global');
      drain();
    },
    get lastSeqId() {
      return last;
    },
  };
}
