import Head from 'next/head';
import SiteHeader from '~components/SiteHeader/SiteHeader';
import Footer from '~components/Footer/Footer';
import { siteTitle } from 'src/constants/constant';
import styles from './layout.module.css';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.default}>
      <Head>
        <link rel='icon' href='/favicon.ico' />
        <meta name='description' content='Share all about web development' />
        <meta name='og:title' content={siteTitle} />
        <meta name='twitter:card' content='summary_large_image' />
      </Head>
      <SiteHeader />
      <main className={styles.main}>{children}</main>
      <Footer />
    </div>
  );
}
