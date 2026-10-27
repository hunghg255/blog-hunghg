import Head from 'next/head';
import Link from 'next/link';
import { GetStaticPaths, GetStaticProps } from 'next';
import Layout from '~components/Layout/Layout';
import PostCard, { PostSummary } from '~components/PostCard/PostCard';
import { SERIES, SeriesInfo, getSeriesPosts } from '~lib/series';
import utilStyles from '~styles/utils.module.css';
import { siteTitle } from 'src/constants/constant';

type SeriesPost = PostSummary & { seriesOrder: number };

export default function SeriesPage({ series, posts }: { series: SeriesInfo; posts: SeriesPost[] }) {
  return (
    <Layout>
      <Head>
        <title>{`${series.title} · ${siteTitle}`}</title>
        <meta name='description' content={series.description} />
        <meta property='og:image' content={series.image} />
        <meta property='twitter:image' content={series.image} />
      </Head>
      <div className={`${utilStyles.page} ${utilStyles.pageNarrow}`}>
        <header className={utilStyles.pageHeader}>
          <p className={utilStyles.eyebrow}>
            <Link href='/blogs'>Blog</Link> / Series
          </p>
          <h1 className={utilStyles.pageTitle}>
            {series.title}
            <span className={utilStyles.count}>{posts.length}</span>
          </h1>
          <p className={utilStyles.pageSubtitle}>{series.description}</p>
        </header>

        {series.parts.map((part) => {
          const items = posts.filter(
            (p) => p.seriesOrder >= part.from && p.seriesOrder <= part.to,
          );
          if (items.length === 0) return null;
          return (
            <section key={part.title} className={utilStyles.blockSection}>
              <div className={utilStyles.sectionHeader}>
                <h2 className={utilStyles.sectionTitle}>{part.title}</h2>
              </div>
              <div className={utilStyles.list}>
                {items.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    href={`/blogs/${post.id}`}
                    variant='row'
                    // số thứ tự trong series (bài mở đầu là 00)
                    index={post.seriesOrder - 1}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </Layout>
  );
}

export const getStaticPaths: GetStaticPaths = async () => ({
  paths: Object.keys(SERIES).map((id) => ({ params: { id } })),
  fallback: false,
});

export const getStaticProps: GetStaticProps = async ({ params }) => {
  const id = String(params?.id);
  return {
    props: {
      series: SERIES[id],
      posts: getSeriesPosts(id),
    },
  };
};
