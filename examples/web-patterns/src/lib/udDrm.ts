/**
 * Chọn hệ DRM theo trình duyệt và định dạng license request/response cho từng hệ
 * (ý tưởng từ shaka-video-player/drm.ts của Udemy, viết lại từ đầu).
 *
 * - Dò hệ hỗ trợ bằng navigator.requestMediaKeySystemAccess, nhớ kết quả theo (hệ, cấu hình).
 * - Thứ tự ưu tiên giống Udemy: Widevine → FairPlay → PlayReady.
 * - Mỗi hệ một kiểu license request: Widevine/PlayReady gửi bytes thô, FairPlay gửi form
 *   `spc=<base64>&assetId=<id>` và nhận về base64.
 */

export const WIDEVINE = 'com.widevine.alpha';
export const PLAYREADY = 'com.microsoft.playready';
export const FAIRPLAY = 'com.apple.fps.1_0';
export const CLEARKEY = 'org.w3.clearkey';

export type KeySystem = typeof WIDEVINE | typeof PLAYREADY | typeof FAIRPLAY | typeof CLEARKEY;

/** Cấu hình tối thiểu giống Udemy: AAC + H.264, robustness phần mềm. */
export const DASH_CONFIG: MediaKeySystemConfiguration = {
  initDataTypes: ['cenc'],
  audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"', robustness: 'SW_SECURE_CRYPTO' }],
  videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.64001F"', robustness: 'SW_SECURE_CRYPTO' }],
};

export const HLS_CONFIG: MediaKeySystemConfiguration = {
  initDataTypes: ['sinf', 'skd'],
  audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
  videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.640828"' }],
};

/** ClearKey không có robustness, dùng làm mốc so sánh trong demo. */
export const CLEARKEY_CONFIG: MediaKeySystemConfiguration = {
  initDataTypes: ['cenc', 'keyids'],
  videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.64001F"' }],
};

export interface ProbeResult {
  keySystem: KeySystem;
  supported: boolean;
  /** cấu hình trình duyệt chấp nhận (có thể khác cấu hình mình xin) */
  accepted?: MediaKeySystemConfiguration;
  error?: string;
  ms: number;
  cached: boolean;
}

type Requester = (keySystem: string, configs: MediaKeySystemConfiguration[]) => Promise<MediaKeySystemAccess>;

const defaultRequester: Requester | undefined =
  typeof navigator !== 'undefined' && typeof navigator.requestMediaKeySystemAccess === 'function'
    ? navigator.requestMediaKeySystemAccess.bind(navigator)
    : undefined;

/**
 * Dò một hệ DRM. Kết quả được nhớ theo (hệ + cấu hình) vì requestMediaKeySystemAccess
 * có thể mất vài chục ms và trên một số trình duyệt còn hiện hộp thoại xin quyền.
 */
export function createKeySystemProber(request: Requester | undefined = defaultRequester) {
  const cache = new Map<string, Promise<Omit<ProbeResult, 'ms' | 'cached'>>>();

  return async function probe(keySystem: KeySystem, config: MediaKeySystemConfiguration): Promise<ProbeResult> {
    const key = `${keySystem}|${JSON.stringify(config)}`;
    const started = performance.now();
    const cached = cache.has(key);
    if (!cached) {
      const job = (async () => {
        if (!request) return { keySystem, supported: false, error: 'EME không có trên trình duyệt này' };
        try {
          const access = await request(keySystem, [config]);
          return { keySystem, supported: true, accepted: access.getConfiguration() };
        } catch (error) {
          return { keySystem, supported: false, error: (error as Error).name || String(error) };
        }
      })();
      cache.set(key, job);
    }
    const result = await cache.get(key)!;
    return { ...result, ms: performance.now() - started, cached };
  };
}

export interface DrmChoice {
  keySystem: KeySystem | null;
  /** nguồn nên phát: FairPlay đi với HLS, Widevine/PlayReady đi với DASH */
  manifest: 'dash' | 'hls' | null;
  reason: string;
}

/**
 * Chọn hệ đầu tiên được hỗ trợ theo thứ tự ưu tiên. Udemy khi không dò được hệ nào vẫn
 * "thử nốt" Widevine; ở đây trả về null để UI báo lỗi rõ ràng thay vì đợi lỗi giải mã.
 */
export function chooseKeySystem(
  probes: ProbeResult[],
  order: KeySystem[] = [WIDEVINE, FAIRPLAY, PLAYREADY],
): DrmChoice {
  for (const keySystem of order) {
    if (probes.find((p) => p.keySystem === keySystem)?.supported) {
      return {
        keySystem,
        manifest: keySystem === FAIRPLAY ? 'hls' : 'dash',
        reason: `hệ đầu tiên được hỗ trợ theo thứ tự ${order.map(shortName).join(' → ')}`,
      };
    }
  }
  return { keySystem: null, manifest: null, reason: 'không có hệ DRM nào; nên báo lỗi hoặc phát bản không mã hoá nếu có' };
}

export function shortName(keySystem: string) {
  if (keySystem === WIDEVINE) return 'Widevine';
  if (keySystem === PLAYREADY) return 'PlayReady';
  if (keySystem === FAIRPLAY) return 'FairPlay';
  if (keySystem === CLEARKEY) return 'ClearKey';
  return keySystem;
}

/**
 * Cấu hình kiểu shaka-player. Chú ý key của `advanced` phải là TÊN HỆ THẬT
 * ('com.widevine.alpha'); viết `{ WIDEVINE: … }` sẽ tạo key là chữ "WIDEVINE" và bị bỏ qua.
 */
export function buildPlayerDrmConfig(keySystem: KeySystem, licenseUrl: string) {
  return {
    drm: {
      servers: { [keySystem]: licenseUrl },
      advanced:
        keySystem === WIDEVINE
          ? { [WIDEVINE]: { videoRobustness: 'SW_SECURE_CRYPTO', audioRobustness: 'SW_SECURE_CRYPTO' } }
          : {},
    },
  };
}

export function buildLicenseUrl(template: string, drmType: string, token: string, baseUrl = '') {
  return template
    .replace('{drm_type}', encodeURIComponent(drmType))
    .replace('{auth_token}', encodeURIComponent(token))
    .replace('{base_url}', baseUrl);
}

// ---- base64 không cần Buffer (Udemy dùng polyfill Buffer của Node trong trình duyệt) ----

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text.trim());
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export interface LicenseRequest {
  headers: Record<string, string>;
  body: Uint8Array | string;
}

/** Widevine: gửi nguyên message của CDM, nhận về bytes license. */
export function widevineRequest(message: Uint8Array): LicenseRequest {
  return { headers: { 'Content-Type': 'application/octet-stream' }, body: message };
}

/**
 * PlayReady: message của CDM là XML UTF-16LE bọc challenge base64 và danh sách HttpHeaders.
 * Lấy challenge ra gửi, và GIỮ các header CDM yêu cầu (Udemy parse header nhưng không gửi).
 */
export function playReadyRequest(message: Uint8Array): LicenseRequest {
  const xmlText = decodeXmlBytes(message);
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const headers: Record<string, string> = {};
  const headerRoot = doc.getElementsByTagName('HttpHeaders')[0];
  if (headerRoot) {
    for (const header of Array.from(headerRoot.getElementsByTagName('HttpHeader'))) {
      const name = header.getElementsByTagName('name')[0]?.textContent;
      const value = header.getElementsByTagName('value')[0]?.textContent;
      if (name && value != null) headers[name] = value;
    }
  }
  const challenge = doc.getElementsByTagName('Challenge')[0]?.textContent;
  if (!challenge) throw new Error('PlayReady message không có <Challenge>');
  return { headers: { 'Content-Type': 'text/xml; charset=utf-8', ...headers }, body: base64ToBytes(challenge) };
}

/** XML của PlayReady là UTF-16LE (byte thứ hai của ký tự ASCII là 0); phòng hờ cả UTF-8. */
function decodeXmlBytes(bytes: Uint8Array) {
  const looksUtf16 = bytes.length > 1 && bytes[1] === 0;
  return new TextDecoder(looksUtf16 ? 'utf-16le' : 'utf-8').decode(bytes);
}

/**
 * FairPlay: body dạng form `spc=<base64>&assetId=<contentId>`.
 * `encode` = true thì mã hoá theo chuẩn form (`+` → `%2B`); Udemy cố ý KHÔNG mã hoá
 * vì license server của họ đọc chuỗi thô ("BuyDRM doesn't support encoded parameters").
 */
export function fairPlayRequest(spc: Uint8Array, contentId: string, encode = false): LicenseRequest {
  const spcBase64 = bytesToBase64(spc);
  const body = encode
    ? new URLSearchParams({ spc: spcBase64, assetId: contentId }).toString()
    : `spc=${spcBase64}&assetId=${contentId}`;
  return { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body };
}

/** Response FairPlay là base64 dạng text, thường kèm xuống dòng ở cuối: trim rồi decode. */
export function fairPlayResponse(text: string): Uint8Array {
  return base64ToBytes(text.trim());
}

/**
 * Lấy content id từ init data `skd://<32 ký tự>` của FairPlay. Init data là chuỗi UTF-16,
 * nên phải đọc theo Uint16Array; đọc từng byte sẽ xen ký tự \0 giữa các chữ.
 */
export function fairPlayContentId(initData: Uint8Array): string {
  const even = initData.byteLength - (initData.byteLength % 2);
  const units = new Uint16Array(initData.buffer.slice(initData.byteOffset, initData.byteOffset + even));
  const text = String.fromCharCode(...units);
  const match = /skd:\/\/(\w{32})/i.exec(text);
  if (!match) throw new Error('init data không có skd://<content id>');
  return match[1];
}
