import '~styles/globals.css';
import 'markdown-it-github-alerts/styles/github-colors-light.css';
import 'markdown-it-github-alerts/styles/github-colors-dark-media.css';
import 'markdown-it-github-alerts/styles/github-base.css';

import { AppProps } from 'next/app';
import dynamic from 'next/dynamic';
import Noise from '~components/Noise/Noise';

const CopyContent = dynamic(() => import('~components/CopyContent/CopyContent'), { ssr: false });

const MermaidContent = dynamic(() => import('~components/MermaidContent/MermaidContent'), {
  ssr: false,
});

function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Noise />

      <Component {...pageProps} />

      <CopyContent />
      <MermaidContent />
    </>
  );
}

export default App;
