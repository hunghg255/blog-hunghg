import { getSortedBlogsData } from './blogs';

/**
 * Series bài viết: các bài có `series: <id>` + `seriesOrder: <số>` trong front matter
 * được gom lại thành một nhóm, sắp theo seriesOrder thay vì theo ngày.
 */

export type SeriesPart = { title: string; from: number; to: number };

export type SeriesInfo = {
  id: string;
  title: string;
  description: string;
  image: string;
  parts: SeriesPart[];
};

export const SERIES: Record<string, SeriesInfo> = {
  facebook: {
    id: 'facebook',
    title: 'Học từ mã nguồn Facebook',
    description:
      'Đọc bundle JavaScript của facebook.com, rút ra 82 kỹ thuật frontend và viết lại bằng React + TypeScript, mỗi bài có demo chạy ngay trong bài.',
    image: 'https://blog.hunghg.me/blogs/fb-series.png',
    parts: [
      { title: 'Mở đầu', from: 0, to: 0 },
      { title: 'Phần 1: hạ tầng chạy ngầm', from: 1, to: 8 },
      { title: 'Phần 2: giao diện và SPA', from: 9, to: 20 },
      { title: 'Phần 3: đi sâu vào bundle', from: 21, to: 37 },
      { title: 'Phần 4: Messenger và realtime', from: 38, to: 42 },
      { title: 'Phần 5: sản phẩm (composer, thanh toán, quảng cáo, Pages)', from: 43, to: 50 },
      { title: 'Phần 6: hạ tầng sâu', from: 51, to: 57 },
      { title: 'Phần 7: video và upload', from: 58, to: 62 },
      { title: 'Phần 8: thuật toán và cấu trúc dữ liệu', from: 63, to: 70 },
      { title: 'Phần 9: thời gian, chuỗi và URL', from: 71, to: 74 },
      { title: 'Phần 10: hạ tầng, bảo mật và hình học', from: 75, to: 82 },
    ],
  },
  ai: {
    id: 'ai',
    title: 'AI cho lập trình viên',
    description:
      'Làm việc với AI agent khi viết code (verification, trust ladder, để agent tự merge) và đưa model AI chạy thẳng trong trình duyệt.',
    image: 'https://blog.hunghg.me/blogs/ai-series.png',
    parts: [
      { title: 'Làm việc với AI agent', from: 1, to: 2 },
      { title: 'AI ngay trong trình duyệt', from: 3, to: 3 },
    ],
  },
  web: {
    id: 'web',
    title: 'Học từ mã nguồn các web lớn',
    description:
      'Đọc code production của Telegram, Apple, HubSpot, Trello, Zappos, Outlook… rút ra 64 kỹ thuật frontend dùng được ngay, mỗi bài có code viết lại và demo chạy trong bài.',
    image: 'https://blog.hunghg.me/blogs/web-series.png',
    parts: [
      { title: 'Mở đầu', from: 0, to: 0 },
      { title: 'Phần 1: trải nghiệm người dùng', from: 1, to: 7 },
      { title: 'Phần 2: hiệu năng và đo lường', from: 8, to: 13 },
      { title: 'Phần 3: nhiều tab, phiên đăng nhập, cập nhật', from: 14, to: 16 },
      { title: 'Phần 4: kiến trúc', from: 17, to: 20 },
      { title: 'Phần 5: soạn thảo và hiển thị nội dung', from: 21, to: 26 },
      { title: 'Phần 6: tương tác', from: 27, to: 33 },
      { title: 'Phần 7: mạng, dữ liệu và async', from: 34, to: 39 },
      { title: 'Phần 8: hiệu năng và vận hành', from: 40, to: 41 },
      { title: 'Phần 9: thuật toán và dữ liệu phía client', from: 42, to: 48 },
      { title: 'Phần 10: thời gian, ngôn ngữ, định dạng', from: 49, to: 51 },
      { title: 'Phần 11: tương tác và giao diện', from: 52, to: 57 },
      { title: 'Phần 12: media', from: 58, to: 59 },
      { title: 'Phần 13: đo lường, bảo mật, vận hành', from: 60, to: 64 },
    ],
  },
  telegram: {
    id: 'telegram',
    title: 'Học từ mã nguồn Telegram',
    description:
      'Đi sâu vào Telegram Web A: gửi tin lạc quan, lịch sử tin nhắn, store tự viết, animation FLIP, bố cục album, thumbnail 100 byte… mỗi bài có code viết lại và demo chạy trong bài.',
    image: 'https://blog.hunghg.me/blogs/tg-series.png',
    parts: [
      { title: 'Mở đầu', from: 0, to: 0 },
      { title: 'Phần 1: dữ liệu và đồng bộ', from: 1, to: 5 },
      { title: 'Phần 2: animation và giao diện', from: 6, to: 10 },
      { title: 'Phần 3: media, mobile, thông báo', from: 11, to: 14 },
      { title: 'Phần 4: soạn tin, media, chi tiết UI', from: 15, to: 24 },
    ],
  },
  udemy: {
    id: 'udemy',
    title: 'Học từ mã nguồn Udemy',
    description:
      'Đi sâu frontend của Udemy: DRM đa hệ, video và tiến độ học, bài thi có giờ, preview code, ProseMirror, file .ics, pipeline tracking… mỗi bài có code viết lại và demo chạy trong bài.',
    image: 'https://blog.hunghg.me/blogs/ud-series.png',
    parts: [
      { title: 'Mở đầu', from: 0, to: 0 },
      { title: 'Phần 1: video và học bài', from: 1, to: 6 },
      { title: 'Phần 2: bài tập, bài thi, lab', from: 7, to: 10 },
      { title: 'Phần 3: editor và nội dung', from: 11, to: 14 },
      { title: 'Phần 4: hạ tầng và trải nghiệm', from: 15, to: 20 },
    ],
  },
  whatsapp: {
    id: 'whatsapp',
    title: 'Học từ mã nguồn WhatsApp Web',
    description:
      'Đọc bundle WhatsApp Web 2020: giải mã JPEG progressive có HMAC, kho media tự co theo quota, render tin nhắn theo cửa sổ, emoji trie, chống homograph… mỗi bài có code viết lại và demo chạy trong bài.',
    image: 'https://blog.hunghg.me/blogs/wa-series.png',
    parts: [
      { title: 'Mở đầu', from: 0, to: 0 },
      { title: 'Phần 1: media và mã hoá', from: 1, to: 4 },
      { title: 'Phần 2: lưu trữ trên trình duyệt', from: 5, to: 7 },
      { title: 'Phần 3: danh sách tin nhắn', from: 8, to: 10 },
      { title: 'Phần 4: soạn tin và chữ', from: 11, to: 14 },
      { title: 'Phần 5: realtime và tiện ích', from: 15, to: 18 },
    ],
  },
};

export type BlogPost = ReturnType<typeof getSortedBlogsData>[number] & {
  series?: string;
  seriesOrder?: number;
  description?: string;
  image?: string;
  tags?: string[];
};

export type SeriesSummary = SeriesInfo & {
  count: number;
  /** ngày của bài mới nhất trong series, để xếp chung với bài lẻ */
  date: string;
  firstPostId: string;
};

export function getSeriesPosts(id: string): BlogPost[] {
  return (getSortedBlogsData() as BlogPost[])
    .filter((post) => post.series === id)
    .sort((a, b) => (a.seriesOrder ?? 0) - (b.seriesOrder ?? 0));
}

export function getSeriesSummary(id: string): SeriesSummary {
  const posts = getSeriesPosts(id);
  const latest = posts.reduce((max, p) => (p.date > max ? p.date : max), '');
  return { ...SERIES[id], count: posts.length, date: latest, firstPostId: posts[0]?.id ?? '' };
}

/** Bài không thuộc series nào (bài lẻ), mới nhất trước. */
export function getStandalonePosts(): BlogPost[] {
  return (getSortedBlogsData() as BlogPost[]).filter((post) => !post.series);
}

export function getAllSeriesSummaries(): SeriesSummary[] {
  return Object.keys(SERIES)
    .map(getSeriesSummary)
    .filter((s) => s.count > 0);
}
