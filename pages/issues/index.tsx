import Head from 'next/head';
import { GetStaticProps } from 'next';
import Layout from '~components/Layout/Layout';
import PostCard, { PostSummary } from '~components/PostCard/PostCard';
import { getSortedIssuesData } from '~lib/issues';
import utilStyles from '~styles/utils.module.css';
import { siteTitle } from 'src/constants/constant';

export default function IssuesPage({
  allPostsData,
}: {
  allPostsData: {
    folderName: string;
    data: PostSummary[];
  }[];
}) {
  const total = allPostsData.reduce((sum, group) => sum + group.data.length, 0);

  return (
    <Layout>
      <Head>
        <title>{`Issues · ${siteTitle}`}</title>
        <meta property='og:image' content={'https://blog.hunghg.me/og.png'}></meta>
        <meta property='twitter:image' content={'https://blog.hunghg.me/og.png'}></meta>
      </Head>
      <div className={`${utilStyles.page} ${utilStyles.pageNarrow}`}>
        <header className={utilStyles.pageHeader}>
          <p className={utilStyles.eyebrow}>Issues</p>
          <h1 className={utilStyles.pageTitle}>
            Ghi chép
            <span className={utilStyles.count}>{total}</span>
          </h1>
          <p className={utilStyles.pageSubtitle}>
            Custom hooks, design patterns, rendering patterns, Git và nhiều chủ đề khác — được sắp
            xếp theo từng nhóm.
          </p>
        </header>

        <nav className={utilStyles.chips} aria-label='Categories'>
          {allPostsData.map(({ folderName, data }) => (
            <a key={folderName} href={`#${folderName}`} className={utilStyles.chip}>
              {folderName.split('-').join(' ')}
              <span>{data.length}</span>
            </a>
          ))}
        </nav>

        {allPostsData.map(({ folderName, data }) => (
          <section key={folderName} id={folderName} className={utilStyles.group}>
            <h2 className={utilStyles.groupTitle}>{folderName.split('-').join(' ')}</h2>
            <div className={utilStyles.list}>
              {data.map((post, index) => (
                <PostCard
                  key={post.id}
                  post={post}
                  href={`/issues/${folderName}--${post.id}`}
                  variant='row'
                  index={index}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = async () => {
  const allPostsData = await getSortedIssuesData();
  return {
    props: {
      allPostsData,
    },
  };
};
