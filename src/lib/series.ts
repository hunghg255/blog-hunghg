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
      'Đọc bundle JavaScript của facebook.com, rút ra 20 kỹ thuật frontend và viết lại bằng React + TypeScript, mỗi bài có demo chạy ngay trong bài.',
    image: 'https://blog.hunghg.me/blogs/fb-series.png',
    parts: [
      { title: 'Mở đầu', from: 0, to: 0 },
      { title: 'Phần 1: hạ tầng chạy ngầm', from: 1, to: 8 },
      { title: 'Phần 2: giao diện và SPA', from: 9, to: 20 },
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
