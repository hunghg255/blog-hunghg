import Head from 'next/head';
import { GetStaticPaths, GetStaticProps } from 'next';
import Layout from '~components/Layout/Layout';
import Article, { NeighborPost } from '~components/Article/Article';
import { getAllBlogIds, getBlogData } from '~lib/blogs';
import { SERIES, getSeriesPosts, getStandalonePosts } from '~lib/series';
import { getNeighbors } from '~lib/neighbors';

export default function Post({
  postData,
  prev,
  next,
  category,
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
  category: { href: string; label: string };
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
        category={category}
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
  const seriesId = (postData as { series?: string }).series;
  const series = seriesId ? SERIES[seriesId] : undefined;
  // Bài thuộc series: trước/sau theo thứ tự trong series. Bài lẻ: theo ngày, bỏ qua bài series.
  // getNeighbors nhận danh sách "mới nhất trước", nên series được đảo ngược (số lớn trước).
  const list = series ? getSeriesPosts(series.id).reverse() : getStandalonePosts();
  const { prev, next } = getNeighbors(
    list.map((p) => ({ href: `/blogs/${p.id}`, title: p.title })),
    `/blogs/${id}`,
  );
  return {
    props: {
      postData,
      prev,
      next,
      category: series
        ? { href: `/series/${series.id}`, label: series.title }
        : { href: '/blogs', label: 'Blogs' },
    },
  };
};
