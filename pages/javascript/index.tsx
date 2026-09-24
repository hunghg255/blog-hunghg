import Head from 'next/head';
import { GetStaticProps } from 'next';
import Layout from '~components/Layout/Layout';
import PostCard, { PostSummary } from '~components/PostCard/PostCard';
import { getSortedJsData } from '~lib/javascript';
import utilStyles from '~styles/utils.module.css';
import { siteTitle } from 'src/constants/constant';

export default function JavascriptPage({ allPostsData }: { allPostsData: PostSummary[] }) {
  return (
    <Layout>
      <Head>
        <title>{`Javascript · ${siteTitle}`}</title>
        <meta property='og:image' content={'https://blog.hunghg.me/og.png'}></meta>
        <meta property='twitter:image' content={'https://blog.hunghg.me/og.png'}></meta>
      </Head>
      <div className={`${utilStyles.page} ${utilStyles.pageNarrow}`}>
        <header className={utilStyles.pageHeader}>
          <p className={utilStyles.eyebrow}>Javascript</p>
          <h1 className={utilStyles.pageTitle}>
            Câu hỏi Javascript
            <span className={utilStyles.count}>{allPostsData.length}</span>
          </h1>
          <p className={utilStyles.pageSubtitle}>
            Tuyển tập câu hỏi JavaScript kèm giải thích chi tiết — ôn luyện kiến thức và chuẩn bị
            phỏng vấn.
          </p>
        </header>
        <div className={utilStyles.list}>
          {allPostsData.map((post, index) => (
            <PostCard
              key={post.id}
              post={post}
              href={`/javascript/${post.id}`}
              variant='row'
              index={index}
            />
          ))}
        </div>
      </div>
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = async () => {
  const allPostsData = getSortedJsData();
  return {
    props: {
      allPostsData,
    },
  };
};
