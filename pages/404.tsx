import Head from 'next/head';
import Link from 'next/link';
import Layout from '~components/Layout/Layout';
import styles from '~styles/home.module.css';

export default function Custom404() {
  return (
    <Layout>
      <Head>
        <title>404 - Page Not Found</title>
      </Head>
      <section className={styles.notFound}>
        <p className={styles.notFoundCode}>404</p>
        <h1>Không tìm thấy trang</h1>
        <p>Trang bạn tìm có thể đã bị xoá hoặc chưa từng tồn tại.</p>
        <Link href='/' className={styles.primaryButton}>
          ← Về trang chủ
        </Link>
      </section>
    </Layout>
  );
}
