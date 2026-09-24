import Link from 'next/link';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import DateTime from '~components/Date/Date';
import { Icon } from '~components/Icon/Icon';
import styles from './article.module.css';

const Comment = dynamic(() => import('~components/Comment/Comment'), {
  ssr: false,
});

export type NeighborPost = { href: string; title: string } | null;

type TocItem = { id: string; text: string; level: number };

export default function Article({
  title,
  description,
  date,
  readingTime,
  author,
  image,
  tags,
  contentHtml,
  category,
  prev,
  next,
  showComments = true,
}: {
  title: string;
  description?: string;
  date?: string;
  readingTime?: string;
  author?: string;
  image?: string;
  tags?: string[];
  contentHtml: string;
  category: { href: string; label: string };
  prev?: NeighborPost;
  next?: NeighborPost;
  showComments?: boolean;
}) {
  const { asPath } = useRouter();
  const contentRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState('');

  // Reading progress bar
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = progressRef.current;
      if (!el) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      el.style.transform = `scaleX(${max > 0 ? Math.min(window.scrollY / max, 1) : 0})`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [asPath]);

  // Table of contents built from the rendered headings
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const headings = Array.from(root.querySelectorAll<HTMLElement>('h2[id], h3[id]'));
    setToc(
      headings.map((h) => ({
        id: h.id,
        level: h.tagName === 'H2' ? 2 : 3,
        text: (h.textContent || '').replace(/^#\s*/, '').trim(),
      })),
    );
    setActiveId('');

    if (!headings.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length) setActiveId((visible[0].target as HTMLElement).id);
      },
      { rootMargin: '-80px 0px -70% 0px' },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [asPath, contentHtml]);

  const showToc = toc.length >= 2;
  const tagList = Array.isArray(tags) ? tags : [];

  const tocList = (
    <ul className={styles.tocList}>
      {toc.map((item) => (
        <li key={item.id} className={item.level === 3 ? styles.tocSub : undefined}>
          <a
            href={`#${item.id}`}
            className={classNames({ [styles.tocActive]: item.id === activeId })}
          >
            {item.text}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <div className={styles.progress} ref={progressRef} aria-hidden />

      <div className={classNames(styles.wrapper, { [styles.withToc]: showToc })}>
        <article className={styles.article}>
          <header className={styles.header}>
            <nav className={styles.breadcrumb} aria-label='Breadcrumb'>
              <Link href='/'>Home</Link>
              <span aria-hidden>/</span>
              <Link href={category.href}>{category.label}</Link>
            </nav>

            <h1 className={styles.title}>{title}</h1>
            {description && <p className={styles.description}>{description}</p>}

            <div className={styles.meta}>
              {author && (
                <a
                  href={`https://github.com/${author}`}
                  target='_blank'
                  rel='noopener noreferrer'
                  className={styles.author}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`https://github.com/${author}.png`} alt={author} />
                  <span>{author}</span>
                </a>
              )}
              {date && (
                <span className={styles.metaItem}>
                  <Icon icon='icon-materialsymbolscalendarclockoutlinerounded' />
                  <DateTime dateString={date} />
                </span>
              )}
              {readingTime && (
                <span className={styles.metaItem}>
                  <Icon icon='icon-materialsymbolsalarmonoutlinerounded' />
                  {readingTime}
                </span>
              )}
            </div>

            {tagList.length > 0 && (
              <div className={styles.tags}>
                {tagList.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>
            )}
          </header>

          {image && (
            <div className={styles.banner}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt={title} />
            </div>
          )}

          {showToc && (
            <details className={styles.tocMobile}>
              <summary>Mục lục</summary>
              {tocList}
            </details>
          )}

          <div
            ref={contentRef}
            className='prose'
            dangerouslySetInnerHTML={{ __html: contentHtml }}
          />

          {(prev || next) && (
            <nav className={styles.pager} aria-label='More posts'>
              {prev ? (
                <Link href={prev.href} className={styles.pagerItem}>
                  <span className={styles.pagerLabel}>← Bài trước</span>
                  <span className={styles.pagerTitle}>{prev.title}</span>
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link href={next.href} className={classNames(styles.pagerItem, styles.pagerNext)}>
                  <span className={styles.pagerLabel}>Bài tiếp →</span>
                  <span className={styles.pagerTitle}>{next.title}</span>
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}

          {showComments && (
            <section className={styles.comments}>
              <Comment />
            </section>
          )}
        </article>

        {showToc && (
          <aside className={styles.toc}>
            <div className={styles.tocInner}>
              <p className={styles.tocTitle}>Trên trang này</p>
              {tocList}
              <button
                type='button'
                className={styles.backToTop}
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              >
                ↑ Lên đầu trang
              </button>
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
