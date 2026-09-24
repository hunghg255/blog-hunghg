import Head from 'next/head';
import Link from 'next/link';
import { GetStaticProps } from 'next';
import Layout from '~components/Layout/Layout';
import PostCard, { PostSummary } from '~components/PostCard/PostCard';
import { Icon } from '~components/Icon/Icon';
import { getSortedBlogsData } from '~lib/blogs';
import { getSortedIssuesData } from '~lib/issues';
import { getSortedJsData } from '~lib/javascript';
import utilStyles from '~styles/utils.module.css';
import styles from '~styles/home.module.css';
import { SOCIAL_LINKS, siteTitle } from 'src/constants/constant';

export default function Home({
  latestPosts,
  counts,
}: {
  latestPosts: PostSummary[];
  counts: { blogs: number; issues: number; javascript: number };
}) {
  const categories = [
    {
      href: '/blogs',
      title: 'Blogs',
      icon: 'icon-carbonblog' as const,
      desc: 'Bài viết chuyên sâu về frontend & system design.',
      count: counts.blogs,
    },
    {
      href: '/issues',
      title: 'Issues',
      icon: 'icon-streamlinecollaborationsidea' as const,
      desc: 'Custom hooks, design & rendering patterns, Git.',
      count: counts.issues,
    },
    {
      href: '/javascript',
      title: 'Javascript',
      icon: 'icon-mdicodejson' as const,
      desc: 'Câu hỏi JavaScript kèm giải thích chi tiết.',
      count: counts.javascript,
    },
    {
      href: '/tools',
      title: 'Tools',
      icon: 'icon-fluentwindowdevtools24regular' as const,
      desc: 'Plugin & thư viện mã nguồn mở.',
    },
  ];

  return (
    <Layout>
      <Head>
        <title>{siteTitle}</title>
        <meta property='og:image' content={'https://blog.hunghg.me/og.png'}></meta>
        <meta property='twitter:image' content={'https://blog.hunghg.me/og.png'}></meta>
      </Head>

      <div className={utilStyles.page}>
        <section className={styles.hero}>
          <div className={styles.heroText}>
            <p className={styles.badge}>
              <span className={styles.pulse} />
              Web Developer · Hanoi, Vietnam
            </p>
            <h1 className={styles.heroTitle}>
              Xin chào, mình là <span className={utilStyles.gradientText}>Hùng</span> 👋
            </h1>
            <p className={styles.heroSubtitle}>
              Mình viết về Web development, JavaScript, React và System design — những gì học được
              từ việc xây dựng sản phẩm thực tế.
            </p>
            <div className={styles.heroActions}>
              <Link href='/blogs' className={styles.primaryButton}>
                Đọc blog <span aria-hidden>→</span>
              </Link>
              <a
                href='https://github.com/hunghg255'
                target='_blank'
                rel='noopener noreferrer'
                className={styles.secondaryButton}
              >
                <Icon icon='icon-mynauibrandgithub' />
                Github
              </a>
            </div>
            <ul className={styles.socials}>
              {SOCIAL_LINKS.slice(1).map((link) => (
                <li key={link.href}>
                  <a href={link.href} target='_blank' rel='noopener noreferrer'>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div className={styles.heroVisual} aria-hidden>
            <div className={styles.terminal}>
              <div className={styles.terminalBar}>
                <span />
                <span />
                <span />
                <em>~/hunghg</em>
              </div>
              <pre>
                <code>
                  <b>const</b> hung = {'{'}
                  {'\n'}  role: <i>&apos;Web Developer&apos;</i>,
                  {'\n'}  location: <i>&apos;Hanoi 🇻🇳&apos;</i>,
                  {'\n'}  stack: [<i>&apos;React&apos;</i>, <i>&apos;Next.js&apos;</i>,{' '}
                  <i>&apos;Node&apos;</i>],
                  {'\n'}  learning: <u>true</u>,
                  {'\n'}
                  {'}'};
                </code>
              </pre>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.categories}>
            {categories.map((c) => (
              <Link key={c.href} href={c.href} className={styles.category}>
                <span className={styles.categoryIcon}>
                  <Icon icon={c.icon} />
                </span>
                <span className={styles.categoryTitle}>
                  {c.title}
                  {typeof c.count === 'number' && <small>{c.count}</small>}
                </span>
                <span className={styles.categoryDesc}>{c.desc}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <div className={utilStyles.sectionHeader}>
            <h2 className={utilStyles.sectionTitle}>Bài viết mới nhất</h2>
            <Link href='/blogs' className={utilStyles.sectionLink}>
              Xem tất cả →
            </Link>
          </div>
          <div className={utilStyles.grid}>
            {latestPosts.map((post) => (
              <PostCard key={post.id} post={post} href={`/blogs/${post.id}`} />
            ))}
          </div>
        </section>
      </div>
    </Layout>
  );
}

export const getStaticProps: GetStaticProps = async () => {
  const blogs = getSortedBlogsData();
  const issues = await getSortedIssuesData();
  return {
    props: {
      latestPosts: blogs.slice(0, 6),
      counts: {
        blogs: blogs.length,
        issues: issues.reduce((sum, group) => sum + group.data.length, 0),
        javascript: getSortedJsData().length,
      },
    },
  };
};
