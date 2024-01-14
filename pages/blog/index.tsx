import Head from 'next/head';
import { GetStaticProps } from 'next';
import Layout, { siteTitle } from '~components/Layout/Layout';
import Navbar, { menuIcon } from '~components/Navbar/Navbar';
import { getSortedBlogsData } from '~lib/blogs';
import utilStyles from '~styles/utils.module.css';
import ActiveLink from '~components/ActiveLink/Activelink';
import { sidebarActions } from '~store/sidebar';
import { Icon } from '~components/Icon/Icon';

export default function Blog({
  allPostsData,
}: {
  allPostsData: {
    date: string;
    title: string;
    id: string;
  }[];
}) {
  return (
    <Layout>
      <Head>
        <title>{siteTitle}</title>
      </Head>
      <div className={utilStyles.blog}>
        <aside className={`${utilStyles.aside} ${utilStyles.show}`}>
          <Navbar
            title='Blog'
            isShowTitle
            leadingItem={{
              icon: menuIcon,
              onClick: () => {
                sidebarActions.setVisible(true);
              },
            }}
          />
          <div className={utilStyles.postsContainer}>
            <nav>
              {allPostsData.map(({ id, date, title }) => (
                <div key={id}>
                  <ActiveLink href={`/blog/${id}`}>
                    <div className={utilStyles.post}>
                      <div className={utilStyles.title}>{title}</div>
                      <span className={utilStyles.date}>
                        <Icon icon='icon-materialsymbolscalendarclockoutlinerounded' />
                        {date}</span>
                    </div>
                  </ActiveLink>
                </div>
              ))}
            </nav>
          </div>
        </aside>
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
