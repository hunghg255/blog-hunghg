/**
 * Proxy có đệm (ý tưởng từ AdsFuncChannel): gọi được ngay cả khi "backend" thật chưa tải xong;
 * lời gọi được xếp hàng và chạy theo đúng thứ tự khi có backend.
 * Khác bản gốc: mọi lời gọi trả Promise của kết quả thật (bản gốc trả undefined khi đang đệm),
 * và không có lớp bọc chạy lại lúc xả hàng (bản gốc chạy lớp bọc hai lần với đối số đã bọc).
 */

type AnyFn = (...args: never[]) => unknown;
type Methods<T> = { [K in keyof T]: T[K] extends AnyFn ? K : never }[keyof T];

export type BufferedProxy<T> = {
  [K in Methods<T>]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never;
};

interface Call {
  method: PropertyKey;
  args: unknown[];
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export function createBufferedProxy<T extends object>(
  methods: readonly Methods<T>[],
  options: { maxBuffer?: number } = {},
) {
  const maxBuffer = options.maxBuffer ?? 1000;
  let backend: T | null = null;
  let buffer: Call[] = [];

  const invoke = (method: PropertyKey, args: unknown[]) =>
    // async: lỗi đồng bộ của backend cũng thành Promise bị reject, như khi đang đệm
    (async () => (backend as Record<PropertyKey, (...a: unknown[]) => unknown>)[method](...args))();

  const proxy = {} as BufferedProxy<T>;
  for (const method of methods) {
    (proxy as Record<PropertyKey, unknown>)[method] = (...args: unknown[]) => {
      if (backend) return invoke(method, args);
      if (buffer.length >= maxBuffer)
        return Promise.reject(new Error('bufferedProxy: hàng đợi đầy'));
      return new Promise((resolve, reject) => buffer.push({ method, args, resolve, reject }));
    };
  }

  return {
    proxy,
    get pending() {
      return buffer.length;
    },
    setBackend(next: T | null) {
      backend = next;
      if (!next) return;
      const calls = buffer;
      buffer = [];
      // theo đúng thứ tự gọi; một lời gọi lỗi không chặn các lời gọi sau
      for (const call of calls) invoke(call.method, call.args).then(call.resolve, call.reject);
    },
  };
}
