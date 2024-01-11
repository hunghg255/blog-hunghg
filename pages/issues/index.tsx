import Head from 'next/head';
import { GetStaticProps } from 'next';
import Layout, { siteTitle } from '~components/Layout/Layout';
import Navbar, { menuIcon } from '~components/Navbar/Navbar';
import { getSortedBlogsData } from '~lib/blogs';
import utilStyles from '~styles/utils.module.css';
import ActiveLink from '~components/ActiveLink/Activelink';
import { sidebarActions } from '~store/sidebar';
import { getSortedIssuesData } from '~lib/issues';

export default function IssuesPage({
  allPostsData,
}: {
  allPostsData: {
    folderName: string;
    data: {
      date: string;
      title: string;
      id: string;
    }[];
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
            title='Issues'
            isShowTitle
            leadingItem={{
              icon: menuIcon,
              onClick: () => {
                sidebarActions.setVisible(true);
              },
            }}
          />
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
                        </div>
                      </ActiveLink>
                    </div>
                  ))}
                </nav>
              </div>
            ))}
          </div>
        </aside>
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
