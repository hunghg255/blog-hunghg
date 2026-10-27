import { useMemo, useState } from 'react';
import { Log, Stat, sleep, useLog } from './shared';
import { createPrefixAutocomplete, createThreadStore, type Suggestion, type Thread } from '../lib/udMessaging';
import { createUdemyStyleSlack, createUdemyStyleThread, type UdMessage } from './UdMessagingUdemyStyle';
import './UdMessagingDemo.css';

// ---------------------------------------------------------------- 1. trả lời lạc quan

// server giả: mỗi tin có độ trễ riêng, tin "B" bị lỗi
const PLAN: Record<string, { ms: number; fail: boolean }> = {
  A: { ms: 600, fail: false },
  B: { ms: 300, fail: true },
  C: { ms: 900, fail: false },
};

const INITIAL = [
  { id: 101, content: 'Chào thầy, em không xem được bài 12' },
  { id: 102, content: 'Em thử tải lại trang chưa?' },
  { id: 103, content: 'Dạ rồi ạ' },
];

function ReplySection() {
  const [run, setRun] = useState(0);
  const [, force] = useState(0);
  const [serverSaved, setServerSaved] = useState<string[]>([]);
  const log = useLog(6);

  const stores = useMemo(() => {
    const saved: string[] = [];
    let nextId = 200;
    // mỗi bản có "server" riêng; B lỗi ở lần gửi ĐẦU, gửi lại thì được
    const makePost = () => {
      const attempts: Record<string, number> = {};
      return async (content: string) => {
        const p = PLAN[content];
        attempts[content] = (attempts[content] ?? 0) + 1;
        await sleep(p.ms);
        if (p.fail && attempts[content] === 1) throw new Error('500');
        saved.push(content);
        setServerSaved([...saved]);
        return { id: ++nextId };
      };
    };
    const rerender = () => force((n) => n + 1);
    const udemy = createUdemyStyleThread(
      INITIAL.map((m) => ({ ...m, temp: false })),
      makePost(),
      rerender,
    );
    const thread: Thread = {
      id: 't1',
      muted: true,
      messages: INITIAL.map((m) => ({ id: String(m.id), content: m.content, outgoing: false, status: 'sent' })),
    };
    const rewritePost = makePost();
    const rewrite = createThreadStore(thread, async (c) => ({ id: String((await rewritePost(c)).id) }), rerender);
    return { udemy, rewrite };
  }, [run]);

  const sendAll = async () => {
    setServerSaved([]);
    log.add('Gửi A, B, C liên tiếp (B sẽ lỗi, C về sau cùng)');
    // hai bản dùng chung một "server" nên mỗi tin được lưu hai lần; chỉ quan tâm thứ tự hiển thị
    await Promise.all(['A', 'B', 'C'].map((c) => Promise.all([stores.udemy.reply(c), stores.rewrite.reply(c)])));
    const u = stores.udemy.thread.messages.map((m) => m.content).slice(INITIAL.length);
    const r = stores.rewrite.thread.messages.map((m) => `${m.content}${m.status === 'failed' ? '(lỗi)' : ''}`).slice(INITIAL.length);
    log.add(`Kiểu Udemy hiển thị: ${u.join(', ')}`, u.join() === 'A,C' ? 'ok' : 'err');
    log.add(`Viết lại hiển thị: ${r.join(', ')}`, 'ok');
  };

  return (
    <section className='card ud-msg'>
      <h2>1. Gửi ba tin liên tiếp, tin giữa bị lỗi</h2>
      <p className='hint'>
        A trả sau 600ms, B lỗi sau 300ms (gửi lại thì được), C trả sau 900ms. Kiểu Udemy nhớ vị trí của tin tạm trong mảng: B lỗi thì
        bị cắt ra, C tụt lên một ô, nên lúc C thành công nó ghi vào ô cũ (đã trống) và tin tạm của C còn nằm lại.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={sendAll} data-testid='msg-send'>
          Gửi A, B, C
        </button>
        <button onClick={() => setRun((r) => r + 1)}>Đặt lại</button>
      </div>
      <div className='stats'>
        <Stat label='Server đã lưu' value={<bdi>{serverSaved.length ? [...new Set(serverSaved)].join(', ') : '—'}</bdi>} />
      </div>
      <div className='split'>
        <div>
          <h3>Kiểu Udemy</h3>
          <ul className='ud-msg-list' data-testid='msg-udemy'>
            {stores.udemy.thread.messages.map((m: UdMessage, i) => (
              <li key={`${m.id}-${i}`} className={m.temp ? 'ud-msg-temp' : ''}>
                <code>{m.id}</code> {m.content} {m.temp && <small className='muted'>đang gửi</small>}
              </li>
            ))}
          </ul>
          <p className='muted'>Tin cuối trong danh sách hội thoại: {stores.udemy.thread.lastMessage.content}</p>
        </div>
        <div>
          <h3>Viết lại</h3>
          <ul className='ud-msg-list' data-testid='msg-rewrite'>
            {stores.rewrite.thread.messages.map((m) => (
              <li key={m.id} className={`ud-msg-${m.status}`}>
                <code>{m.id}</code> {m.content}{' '}
                {m.status === 'sending' && <small className='muted'>đang gửi</small>}
                {m.status === 'failed' && (
                  <>
                    <small className='err'>gửi lỗi</small>{' '}
                    <button onClick={() => stores.rewrite.retry(m.id)}>Gửi lại</button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className='muted'>
            Tin cuối trong danh sách hội thoại: {stores.rewrite.lastMessage?.content} · tắt tiếng:{' '}
            {stores.rewrite.thread.muted ? 'có' : 'không'}
          </p>
        </div>
      </div>
      <Log lines={log.lines} />
    </section>
  );
}

// ---------------------------------------------------------------- 2. autocomplete hai tầng

const DIRECTORY: Suggestion[] = [
  { value: 'an.nguyen', kind: 'user' },
  { value: 'anh.tran', kind: 'user' },
  { value: 'bao.le', kind: 'user' },
  { value: 'binh.pham', kind: 'user' },
  { value: 'general', kind: 'channel' },
  { value: 'announcements', kind: 'channel' },
  { value: 'android-team', kind: 'channel' },
  { value: 'backend', kind: 'channel' },
  { value: 'design', kind: 'channel' },
  { value: 'dan.vo', kind: 'user' },
];

function shuffle<T>(arr: T[]) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function AutocompleteSection() {
  const [failFirst, setFailFirst] = useState(true);
  const [input, setInput] = useState('');
  const [rewrite, setRewrite] = useState<{ list: Suggestion[]; error: string }>({ list: [], error: '' });
  const [, force] = useState(0);

  const engines = useMemo(() => {
    let usersFailed = 0;
    // server trả theo thứ tự bất kỳ (như API thật), lỗi lần gọi users đầu tiên nếu bật
    const fetchUsers = async (q: string) => {
      await sleep(250);
      if (failFirst && usersFailed++ === 0) throw new Error('slack 503');
      return shuffle(DIRECTORY.filter((s) => s.kind === 'user' && s.value.includes(q)));
    };
    const fetchChannels = async (q: string) => {
      await sleep(250);
      return shuffle(DIRECTORY.filter((s) => s.kind === 'channel' && s.value.includes(q)));
    };
    let rewriteUsersFailed = 0;
    const rewriteFetch = async (prefix: string) => {
      await sleep(250);
      if (failFirst && rewriteUsersFailed++ === 0) throw new Error('slack 503');
      return shuffle(DIRECTORY.filter((s) => s.value.includes(prefix)));
    };
    return {
      udemy: createUdemyStyleSlack(fetchUsers, fetchChannels),
      rewrite: createPrefixAutocomplete({ fetchPrefix: rewriteFetch, retryAfterMs: 500 }),
    };
  }, [failFirst]);

  const onChange = async (value: string) => {
    setInput(value);
    const u = engines.udemy.onInput(value).then(() => force((n) => n + 1));
    force((n) => n + 1);
    try {
      const list = await engines.rewrite.suggest(value);
      setRewrite({ list, error: '' });
    } catch (err) {
      setRewrite({ list: [], error: String((err as Error).message) });
    }
    await u;
  };

  const uv = engines.udemy.view();
  return (
    <section className='card ud-msg'>
      <h2>2. Autocomplete người và kênh Slack</h2>
      <p className='hint'>
        Gõ <code>a</code>, chờ một chút, rồi gõ tiếp <code>an</code>, <code>@an</code>, <code>#an</code>. Lần gọi đầu
        bị lỗi: kiểu Udemy không gọi API nữa cho tới khi xoá trắng ô nhập; bản viết lại thử lại ở lần gõ sau.
      </p>
      <div className='toolbar'>
        <input
          type='text'
          value={input}
          onChange={(e) => void onChange(e.target.value)}
          placeholder='@người hoặc #kênh'
          aria-label='Chia sẻ tới'
          data-testid='ac-input'
        />
        <label className='switch'>
          <input type='checkbox' checked={failFirst} onChange={(e) => setFailFirst(e.target.checked)} /> Lần gọi đầu bị lỗi
        </label>
      </div>
      <div className='stats'>
        <Stat label='API gọi (Udemy)' value={<bdi data-testid='ac-udemy-calls'>{uv.calls}</bdi>} />
        <Stat label='API gọi (viết lại)' value={<bdi data-testid='ac-rewrite-calls'>{engines.rewrite.stats().calls}</bdi>} />
      </div>
      <div className='split'>
        <div>
          <h3>Kiểu Udemy</h3>
          {uv.message && <p className='err'>{uv.message}</p>}
          <ul className='ud-msg-list' data-testid='ac-udemy'>
            {uv.suggestions.map((s) => (
              <li key={s.value}>{s.kind === 'channel' ? '#' : '@'}{s.value}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Viết lại</h3>
          {rewrite.error && <p className='err'>{rewrite.error}</p>}
          <ul className='ud-msg-list' data-testid='ac-rewrite'>
            {rewrite.list.map((s) => (
              <li key={s.value}>{s.kind === 'channel' ? '#' : '@'}{s.value}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default function UdMessagingDemo() {
  return (
    <div className='page'>
      <h1>Trả lời lạc quan có rollback, autocomplete hai tầng</h1>
      <ReplySection />
      <AutocompleteSection />
    </div>
  );
}
