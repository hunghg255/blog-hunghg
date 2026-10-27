// Generates self-hosted cover images for blog posts into public/blogs.
// Usage: node ./scripts/gen-covers.js [file.png]
const path = require('path');
const sharp = require('sharp');

const OUT_DIR = path.join(__dirname, '..', 'public', 'blogs');
const W = 1200;
const H = 630;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Simple word wrap for the title (SVG has no automatic wrapping)
const wrap = (text, max) => {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if ((line + ' ' + word).trim().length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines;
};

const frame = ({ eyebrow, title, accent, art }) => {
  const lines = wrap(title, 16);
  const titleSvg = lines
    .map(
      (l, i) =>
        `<text x="80" y="${250 + i * 76}" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="66" font-weight="700" fill="#f4f4f6" letter-spacing="-1.5">${esc(l)}</text>`,
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="78%" cy="45%" r="55%">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffb347"/>
      <stop offset="0.45" stop-color="#ff7a3d"/>
      <stop offset="1" stop-color="#f2466b"/>
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.04"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="#0b0b0f"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="80" y="130" width="${eyebrow.length * 13 + 36}" height="40" rx="20" fill="${accent}" fill-opacity="0.15"/>
  <text x="98" y="157" font-family="DejaVu Sans Mono, monospace" font-size="19" font-weight="700" fill="${accent}">${esc(eyebrow)}</text>
  ${titleSvg}
  <rect x="80" y="${H - 104}" width="56" height="6" rx="3" fill="url(#brand)"/>
  <text x="80" y="${H - 60}" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="24" font-weight="700" fill="#b9b9c6">hunghg<tspan fill="#ff8a3d">.</tspan>blog</text>
  ${art}
</svg>`;
};

// A dark "file" card used in the illustrations
const fileCard = (x, y, w, h, name, body) => `
  <g transform="translate(${x} ${y})">
    <rect width="${w}" height="${h}" rx="18" fill="#15151c" stroke="#ffffff" stroke-opacity="0.12" stroke-width="2"/>
    <circle cx="26" cy="26" r="7" fill="#ff5f56"/><circle cx="48" cy="26" r="7" fill="#ffbd2e"/><circle cx="70" cy="26" r="7" fill="#27c93f"/>
    <text x="${w - 22}" y="32" text-anchor="end" font-family="DejaVu Sans Mono, monospace" font-size="17" fill="#7c7c8c">${name}</text>
    <line x1="0" y1="52" x2="${w}" y2="52" stroke="#ffffff" stroke-opacity="0.08" stroke-width="2"/>
    ${body}
  </g>`;

const code = (x, y, parts) =>
  `<text x="${x}" y="${y}" xml:space="preserve" font-family="DejaVu Sans Mono, monospace" font-size="19">${parts
    .map(([t, c]) => `<tspan fill="${c}">${esc(t)}</tspan>`)
    .join('')}</text>`;

const reactAtom = (cx, cy, s) => `
  <g transform="translate(${cx} ${cy}) scale(${s})" fill="none" stroke="#61dafb" stroke-width="5">
    <ellipse rx="60" ry="23"/>
    <ellipse rx="60" ry="23" transform="rotate(60)"/>
    <ellipse rx="60" ry="23" transform="rotate(120)"/>
    <circle r="10" fill="#61dafb" stroke="none"/>
  </g>`;

const covers = [
  {
    file: 'svg-to-jsx.png',
    eyebrow: 'SVG → JSX',
    title: 'Convert SVG files to JSX by one script',
    accent: '#61dafb',
    art: `
      ${fileCard(
        700,
        120,
        300,
        190,
        'icon.svg',
        `${code(24, 96, [['<svg ', '#f472b6'], ['viewBox', '#7dd3fc'], ['=', '#b9b9c6']])}
         ${code(24, 128, [['  "0 0 24 24"', '#a5e075'], ['>', '#f472b6']])}
         ${code(24, 160, [['  <path d=… />', '#b9b9c6']])}`,
      )}
      <path d="M850 330 v40" stroke="#ff8a3d" stroke-width="4" stroke-dasharray="6 8" stroke-linecap="round"/>
      <path d="M838 362 l12 16 l12 -16" fill="none" stroke="#ff8a3d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      ${fileCard(
        760,
        392,
        340,
        170,
        'Icon.jsx',
        `${code(24, 96, [['export const ', '#f472b6'], ['Icon', '#fcd34d']])}
         ${code(24, 128, [['  = () => ', '#b9b9c6'], ['<svg />', '#f472b6']])}`,
      )}
      ${reactAtom(1070, 150, 0.9)}`,
  },
  {
    file: 'html-input.png',
    eyebrow: 'HTML',
    title: 'All HTML input types',
    accent: '#e34f26',
    art: `
      <g transform="translate(700 95) scale(0.36)">
        <path d="M71 460 30 0h451l-41 460-185 52z" fill="#e34f26"/>
        <path d="M256 472l149-41 35-394H256z" fill="#ef652a"/>
        <path d="M256 208h-75l-5-58h80V94H114l1 15 14 156h127zm0 147h-1l-63-17-4-45h-56l8 89 116 32h1z" fill="#ebebeb"/>
        <path d="M255 208v57h70l-7 73-63 17v59l116-32 1-10 13-149 2-15zm0-114v56h137l1-12 3-29 1-15z" fill="#fff"/>
      </g>
      <g transform="translate(700 300)" font-family="Liberation Sans, DejaVu Sans, sans-serif">
        <rect width="420" height="270" rx="18" fill="#15151c" stroke="#ffffff" stroke-opacity="0.12" stroke-width="2"/>
        <rect x="28" y="28" width="364" height="48" rx="10" fill="#0b0b0f" stroke="#ff8a3d" stroke-width="2"/>
        <text x="46" y="59" font-size="20" fill="#7c7c8c">type="email"</text>
        <rect x="377" y="40" width="2" height="24" fill="#ff8a3d"/>
        <rect x="28" y="100" width="26" height="26" rx="6" fill="#ff8a3d"/>
        <path d="M34 113l6 6 10-12" fill="none" stroke="#1a0f08" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="66" y="121" font-size="20" fill="#b9b9c6">checkbox</text>
        <circle cx="236" cy="113" r="13" fill="none" stroke="#b9b9c6" stroke-width="2.5"/>
        <circle cx="236" cy="113" r="6" fill="#ff8a3d"/>
        <text x="260" y="121" font-size="20" fill="#b9b9c6">radio</text>
        <rect x="28" y="160" width="364" height="6" rx="3" fill="#2a2a35"/>
        <rect x="28" y="160" width="230" height="6" rx="3" fill="#ff8a3d"/>
        <circle cx="258" cy="163" r="12" fill="#f4f4f6"/>
        <text x="28" y="200" font-size="17" fill="#7c7c8c">range</text>
        <rect x="28" y="214" width="40" height="32" rx="8" fill="#f2466b"/>
        <rect x="76" y="214" width="40" height="32" rx="8" fill="#ffb347"/>
        <rect x="124" y="214" width="40" height="32" rx="8" fill="#61dafb"/>
        <rect x="232" y="210" width="160" height="40" rx="10" fill="url(#brand)"/>
        <text x="312" y="237" text-anchor="middle" font-size="19" font-weight="700" fill="#1a0f08">submit</text>
      </g>`,
  },
  {
    file: 'vscode-extensions.png',
    eyebrow: 'VS CODE',
    title: 'Useful VS Code extensions',
    accent: '#3b9dff',
    art: `
      <g transform="translate(680 110)" font-family="Liberation Sans, DejaVu Sans, sans-serif">
        <rect width="450" height="420" rx="20" fill="#15151c" stroke="#ffffff" stroke-opacity="0.12" stroke-width="2"/>
        <rect x="1" y="1" width="64" height="418" rx="19" fill="#101016"/>
        <rect x="18" y="30" width="30" height="30" rx="6" fill="none" stroke="#7c7c8c" stroke-width="3"/>
        <circle cx="33" cy="100" r="11" fill="none" stroke="#7c7c8c" stroke-width="3"/>
        <g transform="translate(18 140)" fill="#3b9dff">
          <rect width="13" height="13" rx="2"/><rect x="17" width="13" height="13" rx="2"/>
          <rect y="17" width="13" height="13" rx="2"/><rect x="21" y="13" width="13" height="13" rx="2" transform="rotate(45 27 19)"/>
        </g>
        <rect x="1" y="136" width="4" height="40" fill="#3b9dff"/>
        <text x="88" y="46" font-size="15" font-weight="700" fill="#7c7c8c" letter-spacing="2">EXTENSIONS</text>
        ${[
          ['Prettier', 'Code formatter', '#f7b93e'],
          ['ESLint', 'Integrates ESLint', '#7c6fe0'],
          ['GitLens', 'Git supercharged', '#26b3a3'],
          ['Error Lens', 'Inline diagnostics', '#f2466b'],
        ]
          .map(
            ([name, desc, color], i) => `
          <g transform="translate(88 ${74 + i * 84})">
            <rect width="340" height="70" rx="12" fill="${i === 0 ? '#1f1f29' : 'none'}"/>
            <rect x="12" y="12" width="46" height="46" rx="10" fill="${color}"/>
            <text x="72" y="32" font-size="20" font-weight="700" fill="#f4f4f6">${name}</text>
            <text x="72" y="56" font-size="16" fill="#7c7c8c">${desc}</text>
            <rect x="262" y="22" width="64" height="26" rx="6" fill="#3b9dff"/>
            <text x="294" y="41" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">Install</text>
          </g>`,
          )
          .join('')}
      </g>
      <g transform="translate(1060 60) scale(1.1)">
        <path d="M96.46 10.8 75.86.87a6.23 6.23 0 0 0-7.1 1.2L29.35 38.04 12.18 25a4.16 4.16 0 0 0-5.32.24L1.36 30.2a4.17 4.17 0 0 0 0 6.16L16.25 50 1.36 63.63a4.17 4.17 0 0 0 0 6.16l5.5 5a4.16 4.16 0 0 0 5.32.23l17.17-13.03 39.41 35.96a6.22 6.22 0 0 0 7.1 1.2l20.6-9.9A6.24 6.24 0 0 0 100 83.63V16.37a6.24 6.24 0 0 0-3.54-5.57zM75.01 72.7 45.11 50l29.9-22.7z" fill="#3b9dff"/>
      </g>`,
  },
  {
    file: 'trust-ai-agents.png',
    eyebrow: 'AI AGENTS',
    title: 'Trusting your AI coding agents',
    accent: '#a78bfa',
    art: `
      ${fileCard(
        680,
        90,
        440,
        270,
        'trust-curve',
        `<line x1="50" y1="230" x2="410" y2="230" stroke="#7c7c8c" stroke-width="2"/>
         <line x1="50" y1="230" x2="50" y2="76" stroke="#7c7c8c" stroke-width="2"/>
         <text x="410" y="254" text-anchor="end" font-family="DejaVu Sans Mono, monospace" font-size="15" fill="#7c7c8c">agents →</text>
         <text x="60" y="88" font-family="DejaVu Sans Mono, monospace" font-size="15" fill="#7c7c8c">trust</text>
         <path d="M56 222 C 150 220, 210 200, 260 160 S 350 90, 404 82" fill="none" stroke="url(#brand)" stroke-width="5" stroke-linecap="round"/>
         <circle cx="96" cy="221" r="7" fill="#a78bfa"/>
         <circle cx="260" cy="160" r="7" fill="#a78bfa"/>
         <circle cx="404" cy="82" r="8" fill="#ff8a3d"/>`,
      )}
      ${fileCard(
        760,
        392,
        360,
        180,
        'ci.yml',
        `${[
          ['verify', '#27c93f'],
          ['lint + types', '#27c93f'],
          ['auto-merge', '#ff8a3d'],
        ]
          .map(
            ([label, color], i) => `
          <g transform="translate(24 ${74 + i * 34})">
            <circle cx="10" cy="-6" r="10" fill="${color}" fill-opacity="0.18"/>
            <path d="M5 -6 l4 4 l7 -9" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            <text x="32" y="0" font-family="DejaVu Sans Mono, monospace" font-size="19" fill="#b9b9c6">${label}</text>
          </g>`,
          )
          .join('')}`,
      )}`,
  },
  {
    file: 'michelin-kitchen.png',
    eyebrow: 'Q&A',
    title: 'A Michelin kitchen, not a factory',
    accent: '#34d399',
    art: `
      ${fileCard(
        680,
        90,
        440,
        270,
        'loops',
        `<rect x="40" y="76" width="360" height="170" rx="85" fill="none" stroke="#7c7c8c" stroke-width="2" stroke-dasharray="6 8"/>
         <rect x="120" y="116" width="200" height="90" rx="45" fill="#34d399" fill-opacity="0.12" stroke="#34d399" stroke-width="3"/>
         <text x="220" y="158" text-anchor="middle" font-family="DejaVu Sans Mono, monospace" font-size="18" fill="#f4f4f6">inner loop</text>
         <text x="220" y="182" text-anchor="middle" font-family="DejaVu Sans Mono, monospace" font-size="14" fill="#7c7c8c">agents · code</text>
         <text x="220" y="100" text-anchor="middle" font-family="DejaVu Sans Mono, monospace" font-size="14" fill="#7c7c8c">outer loop</text>
         ${['slack', 'linear', 'x']
           .map(
             (label, i) =>
               `<text x="${130 + i * 90}" y="230" text-anchor="middle" font-family="DejaVu Sans Mono, monospace" font-size="14" fill="#ff8a3d">${label}</text>`,
           )
           .join('')}`,
      )}
      ${fileCard(
        760,
        392,
        360,
        180,
        'kitchen',
        `${[
          ['chief of staff', '#34d399'],
          ['verify + fuzz', '#34d399'],
          ['sample, not block', '#ff8a3d'],
        ]
          .map(
            ([label, color], i) => `
          <g transform="translate(24 ${74 + i * 34})">
            <circle cx="10" cy="-6" r="10" fill="${color}" fill-opacity="0.18"/>
            <path d="M5 -6 l4 4 l7 -9" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            <text x="32" y="0" font-family="DejaVu Sans Mono, monospace" font-size="19" fill="#b9b9c6">${label}</text>
          </g>`,
          )
          .join('')}`,
      )}`,
  },
];

// Cover cho series "Học từ mã nguồn Facebook": 1 card code + 1 card "kết quả"
const fbArt = (fileName, codeLines, resultName, results) => `
  ${fileCard(
    680,
    100,
    440,
    250,
    fileName,
    codeLines.map((parts, i) => code(24, 96 + i * 34, parts)).join(''),
  )}
  ${fileCard(
    760,
    382,
    360,
    190,
    resultName,
    results
      .map(
        ([label, color], i) => `
      <g transform="translate(24 ${82 + i * 36})">
        <circle cx="10" cy="-6" r="10" fill="${color}" fill-opacity="0.18"/>
        <circle cx="10" cy="-6" r="4" fill="${color}"/>
        <text x="32" y="0" font-family="DejaVu Sans Mono, monospace" font-size="19" fill="#b9b9c6">${esc(label)}</text>
      </g>`,
      )
      .join(''),
  )}`;

const K = '#f472b6'; // keyword
const F = '#fcd34d'; // function
const S = '#a5e075'; // string
const T = '#b9b9c6'; // text
const P = '#7dd3fc'; // property
const O = '#ff8a3d'; // accent
const G = '#34d399'; // ok

const fbCovers = [
  {
    file: 'fb-series.png',
    eyebrow: 'FACEBOOK SOURCE',
    title: 'Learn from Facebook source code',
    accent: '#3b82f6',
    art: fbArt(
      'bundle.min.js',
      [
        [['__d', F], ['("', T], ['Toaster', S], ['", [', T]],
        [['  "React"', S], [', ', T], ['"setTimeout"', S], ['],', T]],
        [['  function', K], ['(a,b,c,d,', T], ['e', O], [',f){', T]],
        [['    e', O], ['.exports = ', T], ['…', T]],
      ],
      'series',
      [
        ['8 patterns', G],
        ['React + TypeScript', '#61dafb'],
        ['live demos', O],
      ],
    ),
  },
  {
    file: 'fb-intersection-observer.png',
    eyebrow: 'FACEBOOK #1',
    title: 'Share one observer across 300 elements',
    accent: '#34d399',
    art: fbArt(
      'observeIntersection.ts',
      [
        [['const ', K], ['shared', P], [' = cache', T]],
        [['  .get(', T], ['root', O], [')', T]],
        [['  .get(', T], ['optionsKey', O], [')', T]],
        [['shared.', T], ['observe', F], ['(el)', T]],
      ],
      'stats',
      [
        ['300 elements', T],
        ['1 observer', G],
        ['ref counted', O],
      ],
    ),
  },
  {
    file: 'fb-viewport-duration.png',
    eyebrow: 'FACEBOOK #2',
    title: 'Measure real viewport duration',
    accent: '#f0b03a',
    art: fbArt(
      'useViewportDuration.ts',
      [
        [['onHidden', F], ['({', T]],
        [['  visibleDuration', P], [': ', T], ['4210', O], [',', T]],
        [['  hiddenReason', P], [': ', T]],
        [['    "USER_INACTIVE"', S]],
      ],
      'hidden reasons',
      [
        ['NOT_IN_VIEWPORT', T],
        ['TAB_HIDDEN', O],
        ['USER_INACTIVE', '#f0b03a'],
      ],
    ),
  },
  {
    file: 'fb-preload.png',
    eyebrow: 'FACEBOOK #3',
    title: 'Preload code and data on hover',
    accent: '#61dafb',
    art: fbArt(
      'preload.ts',
      [
        [['onPointerEnter', F], [' → ', T], ['50ms', O]],
        [['  Dialog.', T], ['preload', F], ['()', T]],
        [['  user.', T], ['preload', F], ['(', T], ['"42"', S], [')', T]],
        [['click', F], [' → ', T], ['render now', G]],
      ],
      'click → content',
      [
        ['no preload   701ms', '#f2466b'],
        ['preload        1ms', G],
        ['hover ≈ 250ms free', O],
      ],
    ),
  },
  {
    file: 'fb-toast.png',
    eyebrow: 'FACEBOOK #4',
    title: 'Toast manager with an external store',
    accent: '#ff8a3d',
    art: fbArt(
      'toaster.ts',
      [
        [['store.', T], ['push', F], ['(', T], ['"Saved"', S], [')', T]],
        [['  → ', T], ['shown', P], [' → ', T], ['expired', P]],
        [['  → ', T], ['deleted', P]],
        [['useSyncExternalStore', F], ['(…)', T]],
      ],
      'queue',
      [
        ['3 visible', G],
        ['2 queued (max)', O],
        ['paused on hover', '#61dafb'],
      ],
    ),
  },
  {
    file: 'fb-network.png',
    eyebrow: 'FACEBOOK #5',
    title: "Don't trust navigator.onLine",
    accent: '#f2466b',
    art: fbArt(
      'networkStatus.ts',
      [
        [['heartbeat', F], ['(', T], ['"/health"', S], [')', T]],
        [['retryIn', P], [' = ', T], ['100', O], [' * 2', T], ['^n', O]],
        [['  100 → 200 → 400', T]],
        [['  … → ', T], ['6400', O], ['ms', T]],
      ],
      'status',
      [
        ['offline', '#f2466b'],
        ['heartbeat fail ×5', O],
        ['online again', G],
      ],
    ),
  },
  {
    file: 'fb-error-guard.png',
    eyebrow: 'FACEBOOK #6',
    title: 'ErrorGuard: errors with context',
    accent: '#f2466b',
    art: fbArt(
      'errorGuard.ts',
      [
        [['guard', F], ['(fn, { name: ', T], ['"Like"', S], [' })', T]],
        [['guardList', P], [':', T]],
        [['  [', T], ['"Feed.render"', S], [',', T]],
        [['   ', T], ['"Like.onClick"', S], [']', T]],
      ],
      'pipeline',
      [
        ['GUARDED', '#f2466b'],
        ['UNHANDLED_REJECTION', O],
        ['REACT', '#61dafb'],
      ],
    ),
  },
  {
    file: 'fb-banzai.png',
    eyebrow: 'FACEBOOK #7',
    title: 'Banzai: batched client logging',
    accent: '#a78bfa',
    art: fbArt(
      'batchLogger.ts',
      [
        [['logger.', T], ['log', F], ['(', T], ['"click"', S], [')', T]],
        [['  vital', P], ['  1s', O], ['  basic', P], ['  5s', O]],
        [['visibilitychange', F], [' →', T]],
        [['  navigator.', T], ['sendBeacon', F], ['()', T]],
      ],
      'network',
      [
        ['45 events', T],
        ['3 requests', G],
        ['retry on 503', O],
      ],
    ),
  },
  {
    file: 'fb-focus-trap.png',
    eyebrow: 'FACEBOOK #8',
    title: 'Focus trap and layered Escape',
    accent: '#34d399',
    art: fbArt(
      'focusTrap.ts',
      [
        [['useFocusTrap', F], ['(ref, ', T], ['open', O], [')', T]],
        [['useEscapeLayer', F], ['(close)', T]],
        [['Tab', P], [' → wrap inside', T]],
        [['Esc', P], [' → top layer only', T]],
      ],
      'a11y',
      [
        ['focus contained', G],
        ['focus restored', G],
        ['nested dialogs', O],
      ],
    ),
  },
];

covers.push(...fbCovers);

// Series phần 2: spec cover nằm trong JSON (mỗi bài một object) để thêm bài không cần sửa code
const fbCoversPart2 = require('./covers-facebook-part2.json').map((c) => ({
  file: c.file,
  eyebrow: c.eyebrow,
  title: c.title,
  accent: c.accent,
  art: fbArt(c.fileName, c.codeLines, c.resultName, c.results),
}));
covers.push(...fbCoversPart2);

// Cover cho các series khác (thẻ series ở trang /blogs và trang /series/<id>)
covers.push({
  file: 'ai-series.png',
  eyebrow: 'SERIES · AI',
  title: 'AI for developers',
  accent: '#a78bfa',
  art: fbArt(
    'agent.md',
    [
      [['verify', F], ['(', T], ['change', P], [')', T]],
      [['trust', P], [' = ', T], ['evals', O], [' + ', T], ['constraints', O]],
      [['agent', P], ['.', T], ['merge', F], ['()', T]],
      [['webgpu', S], [' · ', T], ['transformers.js', S]],
    ],
    'series',
    [
      ['AI agents that ship', G],
      ['Q&A: 2,500 PR/month', '#a78bfa'],
      ['models in the browser', O],
    ],
  ),
});

const only = process.argv[2];

(async () => {
  for (const c of covers.filter((c) => !only || c.file === only)) {
    const out = path.join(OUT_DIR, c.file);
    await sharp(Buffer.from(frame(c))).png({ compressionLevel: 9 }).toFile(out);
    console.log('✓', path.relative(process.cwd(), out));
  }
})();
