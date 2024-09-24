import Head from 'next/head';
import utilStyles from '~styles/utils.module.css';
import Navbar, { menuIcon } from '~components/Navbar/Navbar';
import Layout from '~components/Layout/Layout';
import { sidebarActions } from '~store/sidebar';
import { getToolsData } from '~lib/tools';
import { GetStaticProps } from 'next';

export default function ToolsPage({ dataTools }: any) {
  return (
    <Layout home>
      <Head>
        <title>Tools</title>
        <meta property='og:image' content={'https://blog.hunghg.me/og.png'}></meta>
        <meta property='twitter:image' content={'https://blog.hunghg.me/og.png'}></meta>
      </Head>
      <div className={utilStyles.container}>
        <Navbar
          title='Tools'
          isShowTitle
          leadingItem={{
            icon: menuIcon,
            onClick: () => {
              sidebarActions.setVisible(true);
            },
          }}
        />
        <div
          style={{
            textAlign: 'center',
          }}
          className={utilStyles.tools}
          dangerouslySetInnerHTML={{ __html: dataTools.contentHtml }}
        ></div>
      </div>
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = async () => {
  const dataTools = await getToolsData();
  return {
    props: {
      dataTools,
    },
  };
};
