import Head from 'next/head';
import { GetStaticPaths, GetStaticProps } from 'next';
import Layout from '~components/Layout/Layout';
import Article, { NeighborPost } from '~components/Article/Article';
import { getAllJSIds, getJsData, getSortedJsData } from '~lib/javascript';
import { getNeighbors } from '~lib/neighbors';

export default function JavascriptDetailPage({
  postData,
  prev,
  next,
}: {
  postData: {
    title: string;
    date: string;
    contentHtml: string;
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
      </Head>
      <Article
        title={postData.title}
        date={postData.date}
        readingTime={postData.time?.text}
        contentHtml={postData.contentHtml}
        category={{ href: '/javascript', label: 'Javascript' }}
        prev={prev}
        next={next}
        showComments={false}
      />
    </Layout>
  );
}

export const getStaticPaths: GetStaticPaths = async () => {
  const paths = getAllJSIds();
  return {
    paths,
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps = async ({ params }: any) => {
  const id = typeof params.id === 'string' ? params.id : params.id[0] || '';
  const postData = await getJsData(id);
  const { prev, next } = getNeighbors(
    getSortedJsData().map((p) => ({ href: `/javascript/${p.id}`, title: p.title })),
    `/javascript/${id}`,
  );
  return {
    props: {
      postData,
      prev,
      next,
    },
  };
};
