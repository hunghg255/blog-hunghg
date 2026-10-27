/**
 * MÔ PHỎNG cách Udemy đọc badge (image-parser-utils.ts) để so sánh trong demo, không phải mã gốc:
 * giải mã cả chunk thành chuỗi, tìm chunk "bắt đầu bằng" openbadges, bỏ keyword + 5 ký tự,
 * JSON.parse rồi lấy `id`; SVG thì tìm theo tên có tiền tố "openbadges:assertion".
 */
import { readPngChunks } from '../lib/udOpenBadges';

export function readPngUdemyStyle(buffer: ArrayBuffer): string {
  const decoder = new TextDecoder();
  const chunk = readPngChunks(buffer)
    .filter((c) => c.type === 'iTXt')
    .map((c) => decoder.decode(c.data))
    .find((text) => text.startsWith('openbadges'));
  if (!chunk) throw new Error('No assertion found in PNG file');
  return JSON.parse(chunk.slice('openbadges'.length + 5)).id;
}

export function readSvgUdemyStyle(svgText: string): string | null {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const node = doc.getElementsByTagName('openbadges:assertion')[0];
  if (!node) throw new Error('Unable to parse baked badge');
  return node.getAttribute('verify');
}
