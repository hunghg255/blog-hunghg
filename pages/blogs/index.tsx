import Head from 'next/head';
import { GetStaticProps } from 'next';
import Layout from '~components/Layout/Layout';
import PostCard, { PostSummary } from '~components/PostCard/PostCard';
import SeriesCard, { SeriesCardData } from '~components/SeriesCard/SeriesCard';
import { getAllSeriesSummaries, getStandalonePosts } from '~lib/series';
import utilStyles from '~styles/utils.module.css';
import { siteTitle } from 'src/constants/constant';

export default function Blog({
  allPostsData,
  series,
  total,
}: {
  allPostsData: PostSummary[];
  series: SeriesCardData[];
  total: number;
}) {
  return (
    <Layout>
      <Head>
        <title>{`Blogs · ${siteTitle}`}</title>
        <meta property='og:image' content={'https://blog.hunghg.me/og.png'}></meta>
        <meta property='twitter:image' content={'https://blog.hunghg.me/og.png'}></meta>
      </Head>
      <div className={utilStyles.page}>
        <header className={utilStyles.pageHeader}>
          <p className={utilStyles.eyebrow}>Blog</p>
          <h1 className={utilStyles.pageTitle}>
            Bài viết
            <span className={utilStyles.count}>{total}</span>
          </h1>
          <p className={utilStyles.pageSubtitle}>
            Chia sẻ kinh nghiệm về frontend, JavaScript, React và thiết kế hệ thống trong môi trường
            production.
          </p>
        </header>

        {series.length > 0 && (
          <section className={utilStyles.blockSection}>
            <div className={utilStyles.sectionHeader}>
              <h2 className={utilStyles.sectionTitle}>Series</h2>
            </div>
            <div className={utilStyles.grid}>
              {series.map((s) => (
                <SeriesCard key={s.id} series={s} />
              ))}
            </div>
          </section>
        )}

        <section className={utilStyles.blockSection}>
          {series.length > 0 && (
            <div className={utilStyles.sectionHeader}>
              <h2 className={utilStyles.sectionTitle}>Bài viết khác</h2>
            </div>
          )}
          <div className={utilStyles.grid}>
            {allPostsData.map((post) => (
              <PostCard key={post.id} post={post} href={`/blogs/${post.id}`} />
            ))}
          </div>
        </section>
      </div>
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = async () => {
  const allPostsData = getStandalonePosts();
  const series = getAllSeriesSummaries();
  return {
    props: {
      allPostsData,
      series,
      total: allPostsData.length + series.reduce((sum, s) => sum + s.count, 0),
    },
  };
};
