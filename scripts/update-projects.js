const fs = require('fs');

const GIST = `https://gist.githubusercontent.com/hunghg255/ee79b03819fd5f9a2a92cba8839d5942/raw/projects.json?t=${Date.now()}`;

const locale = {
  handbook: 'Handbook',
  github: 'Github',
  npm: 'Npm',
  star: 'Stars',
  last_commit: 'Last Commit',
  download: 'Download',
  version: 'Version',
  marketplace: 'Marketplace',
};

(async () => {
  try {
    const data = await fetch(GIST).then((res) => res.json());

    const formattedPosts = Object.keys(data)
      .map((key) => {
        const projects = data[key];

        return `
## ${key}

${
  '| ' +
  Object.keys(projects[0])
    .map((key) => {
      return `${key === 'handbook' ? key : locale[key]} |`;
    })
    .join(' ')
}
  ${Object.keys(projects[0])
    .map((key) => {
      return `---`;
    })
    .join(' | ')}
${projects
  .map((project) => {
    return `| ${project.handbook} | [#Github](${project.github}) | [${
      project.npm ? '#Npm' : '#Marketplace'
    }](${project.npm || project.marketplace}) | ![Star](${project.star}) | ![last_commit](${project.last_commit}) | ![download](${project.download}) | ![version](${project.version}) |`;
  })
  .join('\n')}`;
      })
      .join('\n');

    // fs.writeFileSync('./README.md', '# Tools\n' + formattedPosts, 'utf8');
    fs.writeFileSync(
      'posts/tools/tools.md',
      `---
title: 'Tools'
date: '${new Date().toISOString()}'
---

${formattedPosts}
`,
      'utf8',
    );

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
