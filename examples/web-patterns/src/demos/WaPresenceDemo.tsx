import { useEffect, useRef, useState } from 'react';
import {
  applyChatState,
  createComposingExpiry,
  createDisplayGate,
  createNotifyPolicy,
  squelchSeconds,
  summarizeGroup,
  type ChatState,
  type HeaderMode,
  type IncomingType,
} from '../lib/waPresence';
import { Log, Stat, useLog } from './shared';
import './WaPresenceDemo.css';

const PLACEHOLDER = 'nhấn vào đây để xem thông tin';

// ---------------------------------------------------------------------------
// 1. Dòng trạng thái ở header

function HeaderGate() {
  const [modes, setModes] = useState<Record<'wa' | 'mine', HeaderMode>>({ wa: 'placeholder', mine: 'placeholder' });
  const [text, setText] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const gates = useRef<ReturnType<typeof createDisplayGate>[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const reset = () => {
    gates.current.forEach((g) => g.close());
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => reset, []);

  const open = (delay: number | null, status: string | null) => {
    reset();
    const t0 = performance.now();
    const stamp = (s: string) => setEvents((e) => [...e, `${Math.round(performance.now() - t0)} ms  ${s}`]);
    setEvents([]);
    setText(status ?? '');
    const make = (key: 'wa' | 'mine', releaseOnData: boolean) => {
      let last: HeaderMode | null = null;
      return createDisplayGate(
        (m) => {
          setModes((prev) => ({ ...prev, [key]: m }));
          if (m !== last) stamp(`${key === 'wa' ? 'kiểu WhatsApp' : 'viết lại'}: ${m}`);
          last = m;
        },
        { releaseOnData },
      );
    };
    const wa = make('wa', false);
    const mine = make('mine', true);
    gates.current = [wa, mine];
    // dữ liệu đã có sẵn trong bộ nhớ: gọi data() trước open()
    if (delay === 0) [wa, mine].forEach((g) => g.data(status));
    [wa, mine].forEach((g) => g.open());
    if (delay) timers.current.push(setTimeout(() => (stamp('presence về'), [wa, mine].forEach((g) => g.data(status))), delay));
  };

  const show = (m: HeaderMode) => (m === 'placeholder' ? PLACEHOLDER : m === 'status' ? text : '');

  return (
    <section className='card wpr-card'>
      <h2>1. Header khi mở chat</h2>
      <p className='hint'>
        Mở chat mà chưa biết trạng thái thì hiện dòng chữ mặc định thay vì nháy "last seen…" rồi đổi sang "online". Bản gốc giữ chữ mặc định
        1,5 s nếu lúc mở chưa có dữ liệu, và chờ đủ 1,5 s kể cả khi dữ liệu về sớm.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={() => open(0, 'online')}>
          Dữ liệu có sẵn
        </button>
        <button onClick={() => open(300, 'online')}>Presence về sau 300 ms</button>
        <button onClick={() => open(1800, 'last seen hôm nay lúc 09:12')}>Về sau 1,8 s</button>
        <button onClick={() => open(null, null)}>Không bao giờ về</button>
      </div>
      <div className='wpr-heads'>
        {(['wa', 'mine'] as const).map((k) => (
          <div key={k} className='wpr-head'>
            <div className='wpr-avatar'>A</div>
            <div>
              <b>An</b>
              <small data-mode={modes[k]}>{show(modes[k]) || '\u00a0'}</small>
            </div>
            <span className='wpr-tag'>{k === 'wa' ? 'kiểu WhatsApp' : 'viết lại'}</span>
          </div>
        ))}
      </div>
      <div className='wpr-events'>{events.length ? events.map((e, i) => <div key={i}>{e}</div>) : 'Bấm một nút để mở chat.'}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. "Đang gõ" trong nhóm

const MEMBERS = ['Bình', 'Chi', 'Dũng'];
const COMPOSING_TIMEOUT = 4000; // hằng số thật nằm ở module khác, không có trong bundle; giá trị này là giả định

function GroupTyping() {
  const [states, setStates] = useState(() => new Map<string, ChatState>(MEMBERS.map((m) => [m, { type: 'unavailable', updateTime: 0 }])));
  const statesRef = useRef(states);
  const expiry = useRef<ReturnType<typeof createComposingExpiry> | null>(null);
  const { lines, add } = useLog(8);

  const commit = (id: string, next: ChatState) => {
    statesRef.current = new Map(statesRef.current).set(id, next);
    setStates(statesRef.current);
  };

  const apply = (id: string, incoming: IncomingType) => {
    const before = statesRef.current.get(id)!;
    const after = applyChatState(before, incoming, Date.now());
    commit(id, after);
    expiry.current?.touch(id, after.type);
    const ignored = incoming === 'paused' && after === before;
    add(`${id}: ${incoming} → ${after.type}${ignored ? ' (bỏ qua: không đang gõ)' : ''}`, ignored ? 'muted' : undefined);
  };

  useEffect(() => {
    expiry.current = createComposingExpiry(COMPOSING_TIMEOUT, (id) => {
      add(`${id}: ${COMPOSING_TIMEOUT / 1000} s không có tín hiệu → available`, 'warn');
      commit(id, { ...statesRef.current.get(id)!, type: 'available' });
    });
    return () => expiry.current?.dispose();
  }, [add]);

  const { typist, online } = summarizeGroup(states);
  const line = typist ? `${typist.id} ${typist.state.type === 'recording' ? 'đang ghi âm…' : 'đang gõ…'}` : online ? 'có người đang online' : 'Bình, Chi, Dũng';

  return (
    <section className='card wpr-card'>
      <h2>2. "Đang gõ" trong nhóm</h2>
      <p className='hint'>
        Nhóm chỉ hiện một người: ai gửi composing/recording gần nhất. <code>paused</code> chỉ có tác dụng khi người đó đang gõ; gói paused
        đến trễ lúc họ đã offline thì bị bỏ qua.
      </p>
      <div className='wpr-head'>
        <div className='wpr-avatar'>N</div>
        <div>
          <b>Nhóm đi Đà Lạt</b>
          <small data-mode={typist ? 'typing' : 'status'}>{line}</small>
        </div>
      </div>
      <div className='wpr-members'>
        {MEMBERS.map((m) => (
          <div key={m} className='wpr-member'>
            <b>{m}</b> <span className={`badge ${states.get(m)!.type === 'unavailable' ? '' : 'ok'}`}>{states.get(m)!.type}</span>
            <div className='toolbar'>
              <button onClick={() => apply(m, 'available')}>online</button>
              <button onClick={() => apply(m, 'composing')}>gõ</button>
              <button onClick={() => apply(m, 'recording')}>ghi âm</button>
              <button onClick={() => apply(m, 'paused')}>paused</button>
              <button onClick={() => apply(m, 'unavailable')}>offline</button>
            </div>
          </div>
        ))}
      </div>
      <Log lines={lines} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. Thông báo nhóm

type Policy = ReturnType<typeof createNotifyPolicy>;
interface Tally {
  shown: number;
  silent: number;
}

function GroupNotifications() {
  const [members, setMembers] = useState(12);
  const clock = useRef(0);
  const [now, setNow] = useState(0);
  const [tally, setTally] = useState<Record<'wa' | 'mine', Tally>>({ wa: { shown: 0, silent: 0 }, mine: { shown: 0, silent: 0 } });
  const policies = useRef<Record<'wa' | 'mine', Policy> | null>(null);
  const membersRef = useRef(members);
  membersRef.current = members;
  const { lines, add } = useLog(12);

  const makePolicies = () => {
    // số thành viên phải hỏi server (giả lập 300 ms) giống bản gốc
    const participants = () => new Promise<number>((r) => setTimeout(() => r(membersRef.current), 300));
    const common = { now: () => clock.current, participants };
    policies.current = {
      wa: createNotifyPolicy({ ...common, mentionBypassesSquelch: false, reserveSynchronously: false }),
      mine: createNotifyPolicy(common),
    };
  };
  if (!policies.current) makePolicies();
  const reset = () => {
    makePolicies();
    clock.current = 0;
    setNow(0);
    setTally({ wa: { shown: 0, silent: 0 }, mine: { shown: 0, silent: 0 } });
  };

  const send = (mentionsMe: boolean, count = 1) => {
    for (let i = 0; i < count; i++) {
      const msg = { chatId: 'g', isGroup: true, mentionsMe, senderMuted: false, chatMuted: false };
      const res = { wa: policies.current!.wa(msg), mine: policies.current!.mine(msg) };
      setTally((t) => ({
        wa: { shown: t.wa.shown + +res.wa.notify, silent: t.wa.silent + +!res.wa.notify },
        mine: { shown: t.mine.shown + +res.mine.notify, silent: t.mine.silent + +!res.mine.notify },
      }));
      const fmt = (r: { notify: boolean; reason: string }) => `${r.notify ? '🔔' : '·'} ${r.reason}`;
      add(
        `t=${clock.current / 1000}s ${mentionsMe ? '@bạn' : 'tin'}: WhatsApp ${fmt(res.wa)} | viết lại ${fmt(res.mine)}`,
        res.wa.notify !== res.mine.notify ? 'warn' : undefined,
      );
    }
  };
  const advance = (s: number) => {
    clock.current += s * 1000;
    setNow(clock.current);
  };

  return (
    <section className='card wpr-card'>
      <h2>3. Thông báo nhóm: im lâu hơn khi nhóm đông</h2>
      <p className='hint'>
        Sau mỗi thông báo nhóm, WhatsApp im <code>min(120, 30 + 5 × số thành viên)</code> giây. Đồng hồ trong demo là đồng hồ ảo, bấm "+ giây"
        để tua.
      </p>
      <div className='toolbar'>
        <label>
          Thành viên <input type='range' min={2} max={40} value={members} onChange={(e) => setMembers(+e.target.value)} /> {members} →{' '}
          <b>{squelchSeconds(members)} s</b>
        </label>
      </div>
      <div className='toolbar'>
        <button className='primary' onClick={() => send(false)}>
          Tin thường
        </button>
        <button onClick={() => send(false, 2)}>2 tin cùng lúc</button>
        <button onClick={() => send(true)}>Tin @nhắc bạn</button>
        <button onClick={() => advance(10)}>+10 s</button>
        <button onClick={() => advance(60)}>+60 s</button>
        <button onClick={reset}>Đặt lại</button>
      </div>
      <div className='stats'>
        <Stat label='đồng hồ ảo' value={`${now / 1000} s`} />
        <Stat label='WhatsApp: kêu / im' value={`${tally.wa.shown} / ${tally.wa.silent}`} />
        <Stat label='viết lại: kêu / im' value={`${tally.mine.shown} / ${tally.mine.silent}`} />
      </div>
      <Log lines={lines} />
    </section>
  );
}

export default function WaPresenceDemo() {
  return (
    <div className='page wpr-page'>
      <h1>Presence, "đang gõ" và thông báo nhóm</h1>
      <p className='hint'>Viết lại từ WhatsApp Web 2020 (module igjghefdb, bbehjhfdfe, dgjifchfde). Mọi dữ liệu là giả lập.</p>
      <HeaderGate />
      <GroupTyping />
      <GroupNotifications />
    </div>
  );
}
