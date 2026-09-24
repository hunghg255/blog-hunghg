import Link from 'next/link';
import classNames from 'classnames';
import DateTime from '~components/Date/Date';
import styles from './postCard.module.css';

export type PostSummary = {
  id: string;
  title: string;
  date?: string;
  description?: string;
  image?: string;
  tags?: string[];
};

export default function PostCard({
  post,
  href,
  variant = 'card',
  index,
}: {
  post: PostSummary;
  href: string;
  variant?: 'card' | 'row';
  index?: number;
}) {
  const tags = Array.isArray(post.tags) ? post.tags.slice(0, 3) : [];

  if (variant === 'row') {
    return (
      <Link href={href} className={styles.row}>
        {typeof index === 'number' && (
          <span className={styles.rowIndex}>{String(index + 1).padStart(2, '0')}</span>
        )}
        <span className={styles.rowTitle}>{post.title}</span>
        {post.date && (
          <span className={styles.rowDate}>
            <DateTime dateString={post.date} />
          </span>
        )}
        <span className={styles.rowArrow} aria-hidden>
          →
        </span>
      </Link>
    );
  }

  return (
    <Link href={href} className={classNames(styles.card, { [styles.hasImage]: !!post.image })}>
      {post.image && (
        <div className={styles.cover}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.image} alt='' loading='lazy' />
        </div>
      )}
      <div className={styles.body}>
        <div className={styles.meta}>
          <DateTime dateString={post.date} />
          {tags.length > 0 && <span className={styles.dot}>•</span>}
          {tags.map((tag) => (
            <span key={tag} className={styles.tag}>
              {tag}
            </span>
          ))}
        </div>
        <h3 className={styles.title}>{post.title}</h3>
        {post.description && <p className={styles.description}>{post.description}</p>}
        <span className={styles.readMore}>
          Đọc bài <span aria-hidden>→</span>
        </span>
      </div>
    </Link>
  );
}
