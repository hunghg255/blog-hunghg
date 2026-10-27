import Link from 'next/link';
import styles from './seriesCard.module.css';

export type SeriesCardData = {
  id: string;
  title: string;
  description: string;
  image: string;
  count: number;
  firstPostId: string;
  parts: { title: string; from: number; to: number }[];
};

/** Thẻ rộng đại diện cho cả một series trong danh sách bài viết. */
export default function SeriesCard({ series }: { series: SeriesCardData }) {
  return (
    <article className={styles.card}>
      <Link href={`/series/${series.id}`} className={styles.cover} tabIndex={-1} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={series.image} alt='' loading='lazy' />
      </Link>
      <div className={styles.body}>
        <p className={styles.eyebrow}>
          Series <span aria-hidden>·</span> {series.count} bài
        </p>
        <h3 className={styles.title}>
          <Link href={`/series/${series.id}`}>{series.title}</Link>
        </h3>
        <p className={styles.description}>{series.description}</p>
        <ul className={styles.parts}>
          {series.parts.map((part) => (
            <li key={part.title}>
              {part.title}
              {part.to > part.from && (
                <small>
                  #{part.from}–#{part.to}
                </small>
              )}
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          <Link href={`/series/${series.id}`} className={styles.primary}>
            Xem cả series <span aria-hidden>→</span>
          </Link>
          {series.firstPostId && (
            <Link href={`/blogs/${series.firstPostId}`} className={styles.secondary}>
              Đọc bài mở đầu
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
