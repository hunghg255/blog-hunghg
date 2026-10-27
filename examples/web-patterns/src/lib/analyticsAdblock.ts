/**
 * Phát hiện trình chặn quảng cáo bằng phần tử mồi (ý tưởng từ bestbuy.ca: client/utils/detectAdBlocker/index.ts).
 *
 * Trình chặn quảng cáo có danh sách class CSS hay gặp ở quảng cáo (adBanner, ad-text, pub_300x250…) và ẩn mọi
 * phần tử mang các class đó. Tạo một phần tử mồi mang những class này rồi xem nó có bị ẩn không.
 * Best Buy dùng kết quả để không chừa chỗ trống cho ô quảng cáo sẽ không bao giờ hiện.
 */

export const BAIT_CLASSES =
  'pub_300x250 pub_300x250m pub_728x90 text-ad textAd text_ad text_ads text-ads text-ad-links ad-text adSense adBlock adContent adBanner';

/** Phần tử bị ẩn: display:none làm offsetParent = null và kích thước = 0. */
export function isHidden(el: HTMLElement) {
  return (
    el.offsetParent === null ||
    el.offsetHeight === 0 ||
    el.offsetWidth === 0 ||
    getComputedStyle(el).visibility === 'hidden'
  );
}

export async function detectAdBlocker({ waitMs = 100 }: { waitMs?: number } = {}): Promise<boolean> {
  const bait = document.createElement('div');
  bait.className = BAIT_CLASSES;
  bait.setAttribute('aria-hidden', 'true');
  bait.style.cssText = 'width:1px!important;height:1px!important;position:absolute!important;left:-10000px!important;top:-1000px!important;';
  document.body.appendChild(bait);
  try {
    // Có trình chặn chèn CSS hoặc ẩn phần tử hơi trễ (sau khi trang tải, qua MutationObserver):
    // đợi một chút thay vì kiểm tra ngay sau appendChild.
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return isHidden(bait) || !bait.isConnected; // có trình chặn xoá hẳn phần tử
  } finally {
    bait.remove(); // dọn mồi, gọi nhiều lần không để rác trong DOM
  }
}
