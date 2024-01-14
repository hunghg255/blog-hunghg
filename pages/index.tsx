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
              <span>learning</span> .<a href='https://hung.thedev.id'>me</a> .
              <a href='https://web-totals.vercel.app/blog'>blog</a> .
              <a href='https://hunghg-resume.vercel.app/'>resume</a> .
              <a href='https://toolsfe.vercel.app/tools/index.html'>projects</a> .
              <a href='https://twitter.com/hunghg255'>tweets</a> .
              <a href='https://hunghg-contact.vercel.app/'>contacts</a>
              <br />
              <a href='mailto:giahung197bg@gmail.com'>mail</a> .
              <a href='https://gist.github.com/hunghg255'>gist</a> .
              <a href='https://github.com/hunghg255/use'>use</a>
            </samp>
          </p>
        </div>
      </div>
    </Layout>
  );
}
