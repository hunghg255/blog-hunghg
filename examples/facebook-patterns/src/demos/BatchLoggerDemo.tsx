import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createBatchLogger, type Transport } from '../lib/batchLogger';
import { Log, Stat, sleep, useLog } from './shared';

export default function BatchLoggerDemo() {
  const { lines, add } = useLog();
  const serverDownRef = useRef(false);
  const requestCountRef = useRef(0);

  const logger = useMemo(() => {
    // transport giả: in ra log thay vì gửi request thật
    const transport: Transport = {
      async send(url, body) {
        requestCountRef.current++;
        await sleep(200);
        const { priority, events } = JSON.parse(body);
        if (serverDownRef.current) {
          add(`POST ${url} ✗ 503 (${events.length} event ${priority}) -> xếp lại hàng đợi`, 'err');
          throw new Error('503');
        }
        add(`POST ${url} ✓ ${events.length} event ${priority}, ${body.length} bytes`, 'ok');
      },
      beacon(url, body) {
        requestCountRef.current++;
        const { priority, events } = JSON.parse(body);
        add(`sendBeacon ${url} ✓ ${events.length} event ${priority}`, 'warn');
        return true;
      },
    };
    return createBatchLogger({
      endpoint: '/log',
      transport,
      delays: { vital: 1000, basic: 5000 },
      maxBatchSize: 20,
    });
  }, [add]);

  useEffect(() => () => logger.destroy(), [logger]);

  const sizes = useSyncExternalStore(logger.subscribe, () => {
    const { vital, basic } = logger.getQueueSizes();
    return `${vital}|${basic}`; // snapshot phải là giá trị so sánh được bằng ===
  });
  const [vital, basic] = sizes.split('|');

  return (
    <div className='page'>
      <h1>Batch logger (kiểu Banzai)</h1>
      <p className='hint'>
        Event "basic" gửi sau 5 giây, "vital" sau 1 giây, đủ 20 event thì gửi ngay. Chuyển sang tab
        khác: phần còn lại được gửi bằng sendBeacon.
      </p>
      <div className='toolbar'>
        <button onClick={() => logger.log('click', { target: 'like_button' })}>Log click (basic)</button>
        <button className='primary' onClick={() => logger.log('payment_failed', { code: 'E42' }, 'vital')}>
          Log lỗi thanh toán (vital)
        </button>
        <button
          onClick={() => {
            for (let i = 0; i < 45; i++) logger.log('impression', { story: i });
          }}
        >
          Spam 45 event
        </button>
        <button onClick={() => logger.flushWithBeacon()}>Giả lập rời trang</button>
        <label className='switch'>
          <input type='checkbox' onChange={(e) => (serverDownRef.current = e.target.checked)} />
          Server lỗi
        </label>
      </div>
      <div className='stats'>
        <Stat label='vital đang chờ' value={vital} />
        <Stat label='basic đang chờ' value={basic} />
      </div>
      <Log lines={lines} />
    </div>
  );
}
