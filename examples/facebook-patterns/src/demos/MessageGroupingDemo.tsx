import { useMemo, useState } from 'react';
import {
  bubblePosition,
  groupMessages,
  seenHeads,
  type ChatItem,
  type ChatMessage,
  type Reader,
} from '../lib/messageGroups';
import { Stat } from './shared';
import './MessageGroupingDemo.css';

const T0 = new Date(2026, 9, 27, 22, 0).getTime();
const min = (m: number) => T0 + m * 60_000;
const ME = 'me';
const PEOPLE: Record<string, { name: string; color: string }> = {
  me: { name: 'Bạn', color: '#0084ff' },
  an: { name: 'An', color: '#e4598a' },
  binh: { name: 'Bình', color: '#2ea86b' },
  sys: { name: 'Hệ thống', color: '#888' },
};

const LONG =
  'Mình tóm tắt lại cho cả nhà nhé: sáng mai 7 giờ tập trung ở cổng công viên, mỗi người mang một chai nước và áo khoác mỏng vì trên đồi gió lạnh. Ai đi xe máy thì gửi xe ở bãi phía đông, gần quán bún. Nếu trời mưa thì chuyển sang quán cà phê đầu ngõ, mình sẽ nhắn lại trước 6 giờ sáng. Nhớ ngủ sớm!';

const BASE: ChatMessage[] = [
  { id: 'm1', senderId: 'an', timestamp: min(0), text: 'Mai đi dạo công viên không cả nhà?' },
  { id: 'm2', senderId: 'an', timestamp: min(1), text: 'Thời tiết đẹp lắm' },
  { id: 'm3', senderId: 'an', timestamp: min(7), text: 'Ai đi thì báo mình nhé' },
  { id: 'm4', senderId: 'binh', timestamp: min(8), text: 'Đi chứ, mấy giờ?' },
  { id: 'm5', senderId: ME, timestamp: min(9), text: 'Mình cũng đi' },
  { id: 'm6', senderId: 'an', timestamp: min(12), text: '7 giờ nhé' },
  { id: 'm7', senderId: 'an', timestamp: min(12.5), hasAttachment: true, text: '🖼 ban-do.jpg' },
  { id: 'm8', senderId: 'an', timestamp: min(13), text: 'Gặp ở cổng chính' },
  { id: 'm9', senderId: 'an', timestamp: min(115), text: 'Mọi người ngủ chưa?' },
  { id: 'm10', senderId: ME, timestamp: min(115.5), replyTo: 'm6', text: 'Ok 7 giờ' },
  { id: 'm11', senderId: ME, timestamp: min(117), text: LONG },
  { id: 'm12', senderId: ME, timestamp: min(117.5), text: 'Ngủ ngon' },
  { id: 'm13', senderId: 'an', timestamp: min(125), forwarded: true, text: 'Dự báo: mai nắng nhẹ, 24°C' },
  { id: 'm14', senderId: 'an', timestamp: min(126), text: 'Chuẩn luôn' },
  { id: 'm15', senderId: 'sys', timestamp: min(127), admin: true, text: 'An đã đổi tên nhóm thành "Dạo sáng"' },
];

const fmtTime = (t: number) =>
  new Date(t).toLocaleString('vi-VN', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export default function MessageGroupingDemo() {
  const [extra, setExtra] = useState<ChatMessage[]>([]);
  const [gapMin, setGapMin] = useState(5);
  const [binhRead, setBinhRead] = useState(8); // index tin cuối Bình đã đọc
  const [viewerRead, setViewerRead] = useState(12);
  const [newDay, setNewDay] = useState(false);
  const [naive, setNaive] = useState(false);

  const messages = useMemo(() => [...BASE, ...extra], [extra]);
  const at = (i: number) => (i < 0 ? -Infinity : messages[Math.min(i, messages.length - 1)].timestamp);

  const readers: Reader[] = [
    { id: 'an', name: 'An', readWatermark: at(11) },
    { id: 'binh', name: 'Bình', readWatermark: at(binhRead) },
  ];

  const items: ChatItem[] = naive
    ? messages.map((m) =>
        m.admin ? { kind: 'admin', message: m } : { kind: 'group', senderId: m.senderId, messages: [m] },
      )
    : groupMessages(messages, {
        groupGapMs: gapMin * 60_000,
        viewerReadAt: at(viewerRead),
        breakOnNewDay: newDay,
      });
  const heads = seenHeads(messages, readers, ME);

  const groups = items.filter((i) => i.kind === 'group');
  const avatars = groups.filter((g) => g.kind === 'group' && g.senderId !== ME).length;
  const times = items.filter((i) => i.kind === 'time').length;

  const addFromAn = () => {
    const last = messages[messages.length - 1];
    const id = `x${extra.length + 1}`;
    setExtra((x) => [
      ...x,
      { id, senderId: 'an', timestamp: last.timestamp + 30_000, text: `Tin mới #${x.length + 1}` },
    ]);
  };

  return (
    <div className='page mg-demo'>
      <h1>Gom tin nhắn thành cụm</h1>
      <p className='hint'>
        Cụm mới khi: đổi người gửi, cách tin trước quá ngưỡng, tin chuyển tiếp, tin "đứng riêng"
        (trả lời, tệp đính kèm, chữ dài hơn 280 ký tự, tin hệ thống) hoặc vạch "chưa đọc" nằm giữa.
        Cách tin trước hơn 1 giờ thì chèn vạch thời gian. Avatar "đã xem" nằm ở tin mới nhất người
        đó đã thấy.
      </p>

      <div className='mg-layout'>
        <div className='mg-controls card'>
          <label>
            Ngưỡng gom: <b>{gapMin} phút</b>
            <input
              type='range'
              min={1}
              max={15}
              value={gapMin}
              onChange={(e) => setGapMin(+e.target.value)}
              data-testid='gap'
            />
          </label>
          <label>
            Bình đã đọc tới
            <select value={binhRead} onChange={(e) => setBinhRead(+e.target.value)} data-testid='binh-read'>
              {messages.map((m, i) => (
                <option key={m.id} value={i}>
                  {i + 1}. {(m.text ?? '').slice(0, 22)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bạn đã đọc tới
            <select value={viewerRead} onChange={(e) => setViewerRead(+e.target.value)} data-testid='viewer-read'>
              {messages.map((m, i) => (
                <option key={m.id} value={i}>
                  {i + 1}. {(m.text ?? '').slice(0, 22)}
                </option>
              ))}
            </select>
          </label>
          <label className='mg-check'>
            <input type='checkbox' checked={newDay} onChange={(e) => setNewDay(e.target.checked)} />
            Thêm vạch khi sang ngày mới
          </label>
          <label className='mg-check'>
            <input
              type='checkbox'
              checked={naive}
              onChange={(e) => setNaive(e.target.checked)}
              data-testid='naive'
            />
            Cách ngây thơ: mỗi tin một bong bóng
          </label>
          <div className='toolbar'>
            <button className='primary' onClick={addFromAn} data-testid='add'>
              An gửi tin (+30 giây)
            </button>
            <button onClick={() => setExtra([])}>Xoá tin thêm</button>
          </div>
          <div className='stats'>
            <Stat label='cụm' value={<output data-testid='groups'>{groups.length}</output>} />
            <Stat label='avatar người gửi' value={<output data-testid='avatars'>{avatars}</output>} />
            <Stat label='vạch thời gian' value={<output data-testid='times'>{times}</output>} />
          </div>
        </div>

        <div className='mg-thread' data-testid='thread'>
          {items.map((item, idx) => {
            if (item.kind === 'time')
              return (
                <div key={`t${idx}`} className='mg-time'>
                  {fmtTime(item.timestamp)}
                </div>
              );
            if (item.kind === 'unread')
              return (
                <div key={`u${idx}`} className='mg-unread' data-testid='unread'>
                  Tin chưa đọc
                </div>
              );
            if (item.kind === 'admin')
              return (
                <div key={item.message.id} className='mg-admin'>
                  {item.message.text}
                  <Heads list={heads.get(item.message.id)} />
                </div>
              );
            const mine = item.senderId === ME;
            const who = PEOPLE[item.senderId];
            return (
              <div key={item.messages[0].id} className={`mg-group ${mine ? 'mine' : ''}`} data-testid='group'>
                {!mine && <div className='mg-name'>{who.name}</div>}
                {item.messages.map((m, i) => (
                  <div key={m.id} className='mg-row'>
                    {!mine && (
                      <span
                        className='mg-avatar'
                        style={{
                          background: who.color,
                          visibility: i === item.messages.length - 1 ? 'visible' : 'hidden',
                        }}
                      >
                        {who.name[0]}
                      </span>
                    )}
                    <div className='mg-col'>
                      {m.replyTo && (
                        <div className='mg-reply'>
                          ↩ {BASE.find((x) => x.id === m.replyTo)?.text}
                        </div>
                      )}
                      {m.forwarded && <div className='mg-reply'>↪ Đã chuyển tiếp</div>}
                      <div
                        className={`mg-bubble ${bubblePosition(i, item.messages.length)} ${m.hasAttachment ? 'att' : ''}`}
                        style={mine ? undefined : { borderColor: who.color }}
                      >
                        {m.text}
                      </div>
                      <Heads list={heads.get(m.id)} />
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Heads({ list }: { list?: Reader[] }) {
  if (!list?.length) return null;
  return (
    <div className='mg-heads' data-testid='seen'>
      {list.map((r) => (
        <span key={r.id} title={`${r.name} đã xem`} style={{ background: PEOPLE[r.id].color }}>
          {r.name[0]}
        </span>
      ))}
    </div>
  );
}
