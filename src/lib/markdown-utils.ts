//@ts-nocheck
import fs from 'fs';
import matter from 'gray-matter';
import path from 'path';
import sharp from 'sharp';

import MarkdownIt from 'markdown-it';
import MarkdownItAbbr from 'markdown-it-abbr';
import MarkdownItContainer from 'markdown-it-container';
import MarkdownItDeflist from 'markdown-it-deflist';
import MarkdownItEmoji from 'markdown-it-emoji';
import MarkdownItFootnote from 'markdown-it-footnote';
import MarkdownItGitHubAlerts from 'markdown-it-github-alerts';
import MarkdownItCodeGroup from 'markdown-it-code-group';
import MarkdownItIns from 'markdown-it-ins';
import MarkdownItMark from 'markdown-it-mark';
import MarkdownItTable from 'markdown-it-multimd-table';
import markdownItShikiji from '@shikijs/markdown-it';
import {
  transformerNotationFocus,
  transformerNotationErrorLevel,
  transformerNotationHighlight,
  transformerNotationDiff,
  transformerRenderWhitespace,
  transformerNotationWordHighlight,
  // ...
} from '@shikijs/transformers';
import theme from './theme.json';
import { rendererRich, transformerTwoslash } from '@shikijs/twoslash';
import mila from 'markdown-it-link-attributes';
import { svgCopy } from '~utils/svg';
import { stringToSlug } from '~utils/utils';
import { fromHtml } from 'hast-util-from-html';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { defaultHandlers, toHast } from 'mdast-util-to-hast';
import MarkdownItMagicLink from 'markdown-it-magic-link';
import readingTime from 'reading-time';
import { cwd } from 'process';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  xhtmlOut: true,
});

const ogSVGPromise = `
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#clip0_23_2)">
<path d="M1200 0H0V630H1200V0Z" fill="white"/>
<path d="M1200 611.686H0V629.686H1200V611.686Z" fill="#F25F4C"/>

<text fill="#35495E" xml:space="preserve" style="white-space: pre" font-family="Fira Code" font-size="78" letter-spacing="0em"><tspan x="86.8047" y="285.066">web-totals</tspan></text>
<text fill="#35495E" fill-opacity="0.7" xml:space="preserve" style="white-space: pre" font-family="Inter, Helvetica, sans-serif" font-size="30" letter-spacing="0em"><tspan x="92" y="360.409">{{line1}}&#10;</tspan><tspan x="92" y="415.409">{{line2}}&#10;</tspan><tspan x="92" y="470.409">{{line3}}</tspan></text>


<g clip-path="url(#clip1_23_2)">
<mask id="mask0_23_2" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="835" y="10" width="315" height="315">
<path d="M1150 10H835V325H1150V10Z" fill="white"/>
</mask>
<g mask="url(#mask0_23_2)">
<path d="M842.253 167.5C842.253 84.4808 909.481 17.2532 992.5 17.2532C1075.41 17.2532 1142.75 84.4808 1142.75 167.5C1142.75 250.405 1075.52 317.747 992.5 317.747C909.595 317.747 842.253 250.405 842.253 167.5Z" stroke="#F25F4C" stroke-width="14"/>
<path d="M974.398 88.75V204.274C974.389 209.053 973.436 213.783 971.597 218.193C969.758 222.604 967.067 226.608 963.679 229.978C960.289 233.347 956.27 236.016 951.849 237.83C947.428 239.644 942.693 240.569 937.914 240.551C917.719 240.551 901.316 224.241 901.316 204.274C901.316 184.307 917.719 167.904 937.914 167.904H969.227L1011.69 167.997H1047.19C1067.37 167.997 1083.68 150.797 1083.68 130.726C1083.68 125.946 1082.72 121.216 1080.88 116.805C1079.04 112.393 1076.35 108.388 1072.96 105.019C1069.57 101.649 1065.55 98.981 1061.13 97.1673C1056.71 95.3536 1051.97 94.4299 1047.19 94.449C1027.01 94.449 1010.7 110.759 1010.7 130.726V247.286" stroke="#F25F4C" stroke-width="12"/>
</g>
</g>
</g>
<defs>
<clipPath id="clip0_23_2">
<rect width="1200" height="630" fill="white"/>
</clipPath>
<clipPath id="clip1_23_2">
<rect width="315" height="315" fill="white" transform="translate(835 10)"/>
</clipPath>
</defs>
</svg>

`;

function renderMarkdown(this: any, md: string): any[] {
  const mdast = fromMarkdown(
    md.replaceAll(/{@link ([^}]*)}/g, '$1'), // replace jsdoc links
    { mdastExtensions: [gfmFromMarkdown()] },
  );

  return (
    toHast(mdast, {
      handlers: {
        code: (state, node) => {
          const lang = node.lang || '';
          if (lang) {
            return this.codeToHast(node.value, {
              ...this.options,
              transformers: [],
              lang,
            }).children[0] as Element;
          }
          return defaultHandlers.code(state, node);
        },
      },
    }) as Element
  ).children;
}

function renderMarkdownInline(this: any, md: string, context?: string): any[] {
  if (context === 'tag:param') {
    md = md.replace(/^([\w$-]+)/, '`$1` ');
  }

  const children = renderMarkdown.call(this, md);
  if (children.length === 1 && children[0].type === 'element' && children[0].tagName === 'p') {
    return children[0].children;
  }
  return children;
}

const getTitle = (info: string) => {
  const infoS = info.split(' ');
  const title = infoS.find((i) => i.startsWith('title='));
  return title ? title.split('=')[1] : '';
};

const getBash = (info: string) => {
  if (!info.includes('bash') && !info.includes('sh')) return '';

  if (info.includes('pnpm')) return 'pnpm';
  if (info.includes('npm')) return 'npm';
  if (info.includes('yarn')) return 'yarn';
  if (info.includes('bun')) return 'bun';
};

function renderCode(origRule, options) {
  return (...args) => {
    const [tokens, idx] = args;

    const content = tokens[idx].content.replaceAll('"', '&quot;').replaceAll("'", '&apos;');
    const info = tokens[idx].info ? md.utils.escapeHtml(tokens[idx].info) : '';

    const langName = info.split(/\s+/g)[0];
    const title = getTitle(info);
    const bash = getBash(info);

    const origRendered = origRule(...args);

    if (content.length === 0 || langName === 'mermaid') return origRendered;

    return `
<div class="code-blocks markdown-it-code-copy ${title ? 'code-blocks-title' : ''} ${bash || langName ? `code-blocks-group ${bash || langName} ${bash === 'npm' ? 'active' : ''}` : ''}">
  ${title ? `<h5><span class="circle1"></span><span class="circle2"></span><span class="circle3"></span>${title}</h5>` : ''}

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
      return `<${tokens[idx].tag} class="heading-anchor" id="${tokens[idx].meta?.slug}"><a class="anchor" href="#${tokens[idx].meta?.slug}">#</a>`;
    }

    return '';
  };
};

md.use(MarkdownItGitHubAlerts1);
md.use(MarkdownItGitHubAlerts);
md.use(MarkdownItCodeGroup);
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
md.use(MarkdownItMagicLink);
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

const isBracket = (str) => {
  if (!str) return false;

  return (
    str.includes('(') ||
    str.includes(')') ||
    str.includes('[') ||
    str.includes(']') ||
    str.includes('{') ||
    str.includes('}')
  );
};

const transformerBracketPairColor = (options): ShikiTransformer => {
  const colors = options?.color || {
    '(': '#ffd700',
    ')': '#ffd700',
    '[': '#da70d6',
    ']': '#da70d6',
    '{': '#179fff',
    '}': '#179fff',
  };

  return {
    name: 'shiki-brackets-color',
    root: (root) => {
      const pre = root.children[0] as Element;
      const code = pre.children[0] as Element;

      code.children = code.children.reduce((acc, item) => {
        if (item.type === 'element' && item.children?.length > 0) {
          const newChild = [];
          item.children.forEach((child) => {
            if (child.children?.length) {
              child.children.forEach((child1) => {
                if (isBracket(child1.value)) {
                  const a = child1.value.split('');
                  const b = a.map((it) => {
                    const d = {
                      ...child,
                      children: [
                        {
                          type: 'text',
                          value: it,
                        },
                      ],
                    };

                    if (isBracket(it)) {
                      d.properties = {
                        style: `color: ${colors[it]}`,
                      };
                    }

                    return d;
                  });

                  newChild.push(...b);
                } else {
                  newChild.push(child);
                }
              });
            } else {
              newChild.push(child);
            }
          });

          item.children = newChild;

          acc.push(item);
        } else {
          acc.push(item);
        }

        return acc;
      }, []);
    },
  };
};

const mdDocs = new MarkdownIt({
  html: true,
  linkify: true,
  xhtmlOut: true,
});

mdDocs.use(MarkdownItEmoji);
mdDocs.use(MarkdownItAbbr);
mdDocs.use(MarkdownItDeflist);
mdDocs.use(MarkdownItFootnote);
mdDocs.use(MarkdownItIns);
mdDocs.use(MarkdownItMark);

mdDocs.use(mila, {
  attrs: {
    target: '_blank',
    rel: 'noopener',
  },
});

export async function getPostDataFromDirectory(id: string, dir: string) {
  const fullPath = path.join(dir, `${id}.md`);
  const fileContents = fs.readFileSync(fullPath, 'utf8');

  mdDocs.use(
    await markdownItShikiji({
      highlightLines: false,
      themes: {
        light: theme,
        dark: theme,
      },
      transformers: [
        transformerNotationDiff(),
        transformerNotationHighlight(),
        transformerNotationFocus(),
        transformerNotationErrorLevel(),
        transformerRenderWhitespace(),
        transformerNotationWordHighlight(),
        transformerBracketPairColor({
          colors: {
            '(': '#ffd700',
            ')': '#ffd700',
            '[': '#da70d6',
            ']': '#da70d6',
            '{': '#179fff',
            '}': '#179fff',
          },
        }),
      ],
    }),
  );

  md.use(
    await markdownItShikiji({
      highlightLines: false,
      themes: {
        light: theme,
        dark: theme,
      },
      transformers: [
        transformerNotationDiff(),
        transformerNotationHighlight(),
        transformerNotationFocus(),
        transformerNotationErrorLevel(),
        transformerRenderWhitespace(),
        transformerNotationWordHighlight(),
        transformerTwoslash({
          renderer: rendererRich({
            classExtra: 'ingore-twoslash',
            processHoverDocs: (docs) => {
              const contentHtml = [mdDocs.render(docs)].join('\n').trim().replaceAll('\r\n', '\n');

              return contentHtml;
            },
            renderMarkdown: (content) => {
              const hast = fromHtml(content, { space: 'p', fragment: true }).children;

              return hast;
            },
            renderMarkdownInline,
          }),
          explicitTrigger: true,
        }),
        transformerBracketPairColor({
          colors: {
            '(': '#ffd700',
            ')': '#ffd700',
            '[': '#da70d6',
            ']': '#da70d6',
            '{': '#179fff',
            '}': '#179fff',
          },
        }),
      ],
    }),
  );

  const matterResult = matter(fileContents);

  const contentHtml = [md.render(matterResult.content)].join('\n').trim().replaceAll('\r\n', '\n');

  const time = readingTime(matterResult.content);

  const ogName = stringToSlug(matterResult.data.title);

  await generateSVG(matterResult.data.title, `${cwd()}/public/og-${ogName}.png`);

  return {
    id,
    contentHtml,
    time,
    ogImageUrl: `https://web-totals.vercel.app/og-${ogName}.png`,
    ...(matterResult.data as { data: string; title: string }),
  };
}

async function generateSVG(title: any, output: string) {
  const data = {
    line1: title || '',
    line2: '',
    line3: '',
  };

  const svg = ogSVGPromise.replace(/\{\{([^}]+)\}\}/g, (_, name: keyof typeof data) => data[name]);

  try {
    // eslint-disable-next-line node/prefer-global/buffer
    await sharp(Buffer.from(svg))
      .resize(1200 * 1.1, 630 * 1.1)
      .png()
      .toFile(output);
  } catch (e) {
    console.error('Error generating', { filename: output, ...data, svg });
    console.error(e);
  }
}
