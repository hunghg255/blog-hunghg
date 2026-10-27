/**
 * Quyết định KHI NÀO được hiện khảo sát / tip / banner cho người dùng, theo cách của Floodgate
 * (SDK khảo sát in-app của Microsoft, nằm trong bundle outlook.live.com):
 *
 * 1. ActivityTracker: điều kiện "đã làm đủ N việc" gói trong một bitmask 32 bit.
 * 2. Governor: mỗi kênh hiển thị (khảo sát, banner, tip…) có thời gian nghỉ (cooldown) riêng.
 * 3. Nomination: chỉ chọn X% người dùng.
 * Thêm (không có trong Floodgate): giới hạn "tối đa K ngày trong W ngày gần nhất" bằng bitmask theo ngày.
 *
 * Mọi hàm nhận `now` để test và để demo tua thời gian.
 */

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function readJson<T>(storage: KeyValueStorage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback; // dữ liệu hỏng: coi như chưa có
  }
}

// ---------- 1. ActivityTracker: nhiều ngưỡng, một bitmask ----------

export interface TrackedActivity {
  name: string;
  /** cần xảy ra bao nhiêu lần, tối thiểu 1 */
  count: number;
}

export type IncrementResult = 'pending' | 'single-activated' | 'all-activated';

export function createActivityTracker(activities: TrackedActivity[], { ordered = false } = {}) {
  if (activities.length === 0 || activities.length > 31) {
    // 31 thay vì 32: bit 31 là bit dấu của số nguyên 32 bit trong JS, tránh cho dễ đọc
    throw new Error('cần từ 1 đến 31 activity');
  }
  const thresholds = activities.map((a) => Math.max(1, a.count));
  const allMask = 2 ** activities.length - 1; // vd 3 activity -> 0b111
  let counts = activities.map(() => 0);
  let flags = 0; // bit i = activity i đã đủ ngưỡng
  let currentIndex = 0; // với `ordered`: activity đang chờ

  function finish(index: number) {
    flags |= 1 << index;
    if (index + 1 < activities.length) currentIndex = index + 1;
  }

  return {
    increment(name: string, by = 1): IncrementResult {
      const index = activities.findIndex((a) => a.name === name);
      if (index < 0 || by <= 0) return 'pending';
      // `ordered`: phải làm theo thứ tự, việc phía sau chưa được tính
      if (ordered && index > currentIndex) return 'pending';
      const wasBelow = counts[index] < thresholds[index];
      counts[index] += by;
      // chỉ báo đúng lúc VƯỢT ngưỡng (theo cạnh), lần đếm sau đó không báo lại
      if (!(wasBelow && counts[index] >= thresholds[index])) return 'pending';
      finish(index);
      return (flags & allMask) === allMask ? 'all-activated' : 'single-activated';
    },
    isActivated: () => (flags & allMask) === allMask,
    getFlags: () => flags,
    getCounts: () => [...counts],
    reset() {
      counts = activities.map(() => 0);
      flags = 0;
      currentIndex = 0;
    },
  };
}

// ---------- 2. Governor: cooldown theo kênh ----------

export const DAY = 24 * 60 * 60 * 1000;

/** Giá trị mặc định của Floodgate: Standard 14 ngày, Urgent 0, Banner 15, TeachingMessage 15. */
export const DEFAULT_COOLDOWNS = {
  standard: 14 * DAY,
  urgent: 0,
  banner: 15 * DAY,
  teaching: 15 * DAY,
};

export function createGovernor<C extends string>(
  storage: KeyValueStorage,
  cooldowns: Record<C, number>,
  key = 'fc-governor',
) {
  // lưu thời điểm BẮT ĐẦU nghỉ (như Floodgate), thời điểm mở lại = start + cooldown hiện tại:
  // đổi cấu hình cooldown thì áp dụng ngay cho cả người dùng cũ
  const load = () => readJson<Partial<Record<C, number>>>(storage, key, {});
  return {
    isOpen(channel: C, now = Date.now()) {
      const start = load()[channel];
      return start === undefined || now >= start + cooldowns[channel];
    },
    opensAt(channel: C) {
      const start = load()[channel];
      return start === undefined ? null : start + cooldowns[channel];
    },
    startCooldown(channel: C, now = Date.now()) {
      storage.setItem(key, JSON.stringify({ ...load(), [channel]: now }));
    },
  };
}

// ---------- 3. Chọn X% người dùng ----------

/** FNV-1a 32 bit: băm chuỗi ra số nguyên không dấu, đủ đều cho việc chia nhóm. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Floodgate: `Math.floor(Math.random() * denominator) < numerator`, rồi lưu kết quả cho cả kỳ.
 * Ở đây băm userId + campaignId: cùng người luôn cùng kết quả, trên mọi thiết bị, không cần lưu.
 */
export function isNominated(
  userId: string,
  campaignId: string,
  numerator: number,
  denominator = 100,
) {
  return hash32(`${campaignId}:${userId}`) % denominator < numerator;
}

// ---------- 4. Giới hạn theo ngày bằng bitmask (mở rộng) ----------

/** Số thứ tự ngày theo giờ ĐỊA PHƯƠNG (qua nửa đêm của người dùng mới tính là ngày mới). */
export function localDay(now: number) {
  const offset = new Date(now).getTimezoneOffset() * 60_000;
  return Math.floor((now - offset) / DAY);
}

function popcount(n: number) {
  let count = 0;
  for (let x = n >>> 0; x; x &= x - 1) count++;
  return count;
}

interface DayMask {
  /** ngày ứng với bit 0 */
  day: number;
  /** bit i = 1: có hiển thị vào ngày (day - i) */
  mask: number;
}

/**
 * "Tối đa `maxDays` ngày có hiển thị trong `windowDays` ngày gần nhất", lưu trong MỘT số 32 bit.
 * Mỗi ngày một bit: `oncePerDay` (mặc định) thì mỗi ngày hiện tối đa một lần; tắt đi thì hiện
 * nhiều lần trong ngày vẫn chỉ tính là một ngày.
 */
export function createDailyCap(
  storage: KeyValueStorage,
  key: string,
  { maxDays = 3, windowDays = 7, oncePerDay = true } = {},
) {
  if (windowDays < 1 || windowDays > 32) throw new Error('windowDays phải từ 1 đến 32');
  const windowMask = 2 ** windowDays - 1; // 7 ngày -> 0b1111111

  /** dịch mask cho tới hôm nay: mỗi ngày trôi qua đẩy các bit sang trái một vị trí */
  function current(now: number): DayMask {
    const saved = readJson<DayMask>(storage, key, { day: localDay(now), mask: 0 });
    const today = localDay(now);
    const shift = today - saved.day;
    if (shift <= 0) return saved; // cùng ngày (hoặc đồng hồ bị lùi): giữ nguyên
    // `<<` trong JS chỉ lấy 5 bit thấp của số dịch (x << 32 === x), nên phải tự xử lý shift >= 32
    return { day: today, mask: shift >= 32 ? 0 : (saved.mask << shift) >>> 0 };
  }

  return {
    daysUsed: (now = Date.now()) => popcount(current(now).mask & windowMask),
    canShow(now = Date.now()) {
      const { mask } = current(now);
      if (oncePerDay && mask & 1) return false; // hôm nay đã hiện rồi
      return popcount(mask & windowMask) < maxDays;
    },
    record(now = Date.now()) {
      const state = current(now);
      storage.setItem(key, JSON.stringify({ day: state.day, mask: (state.mask | 1) >>> 0 }));
    },
    /** chuỗi bit để hiển thị: ký tự đầu là hôm nay */
    describe(now = Date.now()) {
      const { mask } = current(now);
      return Array.from({ length: windowDays }, (_, i) => ((mask >>> i) & 1 ? '■' : '□')).join('');
    },
  };
}
