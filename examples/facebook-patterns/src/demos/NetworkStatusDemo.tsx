import { useEffect, useMemo, useRef } from 'react';
import { createNetworkStatus, trackedFetch, useOnline } from '../lib/networkStatus';
import { Log, sleep, useLog } from './shared';

export default function NetworkStatusDemo() {
  const { lines, add } = useLog();
  // "mạng giả": bật công tắc là mọi request (kể cả heartbeat) đều lỗi
  const simulatedOfflineRef = useRef(false);

  const { status, apiFetch } = useMemo(() => {
    const fakeFetch: typeof fetch = async () => {
      await sleep(150);
      if (simulatedOfflineRef.current) throw new TypeError('Failed to fetch');
      return new Response(null, { status: 204 });
    };
    const status = createNetworkStatus({
      heartbeatUrl: '/heartbeat',
      fetchImpl: fakeFetch,
      onHeartbeat: (e) => {
        if (e.type === 'heartbeat-start') add('💓 bắt đầu heartbeat');
        if (e.type === 'heartbeat-ok') add('💓 heartbeat OK -> online', 'ok');
        if (e.type === 'heartbeat-fail')
          add(`💔 heartbeat lỗi lần ${e.attempt}, thử lại sau ${e.retryIn}ms`, 'err');
      },
    });
    return { status, apiFetch: trackedFetch(status, fakeFetch) };
  }, [add]);

  useEffect(() => () => status.destroy(), [status]);

  const online = useOnline(status);

  const callApi = async () => {
    try {
      await apiFetch('/api/feed');
      add('GET /api/feed 204', 'muted');
    } catch {
      add('GET /api/feed lỗi mạng', 'warn');
    }
  };

  return (
    <div className='page'>
      <h1>Network status + heartbeat</h1>
      <p className='hint'>
        Bật "Giả lập mất mạng" rồi gọi API: sau lần lỗi đầu, heartbeat chạy với độ trễ tăng gấp đôi
        (100 → 200 → 400 … tối đa 6400ms). Tắt công tắc, heartbeat kế tiếp thành công và trạng thái
        trở lại online. Thử cả chế độ Offline trong DevTools.
      </p>
      <div className='toolbar'>
        <span className={`badge ${online ? 'ok' : 'err'}`}>{online ? 'Online' : 'Offline'}</span>
        <label className='switch'>
          <input
            type='checkbox'
            onChange={(e) => {
              simulatedOfflineRef.current = e.target.checked;
              add(e.target.checked ? '🔌 rút dây mạng (giả lập)' : '🔌 cắm lại dây mạng (giả lập)');
            }}
          />
          Giả lập mất mạng
        </label>
        <button className='primary' onClick={callApi}>
          Gọi API
        </button>
      </div>
      {!online && (
        <div className='card' style={{ marginBottom: 12, borderColor: 'var(--err)' }}>
          Bạn đang offline. Các thay đổi sẽ được gửi khi có mạng trở lại.
        </div>
      )}
      <Log lines={lines} />
    </div>
  );
}
