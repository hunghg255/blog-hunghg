import Layout from '~components/Layout/Layout';
import { getAllBlogIds, getBlogData, getSortedBlogsData } from '~lib/blogs';
import utilStyles from '~styles/utils.module.css';
import { GetStaticPaths, GetStaticProps } from 'next';
import Navbar, { backIcon } from '~components/Navbar/Navbar';
import ActiveLink from '~components/ActiveLink/Activelink';
import React, { useState, useEffect } from 'react';
import { Icon } from '~components/Icon/Icon';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import Image from 'next/image';

const Comment = dynamic(() => import('~components/Comment/Comment'), {
  ssr: false,
});

export default function Post({
  allPostsData,
  postData,
}: {
  allPostsData: {
    date: string;
    title: string;
    id: string;
  }[];
  postData: {
    title: string;
    date: string;
    contentHtml: string;
    image?: string;
    ogImageUrl?: string;
    author: string;
    time?: {
      text?: string;
    };
  };
}) {
  const [scrollPosition, setScrollPosition] = useState(0);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const handleScroll = () => {
    const position = window.scrollY;
    setScrollPosition(position);
  };

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

      <div className={utilStyles.blog}>
        <aside className={utilStyles.aside}>
          <Navbar title='Blog' />
          <div className={utilStyles.postsContainer}>
            <nav>
              {allPostsData.map(({ id, date, title }) => (
                <div key={id}>
                  <ActiveLink href={`/blogs/${id}`}>
                    <div className={utilStyles.post}>
                      <div className={utilStyles.title}>{title}</div>
                      <span className={utilStyles.date}>
                        <Icon icon='icon-materialsymbolscalendarclockoutlinerounded' />
                        {date}
                      </span>
                    </div>
                  </ActiveLink>
                </div>
              ))}
            </nav>
          </div>
        </aside>
        <div className={utilStyles.postContainer}>
          <Navbar
            title={postData.title}
            isShowTitle={scrollPosition >= 104}
            leadingItem={{
              icon: backIcon,
              onClick: () => {
                window.history.back();
              },
            }}
          />
          <article className={utilStyles.articlePost}>
            <div className={utilStyles.container}>
              {postData?.image && (
                <div className={utilStyles.banner}>
                  <Image
                    src={postData?.image}
                    alt={postData.title}
                    fill={true}
                    objectFit='contain'
                  />
                </div>
              )}

              <header className={utilStyles.postHeader}>
                <h1 className={utilStyles.postTitle}>{postData.title}</h1>

                <div className={utilStyles.postInfo}>
                  <div className={utilStyles.avatar}>
                    <a
                      href={`http://github.com/${postData.author}`}
                      target='_blank'
                      rel='noopener noreferrer'
                    >
                      <img src={`https://github.com/${postData.author}.png`} />
                    </a>
                  </div>

                  <div>
                    <p className={utilStyles.author}>
                      <a
                        href={`http://github.com/${postData.author}`}
                        target='_blank'
                        rel='noopener noreferrer'
                      >
                        {postData.author}
                      </a>
                    </p>
                    <div className={utilStyles.meta}>
                      <time className={utilStyles.postSubheader}>
                        <Icon icon='icon-materialsymbolscalendarclockoutlinerounded' />
                        {postData.date}
                      </time>
                      <span> | </span>
                      <time className={utilStyles.postSubheader}>
                        <Icon icon='icon-materialsymbolsalarmonoutlinerounded' />
                        {postData?.time?.text}
                      </time>
                    </div>
                  </div>
                </div>
              </header>

              <div
                className={`${utilStyles.content} ${utilStyles.mono}`}
                dangerouslySetInnerHTML={{ __html: postData.contentHtml }}
              ></div>

              <div className={utilStyles.line}></div>

              <Comment />
            </div>
          </article>
        </div>
      </div>
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
  const allPostsData = getSortedBlogsData();
  const id = typeof params.id === 'string' ? params.id : params.id[0] || '';
  const postData = await getBlogData(id);
  return {
    props: {
      allPostsData,
      postData,
    },
  };
};
