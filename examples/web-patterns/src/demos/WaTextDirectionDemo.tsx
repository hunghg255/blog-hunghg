import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildRanges,
  classifyByScript,
  detectDir,
  DirectionTable,
  packRanges,
  type Dir,
} from '../lib/waTextDirection';
import { DIRECTION_TABLE } from '../lib/waTextDirectionData';
import { Log, Stat, useLog } from './shared';
import './WaTextDirectionDemo.css';

const SAMPLES: [string, string][] = [
  ['Tiếng Việt', 'Xin chào, hẹn gặp lúc 9h'],
  ['Hebrew', 'שלום, נתראה ב-9'],
  ['Arabic có số đứng đầu', '2024 مرحبا بالعالم'],
  ['Mention rồi chữ Ả Rập', '@An مرحبا'],
  ['Chỉ số và emoji', '12:30 😀👍'],
  ['Isolate RLI…PDI rồi chữ Latin', '\u2067שלום\u2069 hello'],
  ['Surrogate lẻ trước chữ Hebrew', '\uD83Dא world'],
];

/** Hành vi của dir() bản 2020, viết lại để so sánh: không bỏ qua isolate; surrogate cao lẻ làm mất ký tự kế tiếp. */
function detectDir2020(text: string, table: DirectionTable): Dir | undefined {
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp < 0xdc00) {
      if (++i === text.length) break;
      const lo = text.charCodeAt(i);
      if (lo < 0xdc00 || lo >= 0xe000) continue; // ký tự ở vị trí i bị bỏ qua luôn
      cp = 0x10000 + (((cp & 0x3ff) << 10) | (lo & 0x3ff));
    } else if (cp >= 0xdc00 && cp < 0xe000) continue;
    const d = table.lookup(cp);
    if (d) return d;
  }
  return undefined;
}

function AutoDir({ text, onDir }: { text: string; onDir: (d: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => onDir(getComputedStyle(ref.current!).direction), [text, onDir]);
  return (
    <div ref={ref} dir='auto' className='wa-dir-text'>
      {text}
    </div>
  );
}

const show = (s: string) => s.replace(/[\u2066-\u2069]/g, (c) => `⟨${['LRI', 'RLI', 'FSI', 'PDI'][c.charCodeAt(0) - 0x2066]}⟩`).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, (c) => `⟨${c.charCodeAt(0).toString(16)}⟩`);

export default function WaTextDirectionDemo() {
  const table = useMemo(() => new DirectionTable(DIRECTION_TABLE), []);
  const [uiDir, setUiDir] = useState<Dir>('ltr');
  const [draft, setDraft] = useState('مرحبا! Gõ thử chữ Ả Rập hoặc Hebrew ở đầu dòng');
  const [auto, setAuto] = useState<Record<number, string>>({});
  const { lines, add } = useLog(12);

  const composerDir = detectDir(draft, table) ?? uiDir;

  function regenerate() {
    const t0 = performance.now();
    const packed = packRanges(buildRanges(classifyByScript));
    const t1 = performance.now();
    const fresh = new DirectionTable(packed);
    fresh.lookup(0x5d0);
    const t2 = performance.now();
    add(
      `Sinh bảng từ regex Unicode: ${(t1 - t0).toFixed(0)} ms, ${packed.length / 2} khoảng · giải nén + tra: ${(t2 - t1).toFixed(2)} ms`,
      'ok',
    );
  }

  function bench() {
    const texts = SAMPLES.map((s) => s[1]);
    const n = 200_000;
    let t0 = performance.now();
    for (let i = 0; i < n; i++) detectDir(texts[i % texts.length], table);
    const tableMs = performance.now() - t0;
    t0 = performance.now();
    for (let i = 0; i < n; i++) {
      for (const ch of texts[i % texts.length]) if (classifyByScript(ch.codePointAt(0)!)) break;
    }
    const regexMs = performance.now() - t0;
    add(`${n.toLocaleString('vi-VN')} lần: bảng nén ${tableMs.toFixed(0)} ms · regex mỗi ký tự ${regexMs.toFixed(0)} ms`, 'ok');
  }

  return (
    <div className='page wa-dir'>
      <h1>Hướng chữ theo ký tự mạnh đầu tiên</h1>
      <p className='hint'>
        Mỗi tin nhắn/tên được gán <code>dir</code> theo ký tự "mạnh" đầu tiên (chữ cái); số, dấu câu, emoji là trung
        tính. Không có ký tự mạnh thì theo ngôn ngữ giao diện.
      </p>
      <div className='stats'>
        <Stat label='khoảng trong bảng' value={table.rangeCount} />
        <Stat label='byte JSON' value={JSON.stringify(DIRECTION_TABLE).length.toLocaleString('vi-VN')} />
        <Stat label='hướng ô soạn tin' value={<output data-testid='composer-dir'>{composerDir}</output>} />
      </div>
      <div className='toolbar'>
        <span className='muted'>Ngôn ngữ giao diện:</span>
        <button className={uiDir === 'ltr' ? 'primary' : ''} onClick={() => setUiDir('ltr')}>
          Tiếng Việt (ltr)
        </button>
        <button className={uiDir === 'rtl' ? 'primary' : ''} onClick={() => setUiDir('rtl')}>
          العربية (rtl)
        </button>
        <button onClick={regenerate}>Sinh lại bảng lúc chạy</button>
        <button onClick={bench}>Đo tốc độ</button>
      </div>
      <textarea
        className='wa-dir-composer'
        data-testid='composer'
        dir={composerDir}
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className='wa-dir-table' role='table'>
        <div className='wa-dir-row head' role='row'>
          <span>Chuỗi</span>
          <span>Bản viết lại</span>
          <span>Kiểu 2020</span>
          <span>dir="auto"</span>
        </div>
        {SAMPLES.map(([label, text], i) => {
          const ours = detectDir(text, table);
          const old = detectDir2020(text, table);
          return (
            <div className='wa-dir-row' role='row' key={label} data-testid={`row-${i}`}>
              <span>
                <b>{label}</b>
                <code>{show(text)}</code>
              </span>
              <span>
                <div dir={ours ?? uiDir} className='wa-dir-text'>
                  {text}
                </div>
                <small data-testid='ours'>{ours ?? `— (theo giao diện: ${uiDir})`}</small>
              </span>
              <span className={old !== ours ? 'diff' : ''}>
                <div dir={old ?? uiDir} className='wa-dir-text'>
                  {text}
                </div>
                <small data-testid='old'>{old ?? '—'}</small>
              </span>
              <span>
                <AutoDir text={text} onDir={(d) => setAuto((a) => (a[i] === d ? a : { ...a, [i]: d }))} />
                <small data-testid='auto'>{auto[i] ?? '…'}</small>
              </span>
            </div>
          );
        })}
      </div>
      <Log lines={lines} />
    </div>
  );
}
