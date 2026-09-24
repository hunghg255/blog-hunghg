import Head from 'next/head';
import { GetStaticProps } from 'next';
import Layout from '~components/Layout/Layout';
import PostCard, { PostSummary } from '~components/PostCard/PostCard';
import { getSortedBlogsData } from '~lib/blogs';
import utilStyles from '~styles/utils.module.css';
import { siteTitle } from 'src/constants/constant';

export default function Blog({ allPostsData }: { allPostsData: PostSummary[] }) {
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
            <span className={utilStyles.count}>{allPostsData.length}</span>
          </h1>
          <p className={utilStyles.pageSubtitle}>
            Chia sẻ kinh nghiệm về frontend, JavaScript, React và thiết kế hệ thống trong môi trường
            production.
          </p>
        </header>
        <div className={utilStyles.grid}>
          {allPostsData.map((post) => (
            <PostCard key={post.id} post={post} href={`/blogs/${post.id}`} />
          ))}
        </div>
      </div>
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = async () => {
  const allPostsData = getSortedBlogsData();
  return {
    props: {
      allPostsData,
    },
  };
};
