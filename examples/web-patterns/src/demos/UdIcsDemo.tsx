import { useMemo, useState } from 'react';
import { buildIcs, downloadIcs, icsFileName, type IcsReminder } from '../lib/udIcs';
import { checkIcs } from '../lib/udIcsCheck';
import { buildIcsUdemyStyle, fileNameUdemyStyle } from './UdIcsUdemyStyle';
import './UdIcsDemo.css';

const ZONES = ['Asia/Ho_Chi_Minh', 'America/Los_Angeles', 'Europe/Berlin', 'Australia/Sydney', 'America/Santiago'];

export default function UdIcsDemo() {
  const [title, setTitle] = useState('Học tiếng Nhật, mỗi tối; bài 3 – Đọc hiểu');
  const [zone, setZone] = useState('Asia/Ho_Chi_Minh');
  const [date, setDate] = useState('2026-11-02');
  const [time, setTime] = useState('20:00');
  const [repeat, setRepeat] = useState<'NONE' | 'DAILY' | 'WEEKLY'>('DAILY');
  const [until, setUntil] = useState('2027-06-30');
  const [sequence, setSequence] = useState(0);
  const [cancelled, setCancelled] = useState(false);

  const reminder: IcsReminder = useMemo(() => {
    const [y, mo, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    const [uy, umo, ud] = until.split('-').map(Number);
    return {
      uid: 'nhac-hoc-42@blog.hunghg.me',
      title,
      description: 'Mở bài học tiếp theo',
      url: 'https://blog.hunghg.me/series/udemy',
      timeZone: zone,
      start: { year: y, month: mo, day: d, hour: h, minute: mi },
      durationMinutes: 30,
      repeat: repeat === 'NONE' ? undefined : { freq: repeat, byDay: repeat === 'WEEKLY' ? ['MO', 'WE', 'FR'] : undefined, until: until ? { year: uy, month: umo, day: ud } : undefined },
      alarmMinutesBefore: 10,
      sequence,
      cancelled,
    };
  }, [title, zone, date, time, repeat, until, sequence, cancelled]);

  const ours = useMemo(() => buildIcs(reminder), [reminder]);
  const theirs = useMemo(() => buildIcsUdemyStyle(reminder), [reminder]);

  return (
    <div className='page ud-ics'>
      <h1>File .ics có VTIMEZONE</h1>
      <p className='hint'>
        Đổi múi giờ, tiêu đề (có dấu phẩy, chấm phẩy, tiếng Việt) rồi so hai file. Bên trái mô phỏng cách Udemy dựng file;
        bên phải là bản viết lại. Nút tải tạo file thật để mở bằng Lịch.
      </p>

      <div className='ud-ics-form'>
        <label>
          Tiêu đề
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Múi giờ
          <select value={zone} onChange={(e) => setZone(e.target.value)}>
            {ZONES.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
        <label>
          Ngày
          <input type='date' value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Giờ
          <input type='time' value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label>
          Lặp
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)}>
            <option value='NONE'>Một lần</option>
            <option value='DAILY'>Hằng ngày</option>
            <option value='WEEKLY'>T2, T4, T6</option>
          </select>
        </label>
        <label>
          Đến ngày
          <input type='date' value={until} onChange={(e) => setUntil(e.target.value)} disabled={repeat === 'NONE'} />
        </label>
      </div>
      <div className='toolbar'>
        <button
          onClick={() => {
            setSequence((s) => s + 1);
            setCancelled(false);
          }}
        >
          Cập nhật (SEQUENCE+1)
        </button>
        <button
          onClick={() => {
            setSequence((s) => s + 1);
            setCancelled(true);
          }}
        >
          Huỷ nhắc lịch
        </button>
        <span className='muted'>
          SEQUENCE: {sequence}
          {cancelled ? ' · đã huỷ' : ''}
        </span>
      </div>

      <div className='split'>
        <Column
          label='Kiểu Udemy (mô phỏng)'
          text={theirs}
          fileName={fileNameUdemyStyle(title)}
          testId='udemy'
        />
        <Column label='Bản viết lại' text={ours} fileName={icsFileName(title)} testId='ours' />
      </div>
    </div>
  );
}

function Column({ label, text, fileName, testId }: { label: string; text: string; fileName: string; testId: string }) {
  const issues = checkIcs(text);
  return (
    <div className='card ud-ics-col' data-testid={`col-${testId}`}>
      <h2>{label}</h2>
      <p>
        Tên file: <code data-testid={`file-${testId}`}>{fileName}</code>
      </p>
      {issues.length === 0 ? (
        <p className='ok' data-testid={`issues-${testId}`}>
          Không thấy lỗi nào trong các luật được kiểm.
        </p>
      ) : (
        <ul className='ud-ics-issues' data-testid={`issues-${testId}`}>
          {issues.map((i, k) => (
            <li key={k} className='err'>
              <b>{i.rule}</b>: {i.detail}
            </li>
          ))}
        </ul>
      )}
      <button onClick={() => downloadIcs(text, fileName)}>Tải {fileName}</button>
      <pre className='ud-ics-pre'>{text.replace(/\r\n/g, '␍\n')}</pre>
    </div>
  );
}
