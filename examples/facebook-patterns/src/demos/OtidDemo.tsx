import { useMemo, useRef, useState } from 'react';
import { compareOtid, generateOtid, generateOtidFbStyle, otidTime, OTID_TIME_LIMIT } from '../lib/otid';
import { Stat, sleep } from './shared';
import './OtidDemo.css';

interface Msg {
  otid: string;
  text: string;
  status: 'sending' | 'sent';
  serverId?: string;
  sentAt: number;
}

const WORDS = ['Chào', 'Mai đi cafe?', 'Ok 👍', 'Gửi file nhé', 'Đang họp', 'Tí gọi lại', 'Haha', 'Chuẩn'];

export default function OtidDemo() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [echoLog, setEchoLog] = useState<string[]>([]);
  const [sorted, setSorted] = useState(true);
  const serverSeq = useRef(1000);
  const [sample, setSample] = useState(() => generateOtid());

  async function sendBurst() {
    const batch: Msg[] = [];
    for (let i = 0; i < 5; i++) {
      // vài tin sinh cách nhau 1–3ms, giống người gõ nhanh hoặc gửi kèm nhiều ảnh
      await sleep(1 + i);
      batch.push({
        otid: generateOtid(),
        text: WORDS[Math.floor(Math.random() * WORDS.length)],
        status: 'sending',
        sentAt: Date.now(),
      });
    }
    setMessages((prev) => [...prev, ...batch]);
    // server xử lý và dội về theo thứ tự ngẫu nhiên, kèm lại OTID
    batch.forEach((msg) => {
      const delay = 150 + Math.random() * 900;
      setTimeout(() => {
        const serverId = `mid.$${(serverSeq.current++).toString(36)}`;
        setEchoLog((log) => [`dội về ${serverId} ← otid …${msg.otid.slice(-6)}`, ...log].slice(0, 12));
        setMessages((prev) => prev.map((m) => (m.otid === msg.otid ? { ...m, status: 'sent', serverId } : m)));
      }, delay);
    });
  }

  const shown = useMemo(
    () => (sorted ? [...messages].sort((a, b) => compareOtid(a.otid, b.otid)) : messages),
    [messages, sorted],
  );

  const parity = useMemo(() => {
    let same = 0;
    for (let i = 0; i < 500; i++) {
      const now = 1_600_000_000_000 + Math.floor(Math.random() * 5e11);
      const random = Math.floor(Math.random() * 2 ** 22);
      if (generateOtid({ now, random }) === generateOtidFbStyle(now, random)) same++;
    }
    return same;
  }, []);

  const bits = BigInt(sample).toString(2).padStart(63, '0');
  const before = generateOtidFbStyle(OTID_TIME_LIMIT - 1000, 7);
  const after = generateOtidFbStyle(OTID_TIME_LIMIT + 1000, 7);
  const limitDate = new Date(OTID_TIME_LIMIT).toISOString().replace('.000Z', ' UTC').replace('T', ' ');
  const sentCount = messages.filter((m) => m.status === 'sent').length;

  return (
    <div className='page otid-demo'>
      <h1>OTID: ID tin nhắn sinh ở client</h1>
      <p className='hint'>
        Bấm gửi là tin có ngay một ID 63 bit: 41 bit thời gian, 22 bit ngẫu nhiên. Server dội tin về theo thứ tự bất kỳ,
        kèm lại OTID; client dùng nó để biến tin &quot;đang gửi&quot; thành &quot;đã gửi&quot;.
      </p>

      <section className='card'>
        <h2>Cấu trúc một OTID</h2>
        <p className='otid-number'>
          <bdi data-testid='sample'>{sample}</bdi>
        </p>
        <p className='otid-bits' aria-label='63 bit của OTID'>
          <span className='time-bits'>{bits.slice(0, 41)}</span>
          <span className='rand-bits'>{bits.slice(41)}</span>
        </p>
        <p className='muted'>
          41 bit thời gian → <bdi data-testid='decoded'>{new Date(otidTime(sample)).toISOString()}</bdi> · 22 bit ngẫu nhiên
        </p>
        <div className='toolbar'>
          <button onClick={() => setSample(generateOtid())}>Sinh OTID khác</button>
        </div>
      </section>

      <section className='card'>
        <h2>Gửi tin, ghép bản server dội về</h2>
        <div className='toolbar'>
          <button className='primary' onClick={sendBurst}>
            Gửi 5 tin liên tiếp
          </button>
          <label>
            <input type='checkbox' checked={sorted} onChange={(e) => setSorted(e.target.checked)} /> sắp theo OTID
          </label>
          <button onClick={() => (setMessages([]), setEchoLog([]))}>Xoá</button>
        </div>
        <div className='stats'>
          <Stat label='tin đã gửi' value={<bdi data-testid='sent'>{`${sentCount}/${messages.length}`}</bdi>} />
        </div>
        <div className='split'>
          <ol className='otid-chat' data-testid='chat'>
            {shown.map((m) => (
              <li key={m.otid} className={m.status}>
                <span>{m.text}</span>
                <small>
                  {m.status === 'sending' ? '🕓 đang gửi' : `✓ ${m.serverId}`} · …{m.otid.slice(-6)}
                </small>
              </li>
            ))}
          </ol>
          <div className='log'>
            {echoLog.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      </section>

      <section className='card'>
        <h2>So với thuật toán gốc</h2>
        <p>
          Bản viết lại dùng <code>BigInt</code>; bản gốc ghép chuỗi nhị phân rồi chia dài thủ công. Khớp{' '}
          <b data-testid='parity'>{parity}/500</b> mẫu ngẫu nhiên.
        </p>
        <p>
          Từ <b>{limitDate}</b>, <code>Date.now()</code> cần 42 bit. Bản gốc cắt lấy 63 bit cuối nên ID quay vòng:
        </p>
        <ul className='wrap-list'>
          <li>
            1 giây trước mốc: <bdi data-testid='before'>{before}</bdi>
          </li>
          <li>
            1 giây sau mốc: <bdi data-testid='after'>{after}</bdi> {BigInt(after) < BigInt(before) ? '← nhỏ hơn, sai thứ tự' : ''}
          </li>
        </ul>
        <p className='muted'>Bản viết lại ném RangeError ở mốc này thay vì âm thầm sinh ID sai thứ tự.</p>
      </section>
    </div>
  );
}
