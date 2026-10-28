/**
 * Hình học Web Mercator cho bản đồ ô vuông (tile 256 px, EPSG:3857):
 * đổi lat/lng sang pixel, mét sang pixel theo vĩ độ, điểm đích theo hướng,
 * và vẽ "vòng tròn bán kính r mét" cho đúng (nó không tròn trên bản đồ).
 * Ý tưởng từ LeafletUtils (Facebook), viết lại từ đầu.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Pixel {
  x: number;
  y: number;
}

/** Bán kính Trái Đất dùng cho Web Mercator (bán trục lớn WGS84). */
export const EARTH_RADIUS = 6378137;
/** Vĩ độ lớn nhất để bản đồ thành hình vuông: atan(sinh(π)). */
export const MAX_LAT = 85.0511287798066;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const worldSize = (zoom: number) => 256 * 2 ** zoom;

export const clampLat = (lat: number) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));

/** y Mercator không thứ nguyên: ln(tan(π/4 + φ/2)) */
export const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (clampLat(lat) * D2R) / 2));
export const latFromMercY = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * R2D;

export function project({ lat, lng }: LatLng, zoom: number): Pixel {
  const size = worldSize(zoom);
  return { x: ((lng + 180) / 360) * size, y: (0.5 - mercY(lat) / (2 * Math.PI)) * size };
}

export function unproject({ x, y }: Pixel, zoom: number): LatLng {
  const size = worldSize(zoom);
  return { lat: latFromMercY((0.5 - y / size) * 2 * Math.PI), lng: (x / size) * 360 - 180 };
}

/** Đưa kinh độ về [-180, 180). */
export const wrapLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;

/** Mét trên một pixel tại vĩ độ lat: chu vi xích đạo × cos φ / số pixel của thế giới. */
export const metersPerPixel = (lat: number, zoom: number) => (2 * Math.PI * EARTH_RADIUS * Math.cos(lat * D2R)) / worldSize(zoom);

/** Khoảng cách vòng lớn (haversine), mét. */
export function distance(a: LatLng, b: LatLng) {
  const dLat = (b.lat - a.lat) * D2R;
  const dLng = (b.lng - a.lng) * D2R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Điểm đích: đi `meters` theo hướng `bearingDeg` (0 = bắc, 90 = đông) trên mặt cầu. */
export function destination(from: LatLng, meters: number, bearingDeg: number): LatLng {
  const d = meters / EARTH_RADIUS;
  const θ = bearingDeg * D2R;
  const φ1 = from.lat * D2R;
  const sinφ2 = Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ);
  const φ2 = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
  const λ = Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * sinφ2);
  // không wrap ở đây để đa giác liền mạch khi cắt kinh tuyến 180; người vẽ tự dời ±360
  return { lat: φ2 * R2D, lng: from.lng + λ * R2D };
}

/** Đa giác n đỉnh của vòng tròn trên mặt cầu (đường cong thật trên bản đồ). */
export function geodesicCircle(center: LatLng, meters: number, n = 128): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i < n; i++) out.push(destination(center, meters, (360 * i) / n));
  // kinh độ liên tục: mỗi đỉnh lệch đỉnh trước không quá 180°
  for (let i = 1; i < n; i++) {
    while (out[i].lng - out[i - 1].lng > 180) out[i].lng -= 360;
    while (out[i].lng - out[i - 1].lng < -180) out[i].lng += 360;
  }
  return out;
}

export interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** vòng tròn chứa cực: không còn là hình kín trên Mercator */
  coversPole: boolean;
}

/**
 * Ellipse xấp xỉ vòng tròn r mét, tính bằng pixel ở mức zoom.
 * - Theo trục y: lấy đúng hai mép bắc/nam (φ ± δ) rồi chiếu, tâm là trung điểm y.
 * - Theo trục x: độ rộng kinh độ lớn nhất của chỏm cầu, asin(sin δ / cos φ).
 */
export function circleEllipse(center: LatLng, meters: number, zoom: number): Ellipse {
  const δ = (meters / EARTH_RADIUS) * R2D;
  const north = center.lat + δ, south = center.lat - δ;
  const coversPole = north >= 90 || south <= -90;
  const yN = project({ lat: north, lng: center.lng }, zoom).y;
  const yS = project({ lat: south, lng: center.lng }, zoom).y;
  const s = Math.sin(δ * D2R) / Math.cos(center.lat * D2R);
  const dLng = coversPole || s >= 1 ? 180 : Math.asin(s) * R2D;
  const c = project(center, zoom);
  const px = worldSize(zoom) / 360;
  return { cx: c.x, cy: (yN + yS) / 2, rx: dLng * px, ry: Math.abs(yS - yN) / 2, coversPole };
}

/** Bán kính "tròn" ngây thơ: lấy tỉ lệ mét/pixel ở tâm rồi vẽ hình tròn. */
export function naiveCircle(center: LatLng, meters: number, zoom: number): Ellipse {
  const c = project(center, zoom);
  const r = meters / metersPerPixel(center.lat, zoom);
  return { cx: c.x, cy: c.y, rx: r, ry: r, coversPole: false };
}

/**
 * Cách của LeafletUtils.circleBounds + projectCircle (viết lại để so sánh):
 * tìm vĩ độ h ở trung điểm y Mercator, nhưng rồi dựng hộp bao h ± δ (thay vì φ ± δ)
 * và lấy nửa chiều cao của hộp đó làm bán kính y.
 */
export function boundsShiftEllipse(center: LatLng, meters: number, zoom: number): Ellipse & { midLat: number } {
  const δ = (meters / EARTH_RADIUS) * R2D;
  const midLat = latFromMercY((mercY(center.lat + δ) + mercY(center.lat - δ)) / 2);
  const φ1 = center.lat * D2R, φ2 = midLat * D2R;
  const dLng = Math.acos((Math.cos(δ * D2R) - Math.sin(φ1) * Math.sin(φ2)) / (Math.cos(φ1) * Math.cos(φ2))) * R2D;
  const sw = project({ lat: midLat - δ, lng: center.lng - dLng }, zoom);
  const ne = project({ lat: midLat + δ, lng: center.lng + dLng }, zoom);
  const c = project({ lat: midLat, lng: center.lng }, zoom);
  return { cx: c.x, cy: c.y, rx: Math.round((ne.x - sw.x) / 2), ry: Math.round((sw.y - ne.y) / 2), coversPole: Number.isNaN(dLng), midLat };
}

/** Mức zoom lớn nhất mà hộp [sw, ne] vẫn vừa khung w×h (duyệt tăng dần như getBoundsZoom). */
export function fitZoom(sw: LatLng, ne: LatLng, w: number, h: number, minZoom = 0, maxZoom = 20) {
  let z = minZoom;
  for (; z <= maxZoom; z++) {
    const a = project(sw, z), b = project(ne, z);
    let dx = b.x - a.x;
    if (dx < 0) dx += worldSize(z); // hộp cắt kinh tuyến 180
    if (dx > w || a.y - b.y > h) break;
  }
  return Math.max(minZoom, z - 1);
}
