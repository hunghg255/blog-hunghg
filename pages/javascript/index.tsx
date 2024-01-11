import Head from 'next/head';
import { GetStaticProps } from 'next';
import Layout, { siteTitle } from '~components/Layout/Layout';
import Navbar, { menuIcon } from '~components/Navbar/Navbar';
import utilStyles from '~styles/utils.module.css';
import ActiveLink from '~components/ActiveLink/Activelink';
import { getSortedJsData } from '~lib/javascript';
import { sidebarActions } from '~store/sidebar';

export default function JavascriptPage({
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
            title='Javascript'
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
                  <ActiveLink href={`/javascript/${id}`}>
                    <div className={utilStyles.post}>
                      <div className={utilStyles.title}>{title}</div>
                      <span className={utilStyles.date}>{date}</span>
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
  const allPostsData = getSortedJsData();
  return {
    props: {
      allPostsData,
    },
  };
};
