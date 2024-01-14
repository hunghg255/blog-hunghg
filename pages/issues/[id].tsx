import Head from 'next/head';
import Layout from '~components/Layout/Layout';
import { getAllBlogIds, getBlogData, getSortedBlogsData } from '~lib/blogs';
import utilStyles from '~styles/utils.module.css';
import { GetStaticPaths, GetStaticProps } from 'next';
import Navbar, { backIcon } from '~components/Navbar/Navbar';
import ActiveLink from '~components/ActiveLink/Activelink';
import React, { useState, useEffect } from 'react';
import { getAllIssuesIds, getIssuesData, getSortedIssuesData } from '~lib/issues';
import { Icon } from '~components/Icon/Icon';

export default function IssuesDetailPage({
  allPostsData,
  postData,
}: {
  allPostsData: {
    folderName: string;
    data: {
      date: string;
      title: string;
      id: string;
    }[];
  }[];
  postData: {
    title: string;
    date: string;
    contentHtml: string;
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
      </Head>
      <div className={utilStyles.blog}>
        <aside className={utilStyles.aside}>
          <Navbar title='Blog' />
          <div className={utilStyles.postsContainer}>
            {allPostsData.map(({ folderName, data }) => (
              <div key={folderName} className={utilStyles.issuesItem}>
                <div className={utilStyles.folderName}>{folderName.split('-').join(' ')}</div>
                <nav>
                  {data.map(({ id, date, title }) => (
                    <div key={id}>
                      <ActiveLink href={`/issues/${folderName}--${id}`}>
                        <div className={utilStyles.post}>
                          <div className={utilStyles.title}>{title}</div>
                          <div className={utilStyles.date}>
                            <Icon icon='icon-materialsymbolscalendarclockoutlinerounded' />
                            {date}
                          </div>
                        </div>
                      </ActiveLink>
                    </div>
                  ))}
                </nav>
              </div>
            ))}
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
              <header className={utilStyles.postHeader}>
                <h1 className={utilStyles.postTitle}>{postData.title}</h1>
                <div className={utilStyles.meta}>
                  <time className={utilStyles.postSubheader}>
                    <Icon icon='icon-materialsymbolscalendarclockoutlinerounded' />

                    {postData.date}
                  </time>
                </div>
              </header>
              <div
                className={`${utilStyles.content} ${utilStyles.mono}`}
                dangerouslySetInnerHTML={{ __html: postData.contentHtml }}
              ></div>
            </div>
          </article>
        </div>
      </div>
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
  const allPostsData = await getSortedIssuesData();

  const id = typeof params.id === 'string' ? params.id : params.id[0] || '';
  const postData = await getIssuesData(id);
  return {
    props: {
      allPostsData,
      postData,
    },
  };
};
