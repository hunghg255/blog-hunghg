import Head from 'next/head';
import { GetStaticPaths, GetStaticProps } from 'next';
import Layout from '~components/Layout/Layout';
import Article, { NeighborPost } from '~components/Article/Article';
import { getAllBlogIds, getBlogData, getSortedBlogsData } from '~lib/blogs';
import { getNeighbors } from '~lib/neighbors';

export default function Post({
  postData,
  prev,
  next,
}: {
  postData: {
    title: string;
    description?: string;
    date: string;
    contentHtml: string;
    image?: string;
    ogImageUrl?: string;
    author: string;
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
        {postData.description && <meta name='description' content={postData.description} />}
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
        author={postData.author}
        image={postData.image}
        tags={postData.tags}
        contentHtml={postData.contentHtml}
        category={{ href: '/blogs', label: 'Blogs' }}
        prev={prev}
        next={next}
      />
    </Layout>
  );
}

export const getStaticPaths: GetStaticPaths = async () => {
  const paths = getAllBlogIds();
  return {
    paths,
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps = async ({ params }: any) => {
  const id = typeof params.id === 'string' ? params.id : params.id[0] || '';
  const postData = await getBlogData(id);
  const { prev, next } = getNeighbors(
    getSortedBlogsData().map((p) => ({ href: `/blogs/${p.id}`, title: p.title })),
    `/blogs/${id}`,
  );
  return {
    props: {
      postData,
      prev,
      next,
    },
  };
};
