/**
 * Mô phỏng lại LatencyTracking.js của Zappos cho demo (không phải mã nguồn gốc): giữ nguyên logic đo,
 * chỉ thay việc gửi beacon bằng callback. Dùng để so sánh với src/lib/aboveFoldTiming.ts.
 */
export function zapposSoftNav(root: Element, onResult: (ms: number) => void) {
  const threshold = 1000;
  const offset = performance.now();
  const viewportImgs: HTMLImageElement[] = [];
  let loaded = 0;
  let timer = 0;

  const track = () => {
    const ms = performance.now() - offset - threshold; // trừ đúng thời gian chờ debounce
    onResult(ms);
  };
  const count = () => {
    if (++loaded >= viewportImgs.length) track();
  };
  const collect = () => {
    for (const img of Array.from(document.images)) {
      const r = img.getBoundingClientRect();
      if (r.bottom >= 0 && r.top <= innerHeight && r.right >= 0 && r.left < innerWidth && getComputedStyle(img).visibility !== 'hidden') {
        viewportImgs.push(img);
      }
    }
    // không có ảnh nào: forEach không chạy, track() không bao giờ được gọi
    viewportImgs.forEach((img) => {
      if (img.complete) count(); // <img> chưa có src cũng có complete = true
      else {
        img.addEventListener('load', count);
        img.addEventListener('error', count);
      }
    });
  };
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      observer.disconnect();
      collect();
    }, threshold);
  });
  // chỉ theo dõi childList: đổi src của ảnh có sẵn không được tính
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    clearTimeout(timer);
  };
}
