/**
 * Đồng bộ trạng thái đăng nhập giữa các tab (ý tưởng từ CrossTabAuthReplication của Elastic Cloud).
 *
 * - localStorage chỉ giữ THỜI ĐIỂM HẾT HẠN của token (và của quyền sudo), không giữ token.
 * - Tab khác ghi vào localStorage -> sự kiện `storage` bắn ở tab này.
 * - Chỉ phản ứng (thường là reload) khi TRẠNG THÁI đổi: khách <-> đã đăng nhập, có/không sudo.
 *   Token được làm mới (hạn mới, vẫn còn hiệu lực) thì không làm gì: reload lúc đó chỉ làm phiền.
 */

export const AUTH_KEYS = {
  expires: 'auth:expires',
  sudoExpires: 'auth:sudo-expires',
} as const;

export interface AuthSnapshot {
  /** epoch ms, null = chưa đăng nhập */
  expiresAt: number | null;
  sudoExpiresAt: number | null;
}

export interface AuthState {
  loggedIn: boolean;
  sudo: boolean;
}

const inFuture = (time: number | null, now: number) => time !== null && time > now;

export function toAuthState(snapshot: AuthSnapshot, now = Date.now()): AuthState {
  return {
    loggedIn: inFuture(snapshot.expiresAt, now),
    sudo: inFuture(snapshot.sudoExpiresAt, now),
  };
}

function readNumber(storage: Storage, key: string): number | null {
  try {
    const value = JSON.parse(storage.getItem(key) ?? 'null');
    return typeof value === 'number' ? value : null;
  } catch {
    return null; // giá trị hỏng coi như không có
  }
}

export function readAuth(storage: Storage = localStorage): AuthSnapshot {
  return {
    expiresAt: readNumber(storage, AUTH_KEYS.expires),
    sudoExpiresAt: readNumber(storage, AUTH_KEYS.sudoExpires),
  };
}

function writeKey(storage: Storage, key: string, value: number | null) {
  if (value === null) storage.removeItem(key);
  else storage.setItem(key, JSON.stringify(value));
}

const sameState = (a: AuthState, b: AuthState) => a.loggedIn === b.loggedIn && a.sudo === b.sudo;

export interface WatchAuthOptions {
  /** trạng thái đổi do tab KHÁC: thường gọi location.reload() */
  onStateChange: (next: AuthState, prev: AuthState) => void;
  storage?: Storage;
  now?: () => number;
}

export function watchAuthState({ onStateChange, storage = localStorage, now = Date.now }: WatchAuthOptions) {
  // Trạng thái mà TAB NÀY đang hiển thị. So sánh với nó, không so oldValue/newValue của sự kiện:
  // sự kiện có bắn nhầm vào chính tab vừa ghi (Elastic ghi nhận lỗi này trên Safari) thì
  // `known` đã được cập nhật trong write(), nên không có gì đổi và không reload.
  let known = toAuthState(readAuth(storage), now());

  function check() {
    const next = toAuthState(readAuth(storage), now());
    if (sameState(next, known)) return;
    const prev = known;
    known = next;
    onStateChange(next, prev);
  }

  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== storage) return;
    // key === null: localStorage.clear() ở tab khác
    if (event.key === null || event.key === AUTH_KEYS.expires || event.key === AUTH_KEYS.sudoExpires) {
      check();
    }
  };
  window.addEventListener('storage', onStorage);

  return {
    /** tab này đăng nhập / đăng xuất / làm mới token: ghi và cập nhật trạng thái đã biết */
    write(snapshot: AuthSnapshot) {
      writeKey(storage, AUTH_KEYS.expires, snapshot.expiresAt);
      writeKey(storage, AUTH_KEYS.sudoExpires, snapshot.sudoExpiresAt);
      known = toAuthState(snapshot, now());
    },
    getState: () => known,
    /** kiểm tra lại bằng tay, vd khi tab được hiện lại */
    check,
    stop: () => window.removeEventListener('storage', onStorage),
  };
}
