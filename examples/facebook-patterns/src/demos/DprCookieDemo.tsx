import { useEffect, useState } from 'react';
import {
  containsSdesKey,
  FB_SDES_PATTERN,
  formatDpr,
  redactSecrets,
  syncDprCookie,
} from '../lib/dprCookie';
import { Log, Stat, useLog } from './shared';
import './DprCookieDemo.css';

function randomKey(bytes: number, endWithSlash = false) {
  for (;;) {
    const raw = crypto.getRandomValues(new Uint8Array(bytes));
    const b64 = btoa(String.fromCharCode(...raw));
    if (!endWithSlash || /[+/]$/.test(b64)) return b64;
  }
}

const sdpLog = (key: string, suite = 'AES_CM_128_HMAC_SHA1_80') =>
  JSON.stringify(
    {
      event: 'call_setup',
      peer: 'user:42',
      sdp: `v=0\r\nm=audio 9 RTP/SAVPF 111\r\na=crypto:1 ${suite} inline:${key}|2^31|1:1\r\n`,
    },
    null,
    2,
  );

const pickImage = (dpr: number) =>
  dpr <= 1 ? 'photo.jpg (1x)' : dpr <= 2 ? 'photo@2x.jpg' : 'photo@3x.jpg';

export default function DprCookieDemo() {
  const { lines, add } = useLog();
  const [realDpr, setRealDpr] = useState(() => window.devicePixelRatio || 1);
  const [cookie, setCookie] = useState<string | null>(null);
  const [eventTest, setEventTest] = useState('—');

  useEffect(() => {
    // Cookie thật của trang demo: ghi ngay, cập nhật khi zoom hoặc đổi màn hình
    return syncDprCookie({
      name: 'demo_dpr',
      setCookie: (name, value) => {
        document.cookie =
          value == null
            ? `${name}=; path=/; max-age=0`
            : `${name}=${value}; path=/; max-age=600; samesite=lax`;
        setCookie(value);
      },
      onChange: (dpr) => {
        setRealDpr(dpr);
        add(`DPR đổi thành ${dpr} (zoom hoặc đổi màn hình) → cập nhật cookie ngay`, 'ok');
      },
    });
  }, [add]);

  const testEventName = () => {
    const target = new EventTarget();
    let wrong = 0;
    let right = 0;
    target.addEventListener('pageHide', () => wrong++); // như CometPixelRatioUpdater
    target.addEventListener('pagehide', () => right++);
    target.dispatchEvent(new Event('pagehide'));
    setEventTest(`'pageHide': ${wrong} lần · 'pagehide': ${right} lần`);
    add(
      `Phát sự kiện pagehide: listener 'pageHide' chạy ${wrong} lần, 'pagehide' chạy ${right} lần`,
      wrong ? 'ok' : 'warn',
    );
  };

  return (
    <div className='page dpr-demo'>
      <h1>DPR vào cookie, che khoá SDES trong log</h1>
      <p className='hint'>
        Phần 1: thử zoom trình duyệt (Ctrl/⌘ + hoặc −): <code>devicePixelRatio</code> đổi theo,
        cookie được ghi lại ngay. Server đọc cookie ở lượt tải sau để nhúng sẵn ảnh đúng độ phân
        giải.
      </p>
      <div className='stats'>
        <Stat label='devicePixelRatio' value={<output data-testid='dpr'>{realDpr}</output>} />
        <Stat
          label='cookie demo_dpr'
          value={<output data-testid='dpr-cookie'>{cookie ?? '(không có, DPR = 1)'}</output>}
        />
        <Stat label='server sẽ chọn' value={<output>{pickImage(realDpr)}</output>} />
      </div>
      <div className='dpr-scale'>
        {[1, 1.25, 1.5, 2, 2.625, 3].map((d) => (
          <div key={d} className={`card dpr-chip ${Math.abs(d - realDpr) < 0.01 ? 'on' : ''}`}>
            <b>{d}</b>
            <span>cookie: {formatDpr(d) ?? 'xoá'}</span>
            <span>{pickImage(d)}</span>
          </div>
        ))}
      </div>
      <div className='toolbar'>
        <button onClick={testEventName} data-testid='event-test'>
          Thử tên sự kiện 'pageHide' vs 'pagehide'
        </button>
        <output data-testid='event-result'>{eventTest}</output>
      </div>
      <SdesSection onLog={add} />
      <Log lines={lines} />
    </div>
  );
}

function SdesSection({ onLog }: { onLog: (t: string, tone?: 'ok' | 'warn' | 'err') => void }) {
  const [text, setText] = useState(() => sdpLog(randomKey(30)));
  const [rates, setRates] = useState('—');
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* để nguyên chuỗi */
  }
  const fb = FB_SDES_PATTERN.test(JSON.stringify(parsed));
  const ours = containsSdesKey(JSON.stringify(parsed));
  const redacted = redactSecrets(parsed);

  const sample = () => {
    let fbMiss128 = 0;
    let fbMiss256 = 0;
    let ourMiss = 0;
    const n = 1000;
    for (let i = 0; i < n; i++) {
      const a = JSON.stringify(sdpLog(randomKey(30)));
      const b = JSON.stringify(sdpLog(randomKey(46), 'AES_256_CM_HMAC_SHA1_80'));
      if (!FB_SDES_PATTERN.test(a)) fbMiss128++;
      if (!FB_SDES_PATTERN.test(b)) fbMiss256++;
      if (!containsSdesKey(a)) ourMiss++;
      if (!containsSdesKey(b)) ourMiss++;
    }
    const text = `FB lọt: ${fbMiss128}/${n} khoá AES-128, ${fbMiss256}/${n} khoá AES-256 · bản viết lại lọt ${ourMiss}/${2 * n}`;
    setRates(text);
    onLog(text, fbMiss256 ? 'warn' : 'ok');
  };

  return (
    <>
      <p className='hint'>
        Phần 2: log có SDP của cuộc gọi. Dòng <code>a=crypto … inline:</code> chứa khoá giải mã âm
        thanh. Regex của Facebook chỉ nhận đúng 40 ký tự theo sau là ranh giới từ.
      </p>
      <div className='toolbar'>
        <button onClick={() => setText(sdpLog(randomKey(30)))}>Khoá AES-128 (40 ký tự)</button>
        <button onClick={() => setText(sdpLog(randomKey(30, true)))} data-testid='key-slash'>
          Khoá kết thúc bằng + hoặc /
        </button>
        <button
          onClick={() => setText(sdpLog(randomKey(46), 'AES_256_CM_HMAC_SHA1_80'))}
          data-testid='key-256'
        >
          Khoá AES-256 (64 ký tự)
        </button>
        <button className='primary' onClick={sample} data-testid='sample'>
          Thử 1000 khoá ngẫu nhiên
        </button>
      </div>
      <textarea
        className='dpr-text'
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={7}
        spellCheck={false}
      />
      <div className='stats'>
        <Stat
          label='regex Facebook'
          value={<output data-testid='fb-detect'>{fb ? 'phát hiện' : 'LỌT'}</output>}
        />
        <Stat
          label='bản viết lại'
          value={<output data-testid='our-detect'>{ours ? 'phát hiện' : 'không có khoá'}</output>}
        />
        <Stat label='thử ngẫu nhiên' value={<output data-testid='rates'>{rates}</output>} />
      </div>
      <pre className='dpr-out' data-testid='redacted'>
        {typeof redacted.value === 'string'
          ? redacted.value
          : JSON.stringify(redacted.value, null, 2)}
      </pre>
    </>
  );
}
