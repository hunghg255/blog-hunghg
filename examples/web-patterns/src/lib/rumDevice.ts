/**
 * Thông tin thiết bị + mạng để chia nhóm số liệu RUM và chọn bản nhẹ cho máy yếu
 * (ý tưởng từ get-device-information.ts của Udemy).
 * Các API này chưa có trên mọi trình duyệt: luôn coi giá trị là "có thể không biết" (null).
 */

interface NetworkInformationLike {
  effectiveType?: string;
  saveData?: boolean;
  downlink?: number;
  rtt?: number;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

export interface NavigatorLike {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  connection?: NetworkInformationLike;
}

export interface DeviceInfo {
  /** số luồng CPU logic */
  cores: number | null;
  /** RAM xấp xỉ (GB); trình duyệt làm tròn và giới hạn giá trị để chống fingerprint */
  memoryGb: number | null;
  /** 'slow-2g' | '2g' | '3g' | '4g' theo đo đạc thực tế, không phải loại kết nối */
  effectiveType: string | null;
  saveData: boolean;
  lowEndDevice: boolean;
  lowEndExperience: boolean;
}

const SLOW_TYPES = new Set(['slow-2g', '2g', '3g']);

export function getDeviceInfo(nav: NavigatorLike = navigator as NavigatorLike): DeviceInfo {
  const cores = Number.isFinite(nav.hardwareConcurrency) ? nav.hardwareConcurrency! : null;
  const memoryGb = Number.isFinite(nav.deviceMemory) ? nav.deviceMemory! : null;
  const effectiveType = nav.connection?.effectiveType ?? null;
  const saveData = !!nav.connection?.saveData;
  // Ngưỡng của Udemy: ≤ 4 luồng CPU hoặc ≤ 4GB RAM là máy yếu.
  // Không biết (null) thì KHÔNG coi là yếu: Safari/Firefox không có deviceMemory.
  const lowEndDevice = (cores != null && cores <= 4) || (memoryGb != null && memoryGb <= 4);
  const lowEndExperience =
    (effectiveType != null && SLOW_TYPES.has(effectiveType)) || saveData || lowEndDevice;
  return { cores, memoryGb, effectiveType, saveData, lowEndDevice, lowEndExperience };
}

/** Mạng đổi (vào thang máy, bật tiết kiệm dữ liệu…) thì báo lại. Trả về hàm huỷ. */
export function watchDeviceInfo(
  callback: (info: DeviceInfo) => void,
  nav: NavigatorLike = navigator as NavigatorLike,
) {
  const onChange = () => callback(getDeviceInfo(nav));
  nav.connection?.addEventListener?.('change', onChange);
  return () => nav.connection?.removeEventListener?.('change', onChange);
}
