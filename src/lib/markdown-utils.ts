//@ts-nocheck
import fs from 'fs';
import matter from 'gray-matter';
import path from 'path';

import MarkdownIt from 'markdown-it';
import MarkdownItAbbr from 'markdown-it-abbr';
import MarkdownItContainer from 'markdown-it-container';
import MarkdownItDeflist from 'markdown-it-deflist';
import MarkdownItEmoji from 'markdown-it-emoji';
import MarkdownItFootnote from 'markdown-it-footnote';
import MarkdownItGitHubAlerts from 'markdown-it-github-alerts';
import MarkdownItIns from 'markdown-it-ins';
import MarkdownItMark from 'markdown-it-mark';
import MarkdownItTable from 'markdown-it-multimd-table';
import markdownItShikiji from 'markdown-it-shikiji';
import {
  transformerNotationFocus,
  transformerNotationErrorLevel,
  transformerNotationHighlight,
  transformerNotationDiff,
  // ...
} from 'shikiji-transformers';
import { rendererRich, transformerTwoSlash } from 'shikiji-twoslash';
import mila from 'markdown-it-link-attributes';
import { svgCopy } from '~utils/svg';
import { stringToSlug } from '~utils/utils';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  xhtmlOut: true,
});

const getTitle = (info: string) => {
  const infoS = info.split(' ');
  const title = infoS.find((i) => i.startsWith('title='));
  return title ? title.split('=')[1] : '';
};

const getNpx2Yarn = (info: string) => {
  const infoS = info.split(' ');
  const title = infoS.find((i) => i.startsWith('npx2yarn='));
  return title ? title.split('=')[1] : '';
};

function renderCode(origRule, options) {
  return (...args) => {
    const [tokens, idx] = args;
    const content = tokens[idx].content.replaceAll('"', '&quot;').replaceAll("'", '&apos;');
    const info = tokens[idx].info ? md.utils.escapeHtml(tokens[idx].info) : '';

    const langName = info.split(/\s+/g)[0];
    const title = getTitle(info);

    const origRendered = origRule(...args);

    if (content.length === 0 || langName === 'mermaid') return origRendered;

    return `
<div class="code-blocks markdown-it-code-copy ${title ? 'code-blocks-title' : ''}">
  ${title ? `<h5>${title}</h5>` : ''}

	<div class="code-blocks-pre">
    ${origRendered}
    <span class="code-blocks-lang">${langName}</span>
    <button class="btn-copy">
      ${svgCopy}
    </button>
  </div>
</div>
`;
  };
}

function renderCodeMermaid(origRule, options) {
  return (...args) => {
    const [tokens, idx] = args;
    const content = tokens[idx].content.replaceAll('"', '&quot;').replaceAll("'", '&apos;');
    const info = tokens[idx].info ? md.utils.escapeHtml(tokens[idx].info) : '';

    const langName = info.split(/\s+/g)[0];

    const origRendered = origRule(...args);

    if (content.length === 0) return origRendered;

    if (langName !== 'mermaid') return origRendered;

    return `<div class="markdown-it-mermaid opacity-0">${origRendered}</div>`;
  };
}

const tags = ['h2', 'h3', 'h4', 'h5', 'h6'];

const MarkdownItGitHubAlerts1: MarkdownIt.PluginWithOptions<MarkdownItGitHubAlertsOptions> = (
  md,
) => {
  md.core.ruler.after('block', 'markdown-id-heading-anchor', (state) => {
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === 'heading_open') {
        const open = tokens[i];

        const startIndex = i;
        while (tokens[i]?.type !== 'heading_close' && i <= tokens.length) i += 1;
        // const close = tokens[i];
        const endIndex = i;
        const firstContent = tokens
          .slice(startIndex, endIndex + 1)
          .find((token) => token.type === 'inline');

        if (!firstContent) continue;

        const slug = stringToSlug(firstContent.content);

        // open.attrs = [['id', slug]];
        open.meta = {
          slug: slug,
        };
      }
    }
  });

  md.renderer.rules.heading_open = function (tokens, idx) {
    if (tags.includes(tokens[idx].tag)) {
      return `<${tokens[idx].tag} id="${tokens[idx].meta?.slug}"><a class="anchor" href="#${tokens[idx].meta?.slug}">#</a>`;
    }

    return '';
  };
};

md.use(MarkdownItGitHubAlerts1);
md.use(MarkdownItGitHubAlerts);
md.use(MarkdownItEmoji);
md.use(MarkdownItAbbr);
md.use(MarkdownItContainer, 'spoiler', {
  validate: function (params) {
    return params.trim().match(/^spoiler\s+(.*)$/);
  },

  render: function (tokens, idx) {
    const m = tokens[idx].info.trim().match(/^spoiler\s+(.*)$/);

    if (tokens[idx].nesting === 1) {
      // opening tag
      return '<details><summary>' + md.utils.escapeHtml(m[1]) + '</summary>\n';
    } else {
      // closing tag
      return '</details>\n';
    }
  },
});
md.use(MarkdownItDeflist);
md.use(MarkdownItFootnote);
md.use(MarkdownItIns);
md.use(MarkdownItMark);
md.use(MarkdownItTable, {
  multiline: false,
  rowspan: false,
  headerless: false,
  multibody: true,
  aotolabel: true,
});
md.use((md, options) => {
  md.renderer.rules.code_block = renderCode(md.renderer.rules.code_block, options);
  md.renderer.rules.fence = renderCode(md.renderer.rules.fence, options);
});
md.use((md, options) => {
  md.renderer.rules.code_block = renderCodeMermaid(md.renderer.rules.code_block, options);
  md.renderer.rules.fence = renderCodeMermaid(md.renderer.rules.fence, options);
});

md.use(mila, {
  attrs: {
    target: '_blank',
    rel: 'noopener',
  },
});

export function getSortedPostData(dir: string) {
  // Get file names under dir
  const fileNames = fs.readdirSync(dir);
  const allPostsData = fileNames.map((fileName) => {
    // Remove ".md" from file name to get id
    const id = fileName.replace(/\.md$/, '');

    // Read markdown file as string
    const fullPath = path.join(dir, fileName);
    const fileContents = fs.readFileSync(fullPath, 'utf8');

    // Use gray-matter to parse the post metadata section
    const matterResult = matter(fileContents);

    // Combine the data with the id
    return {
      id,
      ...(matterResult.data as { date: string; title: string }),
    };
  });
  // Sort posts by date
  return allPostsData.sort((a, b) => {
    if (a.date < b.date) {
      return 1;
    } else {
      return -1;
    }
  });
}

export function getAllPostIds(dir: string) {
  const fileNames = fs.readdirSync(dir);
  return fileNames.map((fileName) => {
    return {
      params: {
        id: fileName.replace(/\.md$/, ''),
      },
    };
  });
}

export async function getPostDataFromDirectory(id: string, dir: string) {
  const fullPath = path.join(dir, `${id}.md`);
  const fileContents = fs.readFileSync(fullPath, 'utf8');

  md.use(
    await markdownItShikiji({
      highlightLines: false,
      themes: {
        light: 'vitesse-dark',
        dark: 'vitesse-dark',
      },
      transformers: [
        transformerNotationDiff(),
        transformerNotationHighlight(),
        transformerNotationFocus(),
        transformerNotationErrorLevel(),
        transformerTwoSlash({
          renderer: rendererRich({
            classExtra: 'ingore-twoslash',
            processHoverDocs: (docs) => {
              const contentHtml = [md.render(docs)].join('\n').trim().replaceAll('\r\n', '\n');

              return contentHtml;
            },
          }),
          explicitTrigger: true,
        }),
      ],
    }),
  );

  const matterResult = matter(fileContents);

  const contentHtml = [md.render(matterResult.content)].join('\n').trim().replaceAll('\r\n', '\n');

  return {
    id,
    contentHtml,
    ...(matterResult.data as { data: string; title: string }),
  };
}
