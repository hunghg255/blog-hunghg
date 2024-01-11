import Head from 'next/head';
import styles from './layout.module.css';
import utilStyles from '~styles/utils.module.css';
import Sidebar, { SidebarSection } from '../Sidebar/Sidebar';
import ActiveLink from '../ActiveLink/Activelink';

export const siteTitle = 'Next BLog Markdown';

export default function Layout({ children, home }: { children: React.ReactNode; home?: boolean }) {
  return (
    <div className={styles.default}>
      <Head>
        <link rel='icon' href='/favicon.ico' />
        <meta name='description' content='Next BLog Markdown' />
        <meta name='og:title' content={siteTitle} />
        <meta name='twitter:card' content='summary_large_image' />
      </Head>
      <Sidebar>
        <SidebarSection title=''>
          <ActiveLink href='/'>Home</ActiveLink>
          <ActiveLink href='/blog'>Blog</ActiveLink>
          <ActiveLink href='/issues'>Issues</ActiveLink>
          <ActiveLink href='/javascript'>Javascript</ActiveLink>
        </SidebarSection>

        {/* <SidebarSection title="Projects">
          <ActiveLink href="/projects/beans">Beans</ActiveLink>
          <ActiveLink href="/projects/hidden">Hidden Bar</ActiveLink>
          <ActiveLink href="/projects/sudofm">Sudo.fm</ActiveLink>
        </SidebarSection> */}

        <SidebarSection title='Contacts'>
          <ActiveLink href='https://github.com/hunghg255' shouldShowNewTab>
            Github
          </ActiveLink>
        </SidebarSection>
      </Sidebar>
      <main className={home ? utilStyles.index : ''}>{children}</main>
    </div>
  );
}
