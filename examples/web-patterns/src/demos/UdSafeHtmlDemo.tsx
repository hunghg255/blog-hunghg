import { useState } from 'react';
import { checkHref, getDetachedDoc, hasSetHTML, htmlToText } from '../lib/udSafeHtml';
import { Stat, sleep } from './shared';
import './UdSafeHtmlDemo.css';

declare global {
  interface Window {
    __udSafeHits?: number;
  }
}

const PAYLOAD =
  '<p>Bài viết của <b>An</b></p><img src="/__no-such-image__.png" onerror="window.__udSafeHits=(window.__udSafeHits||0)+1">';

type Method = 'main-div' | 'detached' | 'domparser' | 'template';
const METHODS: { id: Method; label: string; run: (html: string) => void }[] = [
  {
    id: 'main-div',
    label: "document.createElement('div').innerHTML (chưa gắn vào trang)",
    run: (html) => {
      const div = document.createElement('div');
      div.innerHTML = html;
    },
  },
  { id: 'detached', label: 'document tách rời (createHTMLDocument)', run: (html) => void (getDetachedDoc().createElement('div').innerHTML = html) },
  { id: 'domparser', label: 'new DOMParser().parseFromString', run: (html) => void new DOMParser().parseFromString(html, 'text/html') },
  {
    id: 'template',
    label: '<template>.innerHTML',
    run: (html) => {
      const t = document.createElement('template');
      t.innerHTML = html;
    },
  },
];

// Mô phỏng validateHref của Udemy (cắt chuỗi theo '://'), và cách schema dùng nó:
// chỉ xem có lỗi hay không, còn href lưu lại là CHUỖI GỐC.
const URL_SCHEMES = ['http', 'https', 'ftp', 'ftps'];
function udemyStyleCheck(href: string): { accepted: boolean; stored: string } {
  if (!href) return { accepted: false, stored: '' };
  if (href.startsWith('mailto:')) return { accepted: /.+@.+\...+/.test(href.split(':')[1]), stored: href };
  if (href.startsWith('/')) return { accepted: true, stored: href };
  if (!/([\w-]{1,63}\.[a-zA-Z-]{2,63}|(?:\d{1,3}\.){3}\d{1,3})/.test(href)) return { accepted: false, stored: '' };
  const scheme = href.split('://')[0];
  if (scheme === href) return { accepted: true, stored: href }; // "không có scheme" → hợp lệ
  return { accepted: URL_SCHEMES.includes(scheme.toLowerCase()), stored: href };
}

const HREFS = [
  'https://www.udemy.com/course/react',
  'udemy.com/topic/python',
  'example.com:8080/docs',
  'mailto:hello@udemy.com',
  '/home/my-courses',
  'javascript:alert(document.domain)//udemy.com',
  'JAVASCRIPT:alert(1)//a.io',
  'data:text/html,<script>alert(1)</script>//x.co',
  '/\\evil.com',
  '//evil.com',
  'javascript://udemy.com/%0aalert(1)',
];

export default function UdSafeHtmlDemo() {
  const [results, setResults] = useState<Partial<Record<Method, number>>>({});
  const [running, setRunning] = useState(false);

  async function runAll() {
    setRunning(true);
    const out: Partial<Record<Method, number>> = {};
    for (const m of METHODS) {
      window.__udSafeHits = 0;
      m.run(PAYLOAD);
      await sleep(400); // chờ ảnh lỗi (nếu trình duyệt có tải)
      out[m.id] = window.__udSafeHits ?? 0;
    }
    setResults(out);
    setRunning(false);
  }

  return (
    <div className='page uds'>
      <h1>Parse HTML không chạy script, kiểm tra href</h1>

      <h2>1. Parse HTML ở đâu thì an toàn?</h2>
      <p className='hint'>
        Payload có <code>{'<img onerror>'}</code> tăng một bộ đếm khi chạy. Bấm để parse cùng payload bằng 4 cách, không
        cách nào gắn kết quả vào trang.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={runAll} disabled={running} data-testid='run-parse'>
          {running ? 'Đang chạy…' : '▶ Parse bằng 4 cách'}
        </button>
      </div>
      <table className='uds-table'>
        <tbody>
          {METHODS.map((m) => (
            <tr key={m.id}>
              <td>{m.label}</td>
              <td data-testid={`hits-${m.id}`}>
                {results[m.id] === undefined ? '—' : results[m.id]! > 0 ? '⚠️ onerror ĐÃ CHẠY' : '✅ không chạy'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className='hint'>
        <code>htmlToText(payload)</code> → <b data-testid='text'>{htmlToText(PAYLOAD)}</b>
      </p>

      <h2>2. Kiểm tra href</h2>
      <p className='hint'>
        Cột giữa mô phỏng <code>validateHref</code> của Udemy (cắt chuỗi theo <code>://</code>) và cách schema dùng nó
        khi parse HTML dán vào: không lỗi là giữ nguyên href gốc.
      </p>
      <div className='uds-scroll'>
        <table className='uds-table'>
          <thead>
            <tr>
              <th>href</th>
              <th>Kiểu Udemy</th>
              <th>checkHref</th>
            </tr>
          </thead>
          <tbody>
            {HREFS.map((h) => {
              const u = udemyStyleCheck(h);
              const c = checkHref(h);
              const dangerous = /^\s*(javascript|data):/i.test(u.stored) || /^\/[/\\]/.test(u.stored);
              return (
                <tr key={h} data-testid='href-row'>
                  <td>
                    <code>{h}</code>
                  </td>
                  <td className={u.accepted ? (dangerous ? 'err' : 'ok') : 'muted'}>
                    {u.accepted ? `nhận${dangerous ? ' ⚠️' : ''}` : 'từ chối'}
                  </td>
                  <td className={c.ok ? 'ok' : 'muted'}>{c.ok ? <code>{c.href}</code> : c.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>3. Sanitizer API</h2>
      <div className='stats'>
        <Stat
          label='Element.setHTML có trên trình duyệt này?'
          value={<output data-testid='sethtml'>{hasSetHTML() ? 'có' : 'chưa'}</output>}
        />
      </div>
    </div>
  );
}
