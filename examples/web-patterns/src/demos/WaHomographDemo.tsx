import { useState } from 'react';
import {
  cleanFilename,
  extractHost,
  findSuspicious,
  findSuspicious2020,
  type Party,
  type Suspicion,
} from '../lib/waHomograph';
import { Log, useLog } from './shared';
import './WaHomographDemo.css';

const LINKS: [string, string][] = [
  ['Toàn Kirin', 'https://аррӏе.com/id/login'],
  ['Trộn 1 chữ Kirin', 'аpple.com/support'],
  ['Omicron Hy Lạp', 'https://gοogle.com'],
  ['TLD Kirin', 'paypal.сом/verify'],
  ['Chữ có dấu', 'wíkipedia.org/wiki/Vietnam'],
  ['Link thường', 'https://www.whatsapp.com/download'],
];
const FILES = ['hoa_don_2026\u202Efdp.exe', 'bao_gia.exe. ', 'anh\u2067cv\u2069.scr', 'photo.jpg', 'ke_hoach.DOCX'];
const PARTIES: Record<string, Party> = {
  'Bạn ở VN, người gửi ở VN': { myCallingCode: '84', senderCallingCode: '84', languages: ['vi', 'en'] },
  'Bạn ở VN, người gửi ở Nga': { myCallingCode: '84', senderCallingCode: '7', languages: ['vi'] },
  'Bạn ở Ba Lan (tiếng Ba Lan)': { myCallingCode: '48', senderCallingCode: '48', languages: ['pl'] },
};
const REASONS: Record<Suspicion['reason'], string> = {
  'lookalike-label': 'cả nhãn là chữ Kirin giống Latin',
  'mixed-script': 'trộn Latin với Kirin/Hy Lạp',
  'rare-accent': 'chữ có dấu lạ với bạn',
};

function Highlight({ text, chars }: { text: string; chars?: Set<string> }) {
  return (
    <>
      {Array.from(text).map((c, i) => (chars?.has(c) ? <mark key={i}>{c}</mark> : <span key={i}>{c}</span>))}
    </>
  );
}

const asciiHost = (host: string) => {
  try {
    return new URL('http://' + host).hostname;
  } catch {
    return host;
  }
};
const escapeControls = (s: string) =>
  s.replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g, (c) => `\\u${c.charCodeAt(0).toString(16).toUpperCase()}`);

export default function WaHomographDemo() {
  const [link, setLink] = useState(LINKS[0][1]);
  const [partyKey, setPartyKey] = useState(Object.keys(PARTIES)[0]);
  const [file, setFile] = useState(FILES[0]);
  const [dialog, setDialog] = useState<Suspicion | null>(null);
  const { lines, add } = useLog(12);

  const party = PARTIES[partyKey];
  const host = extractHost(link);
  const ours = host ? findSuspicious(host, party) : null;
  const old = host ? findSuspicious2020(host, party) : null;
  const clean = cleanFilename(file);

  function open() {
    if (ours) setDialog(ours);
    else add(`Mở ${link} (không có ký tự lạ)`, 'ok');
  }

  return (
    <div className='page wa-homo'>
      <h1>Link giả dạng và tên file giả đuôi</h1>
      <p className='hint'>
        Chọn một link rồi bấm vào nó trong bong bóng chat. Ký tự đáng ngờ được tô màu; link đáng ngờ phải qua hộp thoại
        cảnh báo. Kết quả phụ thuộc mã vùng điện thoại và ngôn ngữ của hai bên.
      </p>
      <div className='toolbar'>
        {LINKS.map(([label, url]) => (
          <button key={url} className={link === url ? 'primary' : ''} onClick={() => setLink(url)}>
            {label}
          </button>
        ))}
      </div>
      <div className='toolbar'>
        <input type='text' data-testid='link' value={link} onChange={(e) => setLink(e.target.value)} aria-label='Link' />
        <select value={partyKey} onChange={(e) => setPartyKey(e.target.value)} aria-label='Ngữ cảnh'>
          {Object.keys(PARTIES).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </div>
      <div className='wa-homo-bubble'>
        <button className='wa-homo-link' data-testid='bubble-link' onClick={open}>
          <Highlight text={link} chars={ours?.chars} />
        </button>
        <small>Host gửi lên mạng: {host ? asciiHost(host) : '—'}</small>
      </div>
      <div className='wa-homo-grid'>
        <div className={`card ${ours ? 'bad' : 'good'}`} data-testid='ours'>
          <b>Bản viết lại</b>
          <span>{ours ? `Cảnh báo: ${REASONS[ours.reason]} (${[...ours.chars].join(' ')})` : 'Không cảnh báo'}</span>
        </div>
        <div className={`card ${old ? 'bad' : 'good'}`} data-testid='old'>
          <b>Logic bản 2020</b>
          <span>{old ? `Cảnh báo: ${REASONS[old.reason]} (${[...old.chars].join(' ')})` : 'Không cảnh báo'}</span>
        </div>
      </div>

      <h2>Tên file nhận được</h2>
      <div className='toolbar'>
        {FILES.map((f) => (
          <button key={f} className={file === f ? 'primary' : ''} onClick={() => setFile(f)}>
            {escapeControls(f).slice(0, 18)}
          </button>
        ))}
      </div>
      <div className='wa-homo-grid'>
        <div className='card'>
          <b>Hiện thẳng tên gốc</b>
          <span className='wa-homo-file' data-testid='raw-file'>
            📄 {file}
          </span>
          <code>{escapeControls(file)}</code>
        </div>
        <div className={`card ${clean.dangerous ? 'bad' : 'good'}`}>
          <b>Sau cleanFilename</b>
          <span className='wa-homo-file' data-testid='clean-file'>
            📄 {clean.name}
          </span>
          <span>
            Đuôi thật: <code>.{clean.extension || '(không có)'}</code>{' '}
            {clean.dangerous && <span className='badge err'>file chạy được</span>}
          </span>
        </div>
      </div>
      <Log lines={lines} />

      {dialog && (
        <div className='backdrop' onClick={() => setDialog(null)}>
          <div className='dialog' role='dialog' aria-label='Cảnh báo link' onClick={(e) => e.stopPropagation()}>
            <h2>Link này có ký tự lạ</h2>
            <p>
              <span className='wa-homo-link big'>
                <Highlight text={host ?? link} chars={dialog.chars} />
              </span>
            </p>
            <p className='muted'>
              Các ký tự tô màu ({REASONS[dialog.reason]}) có thể đang giả dạng chữ khác. Trình duyệt sẽ đi tới{' '}
              <code>{host ? asciiHost(host) : ''}</code>.
            </p>
            <div className='toolbar'>
              <button
                onClick={() => {
                  setDialog(null);
                  add(`Huỷ mở ${host}`, 'warn');
                }}
              >
                Quay lại
              </button>
              <button
                className='primary'
                onClick={() => {
                  setDialog(null);
                  add(`Vẫn mở ${host} (demo không điều hướng)`, 'err');
                }}
              >
                Vẫn mở
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
