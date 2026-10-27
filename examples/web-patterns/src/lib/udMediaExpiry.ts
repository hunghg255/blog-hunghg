/**
 * Dữ liệu media có hai hạn dùng khác nhau (ý tưởng từ lecture.mobx-model.js của Udemy):
 * - URL ký (signed URL) của video sống lâu, Udemy giả định 4 giờ;
 * - token license DRM sống ngắn, 5 phút.
 * Hết hạn phần nào thì chỉ tải lại phần đó. Player báo lỗi thì làm mới rồi phát lại.
 * Bài kế tiếp được tải trước khi bài hiện tại gần xong.
 */

export const ASSET_URL_TTL = 4 * 60 * 60 * 1000;
export const LICENSE_TOKEN_TTL = 5 * 60 * 1000;

export type RefreshKind = 'none' | 'full' | 'license';

export interface ExpiringMediaOptions<Data> {
  /** tải toàn bộ: URL ký + token license */
  fetchAll: () => Promise<Data>;
  /** chỉ xin token license mới */
  fetchLicense: () => Promise<string>;
  dataTtl?: number;
  licenseTtl?: number;
  /** khoảng tối thiểu giữa hai lần làm mới do player báo lỗi, chống vòng lặp lỗi → làm mới → lỗi */
  errorRefreshCooldown?: number;
  now?: () => number;
}

export interface ExpiringMedia<Data> {
  readonly data: Data | undefined;
  readonly licenseToken: string | undefined;
  isDataExpired(): boolean;
  isLicenseExpired(): boolean;
  /** tải phần đã hết hạn; nhiều lần gọi cùng lúc dùng chung một request */
  ensureFresh(): Promise<RefreshKind>;
  /**
   * Player báo lỗi nguồn (403/404 khi tải segment) hoặc lỗi license.
   * Làm mới phần tương ứng KỂ CẢ khi đồng hồ phía client cho là chưa hết hạn,
   * nhưng không quá một lần trong `errorRefreshCooldown`.
   */
  handlePlayerError(kind: 'source' | 'license'): Promise<'retry' | 'give-up'>;
}

export function createExpiringMedia<Data extends { licenseToken?: string }>({
  fetchAll,
  fetchLicense,
  dataTtl = ASSET_URL_TTL,
  licenseTtl = LICENSE_TOKEN_TTL,
  errorRefreshCooldown = 30_000,
  now = Date.now,
}: ExpiringMediaOptions<Data>): ExpiringMedia<Data> {
  let data: Data | undefined;
  let licenseToken: string | undefined;
  // -Infinity = chưa tải lần nào; chỉ gán khi request THÀNH CÔNG
  let dataLoadedAt = -Infinity;
  let licenseLoadedAt = -Infinity;
  let lastErrorRefresh = -Infinity;
  let inFlight: Promise<RefreshKind> | null = null;

  const isDataExpired = () => now() - dataLoadedAt > dataTtl;
  const isLicenseExpired = () => now() - licenseLoadedAt > licenseTtl;

  function run(kind: Exclude<RefreshKind, 'none'>): Promise<RefreshKind> {
    // Mốc thời gian lấy lúc BẮT ĐẦU request: URL được server ký trước khi response về tới nơi,
    // nên tính hạn từ lúc nhận response sẽ sống "lâu hơn" thực tế một khoảng bằng độ trễ mạng.
    const startedAt = now();
    const job =
      kind === 'full'
        ? fetchAll().then((next) => {
            data = next;
            licenseToken = next.licenseToken;
            dataLoadedAt = startedAt;
            licenseLoadedAt = startedAt;
          })
        : fetchLicense().then((token) => {
            licenseToken = token;
            licenseLoadedAt = startedAt;
          });
    const current = job.then(() => kind);
    inFlight = current;
    // dù thành công hay lỗi cũng nhả khoá; lỗi thì mốc thời gian giữ nguyên nên lần sau vẫn tải lại
    current
      .finally(() => {
        if (inFlight === current) inFlight = null;
      })
      .catch(() => {});
    return current;
  }

  function ensureFresh(): Promise<RefreshKind> {
    if (inFlight) return inFlight;
    if (isDataExpired()) return run('full');
    if (isLicenseExpired()) return run('license');
    return Promise.resolve('none');
  }

  async function handlePlayerError(kind: 'source' | 'license') {
    if (now() - lastErrorRefresh < errorRefreshCooldown) return 'give-up';
    lastErrorRefresh = now();
    // ép hết hạn rồi tải lại: đồng hồ client có thể lệch, tab có thể đã ngủ,
    // hoặc server cấp URL sống ngắn hơn con số client giả định
    if (kind === 'source') dataLoadedAt = -Infinity;
    else licenseLoadedAt = -Infinity;
    try {
      await ensureFresh();
      return 'retry';
    } catch {
      return 'give-up';
    }
  }

  return {
    get data() {
      return data;
    },
    get licenseToken() {
      return licenseToken;
    },
    isDataExpired,
    isLicenseExpired,
    ensureFresh,
    handlePlayerError,
  };
}

/**
 * Tải trước bài kế khi bài hiện tại còn `offsetSeconds` giây. Gọi bao nhiêu lần cũng được:
 * `ensureFresh` đã gộp request đang chạy và bỏ qua khi dữ liệu còn hạn.
 */
export function maybePreloadNext(
  currentTime: number,
  duration: number,
  next: { ensureFresh(): Promise<RefreshKind> } | undefined,
  offsetSeconds = 15,
) {
  if (!next || duration <= 0) return;
  if (duration - currentTime <= offsetSeconds) {
    void next.ensureFresh().catch(() => {
      // tải trước thất bại không ảnh hưởng bài đang xem; lúc mở bài kế sẽ tải lại
    });
  }
}
