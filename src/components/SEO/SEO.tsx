import Head from 'next/head';
import { FC } from 'react';

interface Props {
  title?: string;
  description?: string;
  robots?: string;
  siteUrl?: string;
  openGraph?: {
    type?: string;
    locale?: string;
    site_name?: string;
    url?: string;
    images: {
      url: string;
    };
  };
  twitterGraph?: {
    images: {
      url: string;
    };
  };
  noMetaGoogleIndex?: boolean;
}

const SEO: FC<Props> = ({
  title,
  siteUrl,
  description,
  openGraph,
  twitterGraph,
  noMetaGoogleIndex = false,
}) => {
  return (
    <Head>
      <title>{title ? title : 'Web total'}</title>

      <meta name='title' content={title ? title : 'Web total'} />
      <meta name='description' content={description || 'Share all web development'} />
      <link rel='canonical' href={'/'} />
      <meta property='og:locale' content='en_US' />
      <meta name='robots' content={'index, follow'} />
      <meta name='googlebot' content={'index,follow'} />
      <meta charSet='utf-8' />

      <meta name='viewport' content={`width=device-width, initial-scale=1, maximum-scale=1`} />
      <meta name='theme-color' content='#476055' />

      <meta property='og:site_name' content='blog.hunghg.me' />
      <meta property='og:rich_attachment' content='true' />
      <meta property='og:type' content='website' />
      <meta property='og:url' itemProp='url' content='https://blog.hunghg.me' />
      <meta property='og:image' itemProp='thumbnailUrl' content={openGraph?.images?.url || ''} />
      {/* <meta property='og:image:width' content='600px' />
      <meta property='og:image:height' content='315px' /> */}

      <meta content={title ? title : 'Web total'} itemProp='headline' property='og:title' />
      <meta
        content={description || 'Share all web development'}
        itemProp='description'
        property='og:description'
      />

      <link rel='shortcut icon' href='/static/favicon.ico' />
      <meta name='copyright' content='Maby' />
      <meta name='author' content='MABY' />
      <meta name='generator' content='MABY' />
      <meta httpEquiv='audience' content='General' />
      <meta name='resource-type' content='Document' />
      <meta name='distribution' content='Global' />
      <meta name='geo.region' content='US-CA' />
      <meta name='geo.position' content='36.701463;-118.755997' />
      <meta name='ICBM' content='36.701463, -118.755997' />

      <meta name='twitter:card' content='summary' />
      <meta name='twitter:url' content='https://blog.hunghg.me' />
      <meta name='twitter:title' content={title ? title : 'Web total'} />
      <meta name='twitter:description' content={description || 'Share all web development'} />
      <meta name='twitter:image' content={twitterGraph?.images?.url || ''} />
      <meta name='twitter:site' content='@web_totals' />
      <meta name='twitter:creator' content='@web_totals' />

      {/* <link
        rel='apple-touch-icon-precomposed'
        href='https://blog.hunghg.me/pwa-icons/icon-72x72.png'
        sizes='72x72'
      />
      <link
        rel='apple-touch-icon-precomposed'
        href='https://blog.hunghg.me/pwa-icons/icon-144x144.png'
        sizes='144x144'
      />
      <link
        rel='apple-touch-icon-precomposed'
        href='https://blog.hunghg.me/pwa-icons/icon-57x57.png'
        sizes='57x57'
      />
      <link
        rel='apple-touch-icon-precomposed'
        href='https://blog.hunghg.me/pwa-icons/icon-144x144.png'
        sizes='114x114'
      />
      <link
        rel='apple-touch-icon-precomposed'
        href='https://blog.hunghg.me/pwa-icons/icon-144x144.png'
        sizes='1x1'
      /> */}
    </Head>
  );
};

export default SEO;
