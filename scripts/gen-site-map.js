const fs = require('fs');
const path = require('path');
const { cwd } = require('process');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);

const baseUrl = 'https://web-totals.vercel.app';

async function generateSitemap() {
  const files = fs.readdirSync(path.join(cwd(), 'public/cache'));
  const dataA = [];

  // {
  //   "id": "center-css",
  //   "dir": "/Users/kengzone/Documents/project/web-totals-project/posts/blogs",
  //   "meta": {
  //     "title": "Centering in CSS",
  //     "authors": "hunghg",
  //     "tags": ["html", "css", "tips"],
  //     "image": "https://res.cloudinary.com/hunghg255/image/upload/v1683865180/css-center_m1zi5l.png",
  //     "date": "2023-05-12"
  //   },
  //   "readingTime": { "text": "1 min read", "minutes": 0.685, "time": 41100, "words": 137 },
  //   "ogImageUrl": "https://web-totals.vercel.app/og-centering-in-css.png"
  // }

  files.forEach((file) => {
    const data = fs.readFileSync(path.join(cwd(), 'public/cache', file), {
      encoding: 'utf-8',
    });
    const parserData = JSON.parse(data);
    const [folder, subFolder] = parserData.dir.split('/').slice(-2);

    let url = '';
    if (folder === 'issues') {
      url = `${baseUrl}/${folder}/${subFolder}--${parserData.id}`;
    } else {
      url = `${baseUrl}/${subFolder}/${parserData.id}`;
    }

    dataA.push({
      link: url,
      date: parserData.meta.date
        ? new Date(parserData.meta.date).toISOString()
        : new Date().toISOString(),
      title: parserData.meta.title,
      description: parserData.description,
      contentHtml: parserData.contentHtml,
      image: parserData.ogImageUrl,
    });
  });

  const sitemap = `
<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" version="2.0">
<channel>
  <title>Hung Hoang</title>
  <link>https://web-totals.vercel.app/</link>
  <description>Hung Hoang' Blog</description>
  <lastBuildDate>${new Date().toISOString()}</lastBuildDate>
  <docs>https://validator.w3.org/feed/docs/rss2.html</docs>
  <generator>https://github.com/jpmonette/feed</generator>
  <image>
    <title>Hung Hoang</title>
    <url>https://web-totals.vercel.app/avatar.jpeg</url>
    <link>https://web-totals.vercel.app/</link>
  </image>
  <copyright>Copyright 2023 © Hung Hoang</copyright>
  <atom:link href="https://web-totals.vercel.app/rss.xml" rel="self" type="application/rss+xml"/>

  ${dataA.map((it) => {
    return `
      <item>
    <title>
      <![CDATA[ ${it.title} ]]>
    </title>
    <link>${it.link}</link>
    <guid>${it.link}</guid>
    <pubDate>${it.date}</pubDate>
    <description>
      <![CDATA[ ${it.description} ]]>
    </description>
    <content:encoded>
      <![CDATA[ ${it.contentHtml} ]]>
    </content:encoded>
    <author>giahung197bg@gmail.com (Hung Hoang)</author>
    <enclosure url="${it.image}" type="image/png"/>
  </item>
      `;
  })}


</channel>
</rss>
`;

  await writeFile(path.join(cwd(), 'public/rss.xml'), sitemap);
}

generateSitemap().catch(console.error);
