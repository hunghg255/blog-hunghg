import { useEffect, useState } from 'react';
import { getIntersectionStats } from '../lib/observeIntersection';
import { useInView } from '../lib/useInView';
import { Stat } from './shared';

// Cách "ngây thơ": mỗi component tự tạo một IntersectionObserver.
let naiveObserverCount = 0;
function useInViewNaive<T extends Element>(): [(node: T | null) => void, boolean] {
  const [node, setNode] = useState<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    observer.observe(node);
    naiveObserverCount++;
    return () => {
      observer.disconnect();
      naiveObserverCount--;
    };
  }, [node]);
  return [setNode, inView];
}

function SharedCard({ index }: { index: number }) {
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.5 });
  return (
    <div ref={ref} className={`card${inView ? ' active' : ''}`}>
      #{index}
    </div>
  );
}

function NaiveCard({ index }: { index: number }) {
  const [ref, inView] = useInViewNaive<HTMLDivElement>();
  return (
    <div ref={ref} className={`card${inView ? ' active' : ''}`}>
      #{index}
    </div>
  );
}

const COUNT = 300;

export default function SharedObserverDemo() {
  const [shared, setShared] = useState(true);
  const [stats, setStats] = useState({ observers: 0, targets: 0 });

  useEffect(() => {
    const id = setInterval(() => {
      setStats(
        shared ? getIntersectionStats() : { observers: naiveObserverCount, targets: naiveObserverCount },
      );
    }, 300);
    return () => clearInterval(id);
  }, [shared]);

  const Card = shared ? SharedCard : NaiveCard;

  return (
    <div className='page'>
      <h1>Shared IntersectionObserver</h1>
      <p className='hint'>
        {COUNT} card, card nào nằm trong viewport ≥ 50% sẽ có viền xanh. Bật/tắt để so sánh số
        observer phải tạo.
      </p>
      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={shared} onChange={(e) => setShared(e.target.checked)} />
          Dùng chung observer
        </label>
      </div>
      <div className='stats sticky' style={{ background: 'var(--bg)', paddingBottom: 8, zIndex: 1 }}>
        <Stat label='IntersectionObserver đang tồn tại' value={stats.observers} />
        <Stat label='element đang được theo dõi' value={stats.targets} />
      </div>
      <div className='grid'>
        {Array.from({ length: COUNT }, (_, i) => (
          <Card key={i} index={i + 1} />
        ))}
      </div>
    </div>
  );
}
