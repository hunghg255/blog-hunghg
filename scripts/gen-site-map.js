const fs = require('fs');
const path = require('path');
const { cwd } = require('process');
const { promisify } = require('util');
const readdir = promisify(fs.readdir);
const writeFile = promisify(fs.writeFile);

const baseUrl = 'https://yourwebsite.com';
const postsDirectory = path.join(cwd(), 'posts', 'blogs');

async function generateSitemap() {
  let urls = '';

  const files = await readdir(postsDirectory);
  files.forEach((file) => {
    const postName = path.parse(file).name;
    urls += `<url><loc>${baseUrl}/blog/${postName}</loc></url>\n`;
  });

  const sitemap = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>`;

  await writeFile('sitemap.xml', sitemap);
}

generateSitemap().catch(console.error);
