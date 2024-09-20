import '~styles/globals.css';
import 'markdown-it-github-alerts/styles/github-colors-light.css';
import 'markdown-it-github-alerts/styles/github-colors-dark-media.css';
import 'markdown-it-github-alerts/styles/github-base.css';

import { AppProps } from 'next/app';
import dynamic from 'next/dynamic';
import Script from 'next/script';

const CopyContent = dynamic(() => import('~components/CopyContent/CopyContent'), { ssr: false });
const CodeGroup = dynamic(() => import('~components/CodeGroup/CodeGroup'), { ssr: false });

const MermaidContent = dynamic(() => import('~components/MermaidContent/MermaidContent'), {
  ssr: false,
});

function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <title>Web Totals</title>
      <meta name='robots' content='index, follow' />
      <meta name='googlebot' content={'index,follow'} />
      <meta charSet='utf-8' />
      <meta name='theme-color' content='#F25F4C' />
      <meta name='title' content='Web Totals' />
      <meta name='description' content='Web Totals' />
      <link rel='shortcut icon' href='/favicon.ico' />
      <meta
        name='viewport'
        content='width=device-width,initial-scale=1,maximum-scale=2,shrink-to-fit=no'
      />
      <meta property='og:image' content={'https://blog.hunghg.me/og.png'}></meta>
      <meta property='twitter:image' content={'https://blog.hunghg.me/og.png'}></meta>

      <Component {...pageProps} />

      <CopyContent />
      <CodeGroup />
      <MermaidContent />

      <Script src='https://cdn.jsdelivr.net/npm/medium-zoom@1.1.0/dist/medium-zoom.min.js' />
    </>
  );
}

export default App;
