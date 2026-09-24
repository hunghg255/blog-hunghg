import Head from 'next/head';
import { GetStaticPaths, GetStaticProps } from 'next';
import Layout from '~components/Layout/Layout';
import Article, { NeighborPost } from '~components/Article/Article';
import { getAllIssuesIds, getIssuesData, getSortedIssuesData } from '~lib/issues';
import { getNeighbors } from '~lib/neighbors';

export default function IssuesDetailPage({
  postData,
  prev,
  next,
}: {
  postData: {
    title: string;
    description?: string;
    date: string;
    contentHtml: string;
    ogImageUrl: string;
    tags?: string[];
    time?: {
      text?: string;
    };
  };
  prev: NeighborPost;
  next: NeighborPost;
}) {
  return (
    <Layout>
      <Head>
        <title>{postData.title}</title>
        <meta
          property='og:image'
          content={postData?.ogImageUrl ?? 'https://blog.hunghg.me/og.png'}
        ></meta>
        <meta
          property='twitter:image'
          content={postData?.ogImageUrl ?? 'https://blog.hunghg.me/og.png'}
        ></meta>
      </Head>
      <Article
        title={postData.title}
        description={postData.description}
        date={postData.date}
        readingTime={postData.time?.text}
        tags={postData.tags}
        contentHtml={postData.contentHtml}
        category={{ href: '/issues', label: 'Issues' }}
        prev={prev}
        next={next}
      />
    </Layout>
  );
}

export const getStaticPaths: GetStaticPaths = async () => {
  const paths = getAllIssuesIds();
  return {
    paths,
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps = async ({ params }: any) => {
  const id = typeof params.id === 'string' ? params.id : params.id[0] || '';
  const postData = await getIssuesData(id);
  const groups = await getSortedIssuesData();
  const { prev, next } = getNeighbors(
    groups
      .flatMap(({ folderName, data }) =>
        data.map((p) => ({ href: `/issues/${folderName}--${p.id}`, title: p.title })),
      )
      .reverse(),
    `/issues/${id}`,
  );
  return {
    props: {
      postData,
      prev,
      next,
    },
  };
};
