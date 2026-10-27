import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CONSOLE_BRIDGE,
  PREVIEW_SANDBOX,
  buildPreviewDocument,
  extensionOf,
  protectLoops,
  type CodeFile,
  type PreviewMessage,
} from '../lib/udCodePreview';
import { Log, Stat, useLog } from './shared';
import './UdCodePreviewDemo.css';

const PRESETS: Record<string, CodeFile[]> = {
  'Bình thường': [
    { name: 'index.html', content: '<h2>Bộ đếm</h2>\n<button id="btn">+1</button> <b id="out">0</b>' },
    { name: 'style.css', content: 'body { font-family: sans-serif; padding: 12px }\nbutton { font-size: 18px }' },
    {
      name: 'app.js',
      content:
        "let count = 0\nconst out = document.getElementById('out')\ndocument.getElementById('btn').onclick = () => {\n  out.textContent = ++count\n  console.log('count =', count)\n}\nconsole.log('app.js đã chạy')",
    },
  ],
  'Vòng lặp vô hạn': [
    { name: 'index.html', content: '<p id="msg">Đang chạy…</p>' },
    {
      name: 'app.js',
      content:
        "let i = 0\nwhile (true) {\n  i++ // quên điều kiện dừng\n}\ndocument.getElementById('msg').textContent = 'Vẫn sống, i = ' + i\nconsole.log('trang vẫn phản hồi, i =', i)",
    },
  ],
  'Hai file dính nhau': [
    { name: 'index.html', content: '<p id="msg"></p>' },
    { name: 'config.js', content: "const greeting = 'Xin chào'" },
    { name: 'App.jsx', content: "document.getElementById('msg').textContent = greeting\nconsole.log('App.jsx chạy được')" },
  ],
  'HTML có <img onerror>': [
    {
      name: 'index.html',
      content:
        '<p>Ảnh hỏng bên dưới có onerror:</p>\n<img src="data:image/png;base64,AAAA" onerror="window.__previewLeak && window.__previewLeak(location.origin); console.log(\'onerror chạy ở\', location.origin)">',
    },
  ],
};

/**
 * Mô phỏng cách bản gốc ghép trang (không phải mã của Udemy):
 * HTML được gán vào innerHTML của một phần tử <html> tạo từ `document` của trang chính,
 * và nối nhóm file .js với nhóm .jsx không có dấu phân cách.
 */
function buildOriginalStyle(files: CodeFile[]) {
  const html = files.find((f) => ['html', 'htm'].includes(extensionOf(f.name)))?.content ?? '';
  const root = document.createElement('html');
  root.innerHTML = html; // ← phần tử thuộc trang chính: ảnh được tải, onerror chạy ở trang chính
  const join = (ext: string) => files.filter((f) => extensionOf(f.name) === ext).map((f) => f.content).join('\n');
  const css = join('css');
  const js = join('js') + join('jsx');
  const { code } = protectLoops(js);
  const body = root.querySelector('body') ?? root;
  const style = document.createElement('style');
  style.textContent = css;
  (root.querySelector('head') ?? root).appendChild(style);
  // cầu nối console chỉ để demo hiện log; lỗi cú pháp của `code` làm hỏng cả script này
  const bridge = document.createElement('script');
  bridge.textContent = CONSOLE_BRIDGE + '\nwindow.__loopGuard = function () { return false };';
  (root.querySelector('head') ?? root).prepend(bridge);
  const script = document.createElement('script');
  script.textContent = code; // (bản gốc chạy qua thư viện loop-protect)
  body.appendChild(script);
  return '<!doctype html>' + root.outerHTML;
}

export default function UdCodePreviewDemo() {
  const [preset, setPreset] = useState('Bình thường');
  const [files, setFiles] = useState<CodeFile[]>(PRESETS['Bình thường']);
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<'ours' | 'original'>('ours');
  const [leaks, setLeaks] = useState(0);
  const [srcdoc, setSrcdoc] = useState('');
  const [loops, setLoops] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const log = useLog(40);

  // "rò rỉ": hàm này chỉ được gọi nếu code của người dùng chạy được ở TRANG CHÍNH
  useEffect(() => {
    (window as unknown as { __previewLeak?: (o: string) => void }).__previewLeak = (origin: string) => {
      setLeaks((n) => n + 1);
      log.add(`⚠ onerror đã chạy ở trang chính (${origin})`, 'err');
    };
    return () => {
      delete (window as unknown as { __previewLeak?: unknown }).__previewLeak;
    };
  }, [log.add]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<PreviewMessage>) => {
      // chỉ tin tin nhắn đến từ đúng iframe preview
      if (event.source !== iframeRef.current?.contentWindow || event.data?.source !== 'ud-preview') return;
      if (event.data.type === 'console') log.add(`[iframe ${event.data.level}] ${event.data.text}`, event.data.level === 'error' ? 'err' : event.data.level === 'warn' ? 'warn' : undefined);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [log.add]);

  // giống bản gốc: chờ 1 giây sau lần gõ cuối mới dựng lại preview
  useEffect(() => {
    const timer = setTimeout(() => {
      if (mode === 'ours') {
        const built = buildPreviewDocument(files, { loopLimitMs: 300 });
        setLoops(built.loops);
        setSrcdoc(built.html);
      } else {
        setLoops(0);
        setSrcdoc(buildOriginalStyle(files));
      }
      log.add(`Dựng lại preview (${mode === 'ours' ? 'viết lại' : 'kiểu gốc'})`, 'muted');
    }, 1000);
    return () => clearTimeout(timer);
  }, [files, mode, log.add]);

  const choosePreset = (name: string) => {
    setPreset(name);
    setFiles(PRESETS[name]);
    setActive(0);
    log.clear();
  };

  const current = files[active];
  const fileList = useMemo(() => files.map((f) => f.name), [files]);

  return (
    <div className='page ud-preview'>
      <h1>Preview code trong iframe sandbox</h1>
      <p className='hint'>
        Iframe dùng <code>sandbox="{PREVIEW_SANDBOX}"</code> (không có <code>allow-same-origin</code>) nên chạy ở origin
        "null". Chế độ "kiểu gốc" mô phỏng cách ghép trang của bản gốc và không chặn vòng lặp, nên bị khoá với ví dụ
        vòng lặp vô hạn.
      </p>
      <div className='toolbar'>
        <label>
          Ví dụ{' '}
          <select value={preset} onChange={(e) => choosePreset(e.target.value)} data-testid='preset'>
            {Object.keys(PRESETS).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          <input type='radio' checked={mode === 'ours'} onChange={() => setMode('ours')} data-testid='mode-ours' /> viết lại
        </label>
        <label>
          <input
            type='radio'
            checked={mode === 'original'}
            onChange={() => setMode('original')}
            disabled={preset === 'Vòng lặp vô hạn'}
            data-testid='mode-original'
          />{' '}
          kiểu gốc
        </label>
      </div>
      <div className='stats'>
        <Stat label='vòng lặp được bảo vệ' value={<bdi data-testid='loops'>{loops}</bdi>} />
        <Stat label='lần code chạy ở trang chính' value={<bdi data-testid='leaks'>{leaks}</bdi>} />
      </div>
      <div className='split'>
        <div>
          <div className='ud-preview-tabs' role='tablist'>
            {fileList.map((name, i) => (
              <button key={name} role='tab' aria-selected={i === active} onClick={() => setActive(i)}>
                {name}
              </button>
            ))}
          </div>
          <textarea
            className='ud-preview-code'
            spellCheck={false}
            value={current?.content ?? ''}
            onChange={(e) => setFiles((list) => list.map((f, i) => (i === active ? { ...f, content: e.target.value } : f)))}
            data-testid='code'
          />
        </div>
        <iframe
          ref={iframeRef}
          className='ud-preview-frame'
          title='Kết quả code'
          sandbox={PREVIEW_SANDBOX}
          srcDoc={srcdoc}
          data-testid='frame'
        />
      </div>
      <Log lines={log.lines} />
    </div>
  );
}
