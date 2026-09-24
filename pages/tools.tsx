import Head from 'next/head';
import { GetStaticProps } from 'next';
import Layout from '~components/Layout/Layout';
import { getToolsData } from '~lib/tools';
import utilStyles from '~styles/utils.module.css';
import { siteTitle } from 'src/constants/constant';

export default function ToolsPage({ dataTools }: any) {
  return (
    <Layout>
      <Head>
        <title>{`Tools · ${siteTitle}`}</title>
        <meta property='og:image' content={'https://blog.hunghg.me/og.png'}></meta>
        <meta property='twitter:image' content={'https://blog.hunghg.me/og.png'}></meta>
      </Head>
      <div className={utilStyles.page}>
        <header className={utilStyles.pageHeader}>
          <p className={utilStyles.eyebrow}>Open source</p>
          <h1 className={utilStyles.pageTitle}>Tools & Plugins</h1>
          <p className={utilStyles.pageSubtitle}>
            Các thư viện, plugin và công cụ mã nguồn mở mình đã xây dựng và đang duy trì.
          </p>
        </header>
        <div
          className={`prose ${utilStyles.tools}`}
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
