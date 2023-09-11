import Head from "next/head";
import { GetStaticProps } from "next";
import Layout, { siteTitle } from "../../components/layout";
import Navbar, { menuIcon } from "../../components/navbar";
import { getSortedBlogsData } from "../../lib/blogs";
import utilStyles from "../../styles/utils.module.css";
import ActiveLink from "../../components/activelink";
import SidebarContext from "../../context/SidebarContext";
import { useContext } from "react";

export default function Blog({
  allPostsData,
}: {
  allPostsData: {
    date: string;
    title: string;
    id: string;
  }[];
}) {
  const { setIsShow: setIsShowSidebar } = useContext(SidebarContext);
  return (
    <Layout>
      <Head>
        <title>{siteTitle}</title>
      </Head>
      <div className={utilStyles.blog}>
        <aside className={`${utilStyles.aside} ${utilStyles.show}`}>
          <Navbar
            title="Blog"
            isShowTitle
            leadingItem={{
              icon: menuIcon,
              onClick: () => {
                setIsShowSidebar(true);
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
  const allPostsData = getSortedBlogsData();
  return {
    props: {
      allPostsData,
    },
  };
};
