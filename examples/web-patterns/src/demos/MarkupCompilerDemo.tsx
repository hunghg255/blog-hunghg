import { useMemo, useState } from 'react';
import { CMLError, cmlToHTML, htmlToCML } from '../lib/markupCompiler';
import './MarkupCompilerDemo.css';

const PRESETS: { label: string; html: string; variables?: Record<string, string> }[] = [
  {
    label: 'Bài học mẫu',
    html: `<h2>Bài 3: Hồi quy tuyến tính</h2>
<p>Chào %name%, hôm nay ta tìm <b>w</b> sao cho \\(J(w) = \\frac{1}{2m}\\sum (h(x) - y)^2\\) nhỏ nhất.</p>
<ul><li>Đọc <a href="/learn/ml/week1">tuần 1</a></li><li>Làm bài tập trên <a href="https://www.coursera.org/learn">Coursera</a></li></ul>
<pre data-language="python">w = w - alpha * grad</pre>`,
    variables: { name: 'Lan' },
  },
  {
    label: '<script> và <div>',
    html: `<p>Xin chào <script>alert(1)</script></p>
<div class="banner">Quảng cáo</div>
<p><a>link không có href</a></p>`,
  },
  {
    label: 'javascript: có khoảng trắng',
    html: `<p>Xem <a href=" javascript:alert(document.cookie)">đáp án</a> ở đây.</p>`,
  },
  {
    label: 'Tên miền giả',
    html: `<p>Đăng nhập lại tại <a href="https://аpple.com/login">https://аpple.com/login</a></p>`,
  },
  {
    label: 'Biến chứa HTML',
    html: `<p>Chúc mừng %name% đã hoàn thành khoá học!</p>`,
    variables: { name: '<img src=x onerror="alert(1)">' },
  },
  {
    label: '&copy; và <br>',
    html: `Bản quyền &copy; 2026<br>Mọi quyền được bảo lưu.<p>Đoạn tiếp theo</p>`,
  },
];

// ---------------------------------------------------------------------------
// Mô phỏng cách làm của bản gốc (rút gọn, chỉ để so sánh; không phải mã của Coursera)
// ---------------------------------------------------------------------------

/** Bản gốc: vá HTML bằng regex rồi parse như XML. */
function courseraLikeParse(html: string) {
  const sanitized = html
    .replace(/&nbsp;/gi, ' ')
    .replace(/(<img("[^"]*"|[^/">])*)>/g, '$1/>')
    .replace(/<br[/]*>/g, '');
  const doc = new DOMParser().parseFromString(`<body>${sanitized}</body>`, 'application/xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  return error ? `parsererror: ${error.textContent?.trim().split('\n')[0]}` : 'parse XML được';
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Bản gốc: dựng HTML bằng nối chuỗi; chặn javascript: bằng regex; thay biến trên HTML cuối. */
function courseraLikeToHTML(cml: string, variables: Record<string, string>) {
  const doc = new DOMParser().parseFromString(cml, 'application/xml');
  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escape(node.textContent ?? '');
    const el = node as Element;
    const inner = Array.from(el.childNodes).map(inline).join('');
    if (el.localName === 'a') {
      let href = el.getAttribute('href') ?? '';
      if (/^javascript:/i.test(href) || /^data:/i.test(href)) href = '';
      // bản gốc đổi tên miền sang punycode (thư viện punycode); ở đây dùng URL cho gọn
      const puny = (s: string) => {
        try {
          return /^https?:\/\//i.test(s) ? new URL(s).href : s;
        } catch {
          return s;
        }
      };
      return `<a href="${escape(puny(href))}" target="_blank" rel="noopener nofollow">${el.childNodes.length === 1 && el.firstChild!.nodeType === Node.TEXT_NODE ? escape(puny(el.textContent ?? '')) : inner}</a>`;
    }
    return `<${el.localName}>${inner}</${el.localName}>`;
  };
  let html = Array.from(doc.documentElement.children)
    .map((block) => {
      const inner = Array.from(block.childNodes).map(inline).join('');
      if (block.localName === 'heading') return `<h${block.getAttribute('level')}>${inner}</h${block.getAttribute('level')}>`;
      if (block.localName === 'code') return `<pre>${escape(block.textContent ?? '')}</pre>`;
      if (block.localName === 'list') {
        const items = Array.from(block.children).map((li) => `<li>${Array.from(li.firstElementChild?.childNodes ?? []).map(inline).join('')}</li>`);
        return `<ul>${items.join('')}</ul>`;
      }
      return `<p>${inner}</p>`;
    })
    .join('');
  for (const [key, value] of Object.entries(variables)) html = html.replace(new RegExp(`%${key}%`, 'g'), value);
  return html;
}

/** Kiểm tra HTML thật sự nguy hiểm theo cách trình duyệt hiểu nó. */
function dangers(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const found: string[] = [];
  doc.querySelectorAll('a[href]').forEach((a) => {
    try {
      if (new URL(a.getAttribute('href')!, 'https://example.invalid/').protocol === 'javascript:') found.push('link javascript: chạy được');
    } catch {
      // bỏ qua
    }
  });
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) if (attr.name.startsWith('on')) found.push(`thuộc tính ${attr.name} trên <${el.localName}>`);
  });
  doc.querySelectorAll('script').forEach(() => found.push('thẻ <script>'));
  return found;
}

export default function MarkupCompilerDemo() {
  const [html, setHtml] = useState(PRESETS[0].html);
  const [variables, setVariables] = useState<Record<string, string>>(PRESETS[0].variables ?? {});
  const [repair, setRepair] = useState(false);

  const result = useMemo(() => {
    let cml = '';
    let out = '';
    let error: string[] = [];
    try {
      cml = htmlToCML(html, { repair });
      out = cmlToHTML(cml, { variables, internalHosts: ['www.coursera.org'] });
    } catch (e) {
      error = e instanceof CMLError ? e.diagnostics.map((d) => `${d.path}: ${d.message}`) : [(e as Error).message];
    }
    const legacy = cml ? courseraLikeToHTML(cml, variables) : '';
    return { cml, out, error, legacy, legacyParse: courseraLikeParse(html), ours: dangers(out), theirs: dangers(legacy) };
  }, [html, variables, repair]);

  return (
    <div className='page markup-demo'>
      <h1>Ngôn ngữ markup riêng, dịch hai chiều với HTML</h1>
      <p className='hint'>
        HTML từ editor → CML (chỉ vài block và thẻ inline được phép) → HTML để hiển thị. Chọn một mẫu hoặc sửa
        HTML bên dưới. Cột phải là cách dựng HTML bằng nối chuỗi như bản gốc, để so lỗ hổng.
      </p>

      <div className='toolbar'>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => {
              setHtml(p.html);
              setVariables(p.variables ?? { name: 'Lan' });
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={repair} onChange={(e) => setRepair(e.target.checked)} /> repair (bọc chữ trần vào
          &lt;text&gt;)
        </label>
        <label className='mc-var'>
          %name% =
          <input type='text' value={variables.name ?? ''} onChange={(e) => setVariables({ ...variables, name: e.target.value })} />
        </label>
      </div>

      <textarea className='mc-input' aria-label='HTML đầu vào' value={html} onChange={(e) => setHtml(e.target.value)} spellCheck={false} />

      <div className='mc-grid'>
        <section className='card'>
          <h2>CML lưu vào DB</h2>
          {result.error.length ? (
            <ul className='err'>
              {result.error.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : (
            <pre className='mc-code'>{result.cml.replace(/></g, '>\n<')}</pre>
          )}
          <p className='muted mc-small'>Parse kiểu XML như bản gốc: {result.legacyParse}</p>
        </section>

        <section className='card'>
          <h2>HTML dựng bằng DOM (bản viết lại)</h2>
          <Verdict items={result.ours} empty={!result.out} />
          <pre className='mc-code'>{result.out}</pre>
          {result.out && <iframe className='mc-preview' title='Xem trước' sandbox='' srcDoc={previewDoc(result.out)} />}
        </section>

        <section className='card'>
          <h2>HTML nối chuỗi (kiểu bản gốc)</h2>
          <Verdict items={result.theirs} empty={!result.legacy} />
          <pre className='mc-code'>{result.legacy}</pre>
        </section>
      </div>
    </div>
  );
}

function Verdict({ items, empty }: { items: string[]; empty: boolean }) {
  if (empty) return <p className='muted mc-small'>Không có kết quả.</p>;
  return items.length ? (
    <p className='badge err'>Nguy hiểm: {[...new Set(items)].join(', ')}</p>
  ) : (
    <p className='badge ok'>Không thấy gì chạy được</p>
  );
}

const isDark = () => {
  const theme = document.documentElement.getAttribute('data-theme');
  return theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};

const previewDoc = (body: string) => {
  const [bg, fg, link] = isDark() ? ['#0f0f13', '#ececf1', '#7dd3fc'] : ['#ffffff', '#17171c', '#0b57d0'];
  return `<!doctype html><meta charset="utf-8"><style>body{font:14px system-ui;margin:8px;background:${bg};color:${fg}}a{color:${link}}.math{font-family:serif;font-style:italic;background:#8883;padding:0 3px}</style>${body}`;
};
