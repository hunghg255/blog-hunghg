import { Component, useEffect, useState, type ReactNode } from 'react';
import { applyWithGuard, guard, installGlobalErrorHandlers, normalizeError, onError, reportError } from '../lib/errorGuard';
import { Log, useLog } from './shared';

// Một event emitter tối giản: 3 listener, listener thứ 2 bị lỗi.
function emit(listeners: Array<() => void>, useGuard: boolean) {
  for (const listener of listeners) {
    if (useGuard) applyWithGuard(listener, null, [], { name: 'Feed.onNewStory' });
    else listener();
  }
}

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    // lỗi render của React cũng đi chung pipeline
    reportError(normalizeError(error, 'REACT', ['ErrorBoundary(Demo)']));
  }
  render() {
    return this.state.failed ? (
      <div className='card err'>
        Component bị lỗi đã được thay bằng fallback.{' '}
        <button onClick={() => this.setState({ failed: false })}>Thử lại</button>
      </div>
    ) : (
      this.props.children
    );
  }
}

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new Error('Không đọc được story.author.name');
  return <div className='card'>Component đang chạy bình thường</div>;
}

export default function ErrorGuardDemo() {
  const { lines, add } = useLog();
  const [ran, setRan] = useState<string>('—');
  const [explode, setExplode] = useState(false);

  useEffect(() => {
    const uninstall = installGlobalErrorHandlers();
    const unsubscribe = onError((e) => {
      const where = e.guardList.length ? ` @ ${e.guardList.join(' › ')}` : '';
      add(`[${e.source}] ${e.name}: ${e.message}${where}`, 'err');
    });
    return () => {
      uninstall();
      unsubscribe();
    };
  }, [add]);

  const runEmitter = (useGuard: boolean) => {
    const executed: number[] = [];
    const listeners = [
      () => executed.push(1),
      () => {
        throw new TypeError("Cannot read properties of undefined (reading 'id')");
      },
      () => executed.push(3),
    ];
    try {
      emit(listeners, useGuard);
    } catch {
      // không guard: lỗi văng ra ngoài vòng lặp, listener 3 không bao giờ chạy
      setTimeout(() => {
        throw new TypeError("Cannot read properties of undefined (reading 'id')");
      });
    }
    setRan(`listener đã chạy: [${executed.join(', ')}]`);
  };

  // guard lồng nhau -> guardList cho biết lỗi nằm trong ngữ cảnh nào
  const onLike = guard(
    () => {
      throw new Error('Like thất bại: story không tồn tại');
    },
    { name: 'LikeButton.onClick' },
  );
  const renderFeed = guard(() => onLike(), { name: 'Feed.render' });

  return (
    <div className='page'>
      <h1>ErrorGuard</h1>
      <p className='hint'>Mọi lỗi (có guard, không guard, promise, React) đi chung một pipeline đã chuẩn hoá.</p>
      <div className='toolbar'>
        <button onClick={() => runEmitter(false)}>Emit không guard</button>
        <button className='primary' onClick={() => runEmitter(true)}>
          Emit có guard
        </button>
        <span className='muted'>{ran}</span>
      </div>
      <div className='toolbar'>
        <button onClick={() => renderFeed()}>Guard lồng nhau</button>
        <button
          onClick={() =>
            setTimeout(() => {
              throw 'lỗi dạng string';
            })
          }
        >
          throw "string"
        </button>
        <button onClick={() => void Promise.reject(new Error('API /feed trả về 500'))}>Promise reject</button>
        <button onClick={() => setExplode(true)}>Component lỗi</button>
      </div>
      <ErrorBoundary key={String(explode)}>
        <Bomb explode={explode} />
      </ErrorBoundary>
      {explode && (
        <p>
          <button onClick={() => setExplode(false)}>Sửa component</button>
        </p>
      )}
      <Log lines={lines} />
    </div>
  );
}
