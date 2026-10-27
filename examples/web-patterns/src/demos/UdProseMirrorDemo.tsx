import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  filterToSchema,
  normalizePastedHtml,
  textToParagraphs,
  toEmailHtml,
  type Feature,
} from '../lib/udProseMirror';
import { parseInert } from '../lib/udSafeHtml';
import { Stat } from './shared';
import './UdProseMirrorDemo.css';

const SAMPLES: Record<string, string> = {
  'Google Docs': `<b style="font-weight:normal" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700">Chú ý:</span> nộp bài trước <i>thứ Sáu</i>, xem <a href="https://www.udemy.com/course/x">khoá học</a>.</p><ul><li>Bước 1</li><li>Bước 2</li></ul></b>`,
  'VS Code': `<div style="color:#d4d4d4;background-color:#1e1e1e;white-space:pre;"><div><span style="color:#569cd6;">const</span> total = <span style="color:#dcdcaa;">sum</span>(a, b);</div><div>console.<span style="color:#dcdcaa;">log</span>(total);</div></div>`,
  PyCharm: `<pre style="background-color:#2b2b2b;color:#a9b7c6;"><span style="color:#cc7832;">def </span>hello():<br>    <span style="color:#8888c6;">print</span>(<span style="color:#6a8759;">"hi"</span>)<br class="x"></pre>`,
  'Link độc': `<p>Bấm <a href="javascript:alert(document.domain)//udemy.com">vào đây</a> hoặc <a href="/\\evil.com">đây</a>.</p><img src=x onerror="window.__udPmXss=1">`,
};

// Mô phỏng applyHackToPreserveWhitespace + applyHackToPreserveEmptyLines của Udemy (chỉ đổi chuỗi ≥ 2 dấu cách)
function udemyStyleEmail(html: string) {
  const root = parseInert(html);
  root.querySelectorAll('p').forEach((p) => {
    if (p.childNodes.length === 0) p.append(document.createElement('br'));
  });
  const walk = (n: Node) => {
    n.childNodes.forEach((c) => {
      if (c.nodeType === Node.TEXT_NODE && !(c.parentElement?.closest('pre, code'))) {
        c.textContent = (c.textContent ?? '').replace(/ +/g, (s) =>
          s.length === 1 ? ' ' : Array.from(s, (_, i) => (i % 2 === 0 ? '\u00a0' : ' ')).join(''),
        );
      } else walk(c);
    });
  };
  walk(root);
  return root.innerHTML;
}

const EMAIL_SOURCE =
  '<p> Thụt đầu dòng 1 dấu cách</p><p>Cột A    Cột B    Cột C</p><p></p><p>Sau một dòng trống. Kết thúc có dấu cách </p>';

function emailDoc(body: string) {
  // email client: không có white-space: pre-wrap, font mặc định
  return `<!doctype html><meta charset="utf-8"><body style="font:15px/1.5 Georgia,serif;margin:10px;color:#222;background:#fff">${body}</body>`;
}

// ---- NodeView mini: component React sống trong một ô không sửa được giữa vùng contenteditable ----
let mounts = 0;
function MathChip({ tex, onMount }: { tex: string; onMount: (n: number) => void }) {
  useEffect(() => {
    mounts += 1;
    onMount(mounts);
  }, [onMount]);
  const [a, b] = tex.split('/');
  return (
    <span className='udp-frac' aria-label={`${a} chia ${b}`}>
      <span>{a}</span>
      <span>{b}</span>
    </span>
  );
}

export default function UdProseMirrorDemo() {
  const [features, setFeatures] = useState<Set<Feature>>(new Set(['bold', 'italic', 'link', 'list', 'codeBlock']));
  const [source, setSource] = useState(SAMPLES['Google Docs']);
  const toggle = (f: Feature) =>
    setFeatures((prev) => {
      const next = new Set(prev);
      next.has(f) ? next.delete(f) : next.add(f);
      return next;
    });
  const result = useMemo(
    () => filterToSchema(normalizePastedHtml(source, { codeBlock: features.has('codeBlock') }), features),
    [source, features],
  );

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    setSource(html || textToParagraphs(e.clipboardData.getData('text/plain')));
  };

  const emails = useMemo(
    () => ({ raw: EMAIL_SOURCE, udemy: udemyStyleEmail(EMAIL_SOURCE), fixed: toEmailHtml(EMAIL_SOURCE) }),
    [],
  );

  // NodeView: host là một <span contenteditable=false>; "không có update()" = mỗi lần sửa thì tạo host mới
  const editorRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  const [recreate, setRecreate] = useState(false);
  const [mountCount, setMountCount] = useState(0);
  useEffect(() => {
    const editor = editorRef.current!;
    editor.innerHTML = '';
    editor.append('Diện tích bằng ');
    const span = document.createElement('span');
    span.contentEditable = 'false';
    span.className = 'udp-host';
    editor.append(span, ' mét vuông.');
    hostRef.current = span;
    setHost(span);
  }, []);
  const onEditorInput = () => {
    const current = hostRef.current;
    if (!recreate || !current) return;
    const fresh = document.createElement('span');
    fresh.contentEditable = 'false';
    fresh.className = 'udp-host';
    current.replaceWith(fresh);
    hostRef.current = fresh;
    setHost(fresh);
  };

  const ALL: Feature[] = ['bold', 'italic', 'code', 'link', 'list', 'codeBlock'];

  return (
    <div className='page udp'>
      <h1>Editor rich text: schema theo flag, dán từ IDE, HTML cho email</h1>

      <h2>1. Dán vào editor</h2>
      <p className='hint'>
        Chọn một mẫu hoặc dán thẳng vào ô bên dưới. HTML dán vào được chuẩn hoá (VS Code, PyCharm) rồi lọc theo những
        feature đang bật; link phải qua kiểm tra href.
      </p>
      <div className='toolbar' role='group' aria-label='Feature'>
        {ALL.map((f) => (
          <label key={f}>
            <input type='checkbox' checked={features.has(f)} onChange={() => toggle(f)} /> {f}
          </label>
        ))}
      </div>
      <div className='toolbar'>
        {Object.keys(SAMPLES).map((k) => (
          <button key={k} onClick={() => setSource(SAMPLES[k])} data-testid={`sample-${k}`}>
            Dán từ {k}
          </button>
        ))}
      </div>
      <div className='udp-paste' contentEditable suppressContentEditableWarning onPaste={onPaste}>
        (dán vào đây)
      </div>
      <div className='split'>
        <div>
          <b>HTML sau khi lọc</b>
          <pre className='udp-code' data-testid='filtered'>
            {result}
          </pre>
        </div>
        <div>
          <b>Hiển thị</b>
          <div className='udp-preview' dangerouslySetInnerHTML={{ __html: result }} />
        </div>
      </div>

      <h2>2. Xuất HTML cho email</h2>
      <p className='hint'>
        Email client không hỗ trợ <code>white-space: pre-wrap</code>: nhiều dấu cách bị gộp, đoạn rỗng cao 0px. Mỗi khung
        dưới đây là một &quot;email&quot; không có CSS giữ khoảng trắng.
      </p>
      <div className='udp-emails'>
        {(['raw', 'udemy', 'fixed'] as const).map((k) => (
          <figure key={k}>
            <figcaption>
              {k === 'raw' ? 'HTML thô' : k === 'udemy' ? 'Kiểu Udemy' : 'Bản sửa (thêm đầu/cuối đoạn)'}
            </figcaption>
            <iframe title={`email-${k}`} srcDoc={emailDoc(emails[k])} data-testid={`email-${k}`} />
            <code className='udp-small'>{emails[k].replace(/\u00a0/g, '·')}</code>
          </figure>
        ))}
      </div>

      <h2>3. NodeView: component React giữa vùng soạn thảo</h2>
      <p className='hint'>
        Phân số là một component React render qua portal vào ô <code>contenteditable=false</code>. Gõ chữ quanh nó: nếu
        NodeView có <code>update()</code> thì component sống tiếp; nếu không (bật ô bên dưới), mỗi lần sửa nó bị huỷ và
        tạo lại.
      </p>
      <label className='udp-check'>
        <input type='checkbox' checked={recreate} onChange={(e) => setRecreate(e.target.checked)} /> NodeView không có
        update() (tạo lại mỗi lần sửa)
      </label>
      <div
        ref={editorRef}
        className='udp-editor'
        contentEditable
        suppressContentEditableWarning
        onInput={onEditorInput}
        data-testid='nodeview-editor'
      />
      {host && createPortal(<MathChip tex='3/4' onMount={setMountCount} />, host)}
      <div className='stats'>
        <Stat label='số lần mount component' value={<output data-testid='mounts'>{mountCount}</output>} />
      </div>
    </div>
  );
}
