import { useEffect, useRef, useState } from 'react';
import { createRum, observe, type RumSummary } from '../lib/rum';
import { getDeviceInfo, watchDeviceInfo, type DeviceInfo } from '../lib/rumDevice';
import { Log, Stat, useLog } from './shared';
import './RumDemo.css';

function busy(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // chiếm main thread
  }
}

const fmt = (ms?: number) => (ms == null ? '–' : `${Math.round(ms)}ms`);

/** Cách Udemy cộng CLS: chỉ lấy entry CUỐI của mỗi lần callback (.pop()). */
function observeClsLikeUdemy(onValue: (v: number) => void) {
  let total = 0;
  return observe('layout-shift', (entries) => {
    const last = entries.pop() as (PerformanceEntry & { value: number; hadRecentInput: boolean }) | undefined;
    if (last && !last.hadRecentInput) total += last.value;
    onValue(total);
  });
}

/** Tổng mọi shift (không chia phiên), để đối chiếu. */
function observeClsSum(onValue: (v: number) => void) {
  let total = 0;
  return observe('layout-shift', (entries) => {
    for (const e of entries as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
      if (!e.hadRecentInput) total += e.value;
    }
    onValue(total);
  });
}

export default function RumDemo() {
  const { lines, add } = useLog(30);
  const [summary, setSummary] = useState<RumSummary | null>(null);
  const [udemyCls, setUdemyCls] = useState(0);
  const [sumCls, setSumCls] = useState(0);
  const [generation, setGeneration] = useState(1);
  const [banners, setBanners] = useState<number[]>([]);
  const [hero, setHero] = useState(false);
  const [device, setDevice] = useState<DeviceInfo>(() => getDeviceInfo());
  const [simulateLowEnd, setSimulateLowEnd] = useState(false);
  const [payload, setPayload] = useState<string | null>(null);
  const rumRef = useRef<ReturnType<typeof createRum> | null>(null);

  // phần tử lớn hiện ra muộn: ứng viên LCP
  useEffect(() => {
    const id = setTimeout(() => setHero(true), 700);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => watchDeviceInfo(setDevice), []);

  // Mỗi "thế hệ" là một bộ observer mới. Observer mới đăng ký với buffered: true nên nhận lại
  // MỌI entry cũ trong MỘT lần callback: chỗ lộ ra lỗi .pop() của Udemy.
  useEffect(() => {
    setPayload(null);
    const rum = createRum({
      onUpdate: setSummary,
      onStop: (s) => s.stoppedBy !== 'manual' && add(`⏹ dừng đo (${s.stoppedBy}): đây là lúc gửi beacon`, 'ok'),
      maxObservationMs: 120_000, // demo: 2 phút (Udemy: 30 giây)
    });
    rumRef.current = rum;
    const stopUdemy = observeClsLikeUdemy(setUdemyCls);
    const stopSum = observeClsSum(setSumCls);
    return () => {
      rum.stop();
      stopUdemy?.();
      stopSum?.();
    };
  }, [generation, add]);

  const insertBanner = (delay: number) => {
    const insert = () => setBanners((b) => [Date.now(), ...b]);
    if (delay === 0) {
      insert();
      add('➕ chèn banner NGAY khi bấm: trong 500ms sau input nên không tính vào CLS', 'muted');
    } else {
      setTimeout(insert, delay);
      add(`➕ chèn banner sau ${delay / 1000}s: bị tính vào CLS`, 'warn');
    }
  };

  const lowEnd = simulateLowEnd || device.lowEndExperience;

  return (
    <div className={`page rum${lowEnd ? ' rum-lite' : ''}`}>
      <h1>RUM tự viết</h1>
      <p className='hint'>
        Số liệu bên dưới đo thật trên trình duyệt của bạn bằng PerformanceObserver. Bấm các nút để tạo layout shift, long
        task, tương tác chậm và xem số thay đổi. Một số chỉ số chỉ có trên trình duyệt hỗ trợ (hiện "–" nếu không có).
      </p>
      <div className='stats'>
        <Stat label='FCP' value={fmt(summary?.fcp)} />
        <Stat label='LCP' value={fmt(summary?.lcp)} />
        <Stat label='CLS (theo phiên)' value={summary ? summary.cls.toFixed(3) : '–'} />
        <Stat label='TBT' value={fmt(summary?.tbt)} />
        <Stat label={`INP (${summary?.interactions ?? 0} tương tác)`} value={fmt(summary?.inp)} />
      </div>
      <div className='toolbar'>
        <button onClick={() => insertBanner(0)}>➕ Banner ngay</button>
        <button onClick={() => insertBanner(1000)}>⏱ Banner sau 1s</button>
        <button
          onClick={() => {
            setTimeout(() => {
              busy(300);
              add('🧱 long task 300ms: TBT +250ms', 'warn');
            }, 50);
          }}
        >
          🧱 Long task 300ms
        </button>
        <button
          onClick={() => {
            busy(200);
            add('🐢 click xử lý mất 200ms: INP tăng', 'warn');
          }}
        >
          🐢 Nút xử lý chậm
        </button>
      </div>
      <div className='rum-compare'>
        <div>
          <b>{sumCls.toFixed(3)}</b> cộng mọi shift
        </div>
        <div>
          <b className={udemyCls + 1e-6 < sumCls ? 'err' : ''}>{udemyCls.toFixed(3)}</b> kiểu Udemy (<code>.pop()</code>)
        </div>
        <button
          onClick={() => {
            setGeneration((g) => g + 1);
            add('🔁 tạo observer mới với buffered: true: mọi shift cũ tới trong một lần callback', 'muted');
          }}
        >
          🔁 Đo lại bằng observer mới
        </button>
      </div>
      <div className='rum-feed'>
        {banners.map((id) => (
          <div key={id} className='rum-banner'>
            Banner quảng cáo chèn muộn
          </div>
        ))}
        {hero ? (
          <div className='rum-hero'>
            <b>Khoá học mới</b>
            <span>{lowEnd ? 'Ảnh nhỏ, không animation' : 'Ảnh lớn + animation'}</span>
          </div>
        ) : (
          <div className='rum-hero skeleton' />
        )}
        <div className='card'>Nội dung bên dưới: bị đẩy xuống mỗi khi banner chèn vào.</div>
      </div>
      <div className='rum-device'>
        <div>
          <b>Thiết bị:</b> {device.cores ?? '?'} luồng CPU · {device.memoryGb ?? '?'} GB RAM · mạng{' '}
          {device.effectiveType ?? '?'}
          {device.saveData ? ' · tiết kiệm dữ liệu' : ''}
        </div>
        <div>
          <span className={`badge ${lowEnd ? 'warn' : 'ok'}`}>{lowEnd ? 'phục vụ bản nhẹ' : 'phục vụ bản đầy đủ'}</span>{' '}
          <label className='switch'>
            <input type='checkbox' checked={simulateLowEnd} onChange={(e) => setSimulateLowEnd(e.target.checked)} /> Giả
            lập máy yếu
          </label>
        </div>
      </div>
      <div className='toolbar'>
        <button
          className='primary'
          onClick={() => {
            rumRef.current?.stop();
            const s = rumRef.current?.summary();
            setPayload(JSON.stringify({ ...s, ...device, lowEndExperience: lowEnd }, null, 2));
          }}
        >
          📤 Dừng và xem payload beacon
        </button>
        <span className='muted'>lần đo #{generation}</span>
      </div>
      {payload && <pre className='rum-payload'>{payload}</pre>}
      <Log lines={lines} />
    </div>
  );
}
