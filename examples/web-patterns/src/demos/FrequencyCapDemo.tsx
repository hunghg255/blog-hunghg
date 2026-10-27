import { useMemo, useState } from 'react';
import {
  createActivityTracker,
  createDailyCap,
  createGovernor,
  DAY,
  isNominated,
  type KeyValueStorage,
} from '../lib/frequencyCap';
import { Log, Stat, useLog } from './shared';

// localStorage có thể bị chặn (iframe sandbox, chế độ riêng tư): rơi về bộ nhớ tạm
function demoStorage(): KeyValueStorage {
  const memory = new Map<string, string>();
  return {
    getItem(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        memory.set(key, value);
      }
    },
  };
}

const ACTIVITIES = [
  { name: 'send', count: 3, label: 'Gửi email' },
  { name: 'calendar', count: 1, label: 'Mở Lịch' },
];

export default function FrequencyCapDemo() {
  const storage = useMemo(demoStorage, []);
  const [offsetDays, setOffsetDays] = useState(0);
  const [userId, setUserId] = useState('user-7');
  const [percent, setPercent] = useState(50);
  const [, rerender] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [naive, setNaive] = useState({ survey: 0, tip: 0 });
  const [shown, setShown] = useState({ survey: 0, tip: 0 });
  const { lines, add } = useLog();

  const tracker = useMemo(() => createActivityTracker(ACTIVITIES), []);
  const governor = useMemo(
    () => createGovernor(storage, { survey: 14 * DAY }, 'fc-demo-governor'),
    [storage],
  );
  const tipCap = useMemo(
    () => createDailyCap(storage, 'fc-demo-tips', { maxDays: 3, windowDays: 7 }),
    [storage],
  );

  const now = Date.now() + offsetDays * DAY;
  const nominated = isNominated(userId, 'nps-2026', percent);
  const surveyOpensAt = governor.opensAt('survey');

  const doActivity = (name: string, label: string) => {
    const result = tracker.increment(name);
    add(`${label}: ${result}`, result === 'pending' ? 'muted' : undefined);
    if (result !== 'all-activated') return rerender((x) => x + 1);

    setNaive((n) => ({ ...n, survey: n.survey + 1 }));
    tracker.reset(); // đủ điều kiện rồi: đếm lại cho lần sau
    if (!nominated) {
      add(`✗ ${userId} không nằm trong ${percent}% được chọn`, 'warn');
    } else if (!governor.isOpen('survey', now)) {
      add(
        `✗ Kênh khảo sát đang nghỉ tới ${new Date(surveyOpensAt!).toLocaleDateString('vi-VN')}`,
        'warn',
      );
    } else {
      governor.startCooldown('survey', now);
      setShown((s) => ({ ...s, survey: s.survey + 1 }));
      setToast('📋 Bạn có muốn giới thiệu Outlook cho đồng nghiệp? (khảo sát NPS)');
      add('✓ Hiện khảo sát, kênh nghỉ 14 ngày', 'ok');
    }
  };

  const openApp = () => {
    setNaive((n) => ({ ...n, tip: n.tip + 1 }));
    if (tipCap.canShow(now)) {
      tipCap.record(now);
      setShown((s) => ({ ...s, tip: s.tip + 1 }));
      setToast('💡 Mẹo: kéo email vào Lịch để tạo cuộc hẹn');
      add(`✓ Hiện tip (${tipCap.daysUsed(now)}/3 ngày trong 7 ngày)`, 'ok');
    } else {
      add(
        tipCap.describe(now).startsWith('■')
          ? '✗ Tip: hôm nay đã hiện rồi'
          : '✗ Tip: đã đủ 3 ngày trong 7 ngày gần nhất',
        'warn',
      );
    }
    rerender((x) => x + 1);
  };

  const travel = (days: number) => {
    setOffsetDays((d) => d + days);
    add(`⏩ Tua ${days} ngày`, 'muted');
  };

  const reset = () => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('fc-demo-'))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* bộ nhớ tạm: tải lại trang để xoá */
    }
    tracker.reset();
    setOffsetDays(0);
    setNaive({ survey: 0, tip: 0 });
    setShown({ survey: 0, tip: 0 });
    setToast(null);
    add('Đã xoá trạng thái', 'muted');
  };

  const flags = tracker.getFlags();
  const counts = tracker.getCounts();

  return (
    <div className='page'>
      <h1>Giới hạn tần suất kiểu Floodgate</h1>
      <p className='hint'>
        Khảo sát chỉ hiện khi người dùng đã gửi 3 email VÀ mở Lịch, thuộc nhóm được chọn, và kênh
        khảo sát không đang nghỉ. Tip hiện mỗi ngày tối đa một lần, tối đa 3 ngày trong 7 ngày. Tua
        thời gian để xem giới hạn mở lại.
      </p>
      <div className='toolbar'>
        <span className='badge'>Hôm nay: {new Date(now).toLocaleDateString('vi-VN')}</span>
        <button onClick={() => travel(1)}>+1 ngày</button>
        <button onClick={() => travel(7)}>+7 ngày</button>
        <button onClick={reset}>Đặt lại</button>
      </div>

      <div className='split'>
        <div>
          <div className='card' style={{ marginBottom: 12 }}>
            <b>1. Khảo sát: ActivityTracker + Governor + chọn {percent}%</b>
            <div className='toolbar' style={{ marginTop: 8 }}>
              {ACTIVITIES.map((a) => (
                <button
                  key={a.name}
                  className='primary'
                  onClick={() => doActivity(a.name, a.label)}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <div className='toolbar'>
              <label className='switch'>
                userId
                <input
                  type='text'
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  style={{ width: 120 }}
                />
              </label>
              <label className='switch'>
                tỉ lệ chọn
                <input
                  type='range'
                  min={0}
                  max={100}
                  value={percent}
                  onChange={(e) => setPercent(+e.target.value)}
                />
                {percent}%
              </label>
              <span className={nominated ? 'ok' : 'warn'}>
                {nominated ? 'được chọn' : 'không được chọn'}
              </span>
            </div>
            <code>
              flags = 0b{flags.toString(2).padStart(ACTIVITIES.length, '0')} / mask = 0b
              {'1'.repeat(ACTIVITIES.length)} · đếm:{' '}
              {ACTIVITIES.map((a, i) => `${a.name} ${counts[i]}/${a.count}`).join(', ')}
            </code>
            <p className='muted' style={{ margin: '6px 0 0' }}>
              Kênh khảo sát:{' '}
              {governor.isOpen('survey', now)
                ? 'đang mở'
                : `nghỉ tới ${new Date(surveyOpensAt!).toLocaleDateString('vi-VN')}`}
            </p>
          </div>

          <div className='card'>
            <b>2. Tip mỗi ngày: bitmask theo ngày</b>
            <div className='toolbar' style={{ marginTop: 8 }}>
              <button className='primary' onClick={openApp}>
                Mở hộp thư
              </button>
              <code style={{ fontSize: 18, letterSpacing: 2 }}>{tipCap.describe(now)}</code>
            </div>
            <p className='muted' style={{ margin: 0 }}>
              Ô đầu là hôm nay, mỗi ô là một ngày (■ = có hiện tip). Mỗi ngày tối đa một lần, tối đa
              3 ngày trong 7 ngày.
            </p>
          </div>
        </div>

        <div className='sticky'>
          <div className='stats'>
            <Stat
              label='khảo sát: ngây thơ / có giới hạn'
              value={`${naive.survey} / ${shown.survey}`}
            />
            <Stat label='tip: ngây thơ / có giới hạn' value={`${naive.tip} / ${shown.tip}`} />
          </div>
          {toast && (
            <div className='card active' style={{ margin: '12px 0' }}>
              {toast}{' '}
              <button onClick={() => setToast(null)} aria-label='Đóng'>
                ✕
              </button>
            </div>
          )}
          <Log lines={lines} />
        </div>
      </div>
    </div>
  );
}
