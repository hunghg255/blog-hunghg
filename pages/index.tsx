import Head from 'next/head';
import utilStyles from '~styles/utils.module.css';
import Navbar, { menuIcon } from '~components/Navbar/Navbar';
import Layout from '~components/Layout/Layout';
import { sidebarActions } from '~store/sidebar';
import { siteTitle } from 'src/constants/constant';

export default function Home() {
  return (
    <Layout home>
      <Head>
        <title>{siteTitle}</title>
        <meta property='og:image' content={'https://blog.hunghg.me/og.png'}></meta>
        <meta property='twitter:image' content={'https://blog.hunghg.me/og.png'}></meta>
      </Head>
      <div className={utilStyles.container}>
        <Navbar
          title='Home'
          isShowTitle
          leadingItem={{
            icon: menuIcon,
            onClick: () => {
              sidebarActions.setVisible(true);
            },
          }}
        />
        <div
          className={`${utilStyles.mono} ${utilStyles.description}`}
          style={{
            textAlign: 'center',
          }}
        >
          <samp>👋 Hello there, I'm Hung, Frontend developer from Hanoi, Vietnam.</samp>
          <p>
            <samp>
              <span>learning</span> .<a href='https://hunghg.me'>me</a> .
              <a href='https://blog.hunghg.me/blogs'>blogs</a> .
              <a href='https://resume.hunghg.me'>resume</a> .
              <a href='https://blog.hunghg.me/tools'>projects</a> .
              <a href='https://npmstat.hunghg.me/'>npm-stat</a> .
              <a href='https://twitter.com/hunghg255'>X</a>
              <br />
              <a href='mailto:hi@hunghg.me'>mail</a> .
              <a href='https://gist.github.com/hunghg255'>gist</a> .
              <a href='https://github.com/hunghg255/use'>use</a> .
              <a href='https://wakatime.com/@hunghg255'>wakatime</a> .
              <a href='https://www.tiktok.com/@onlyfrontend'>tiktok</a>
            </samp>
          </p>
        </div>
      </div>
    </Layout>
  );
}
