import { useState } from 'react';
import { alea, bucketOf, createTraceIdGenerator, randomSeed, shuffleSeeded, traceIdToBucket } from '../lib/seededRandom';
import { Stat } from './shared';
import './SeededRandomDemo.css';

export default function SeededRandomDemo() {
  return (
    <div className='page sr-demo'>
      <h1>Số ngẫu nhiên có seed: tái lập, xáo trộn, lấy mẫu</h1>
      <p className='hint'>
        Math.random không nhận seed nên không chạy lại được cùng một dãy. Alea (thuật toán công khai, MIT) nhận seed
        là chuỗi bất kỳ: cùng seed thì cùng dãy, trên mọi trình duyệt.
      </p>
      <SequenceSection />
      <ShuffleSection />
      <SamplingSection />
    </div>
  );
}

function SequenceSection() {
  const [seed, setSeed] = useState('hunghg255');
  const random = alea(seed);
  const values = Array.from({ length: 6 }, () => random());
  const again = alea(seed)();
  // Alea gốc không truyền seed thì dùng new Date(); Mash gọi toString() nên chỉ còn độ phân giải giây
  const second = Math.floor(Date.now() / 1000) * 1000;
  const sameSecond = alea(String(new Date(second)))() === alea(String(new Date(second + 900)))();
  return (
    <section className='card sr-card'>
      <h2>1. Cùng seed → cùng dãy</h2>
      <div className='toolbar'>
        <label>
          seed <input value={seed} onChange={(e) => setSeed(e.target.value)} data-testid='sr-seed' />
        </label>
        <button onClick={() => setSeed(randomSeed())}>Seed ngẫu nhiên (crypto)</button>
      </div>
      <ol className='sr-values' data-testid='sr-values'>
        {values.map((v, i) => (
          <li key={i}>{v.toFixed(10)}</li>
        ))}
      </ol>
      <p className='hint'>
        Tạo lại với cùng seed, số đầu tiên: <code data-testid='sr-again'>{again.toFixed(10)}</code>{' '}
        {again === values[0] ? <span className='ok'>trùng</span> : <span className='err'>khác</span>}.
      </p>
      <p className='hint'>
        Seed mặc định của bản gốc là <code>new Date()</code>, bị Mash đổi thành chuỗi kiểu &quot;Wed Oct 28 2026 09:47:13&quot; (chỉ tới giây): hai bộ sinh tạo trong cùng một giây ra cùng
        dãy (vừa thử hai thời điểm cách nhau 900ms: {sameSecond ? 'trùng' : 'khác'}). Bản viết lại tạo seed bằng crypto.getRandomValues.
      </p>
    </section>
  );
}

const QUESTIONS = ['Câu 1', 'Câu 2', 'Câu 3', 'Câu 4', 'Câu 5', 'Câu 6', 'Câu 7', 'Câu 8'];

/** Chép lại randomShuffleSeeded của Facebook: xáo TẠI CHỖ và trả lại chính mảng đó. */
function facebookShuffle<T>(items: T[], ...seeds: string[]) {
  const random = alea(...seeds);
  for (let h = items.length - 1; h > 0; h--) {
    const i = Math.floor(random() * (h + 1));
    if (i !== h) [items[i], items[h]] = [items[h], items[i]];
  }
  return items;
}

function ShuffleSection() {
  const [user, setUser] = useState('user-42');
  const mine1 = shuffleSeeded(QUESTIONS, 'quiz-10', user);
  const mine2 = shuffleSeeded(QUESTIONS, 'quiz-10', user);
  const shared = QUESTIONS.slice();
  const fb1 = facebookShuffle(shared, 'quiz-10', user).slice();
  const fb2 = facebookShuffle(shared, 'quiz-10', user).slice();
  const same = (x: string[], y: string[]) => x.join() === y.join();
  return (
    <section className='card sr-card'>
      <h2>2. Xáo đề thi theo người dùng</h2>
      <p className='hint'>
        Seed = (mã đề, mã người dùng): mỗi người một thứ tự riêng, tải lại trang vẫn giữ nguyên, không cần lưu thứ tự
        lên server.
      </p>
      <div className='toolbar'>
        <label>
          người dùng <input value={user} onChange={(e) => setUser(e.target.value)} data-testid='sr-user' />
        </label>
      </div>
      <div className='sr-grid'>
        <div>
          <b>Viết lại (trả bản sao)</b>
          <p className='sr-order' data-testid='sr-mine'>{mine1.join(' · ')}</p>
          <p className='sr-order'>{mine2.join(' · ')}</p>
          <span className={same(mine1, mine2) ? 'ok' : 'err'}>{same(mine1, mine2) ? 'gọi 2 lần: giống nhau' : 'khác nhau'}</span>
        </div>
        <div>
          <b>Bản gốc (xáo tại chỗ)</b>
          <p className='sr-order'>{fb1.join(' · ')}</p>
          <p className='sr-order'>{fb2.join(' · ')}</p>
          <span className={same(fb1, fb2) ? 'ok' : 'warn'} data-testid='sr-fb'>
            {same(fb1, fb2) ? 'gọi 2 lần: giống nhau' : 'gọi 2 lần trên cùng mảng: khác nhau'}
          </span>
        </div>
      </div>
    </section>
  );
}

function SamplingSection() {
  const [stats, setStats] = useState<null | { buckets: number[]; ids: string[]; sampled: number; total: number }>(null);
  const run = () => {
    const buckets = [0, 0, 0, 0];
    for (let u = 0; u < 20000; u++) buckets[bucketOf('new-composer', `user-${u}`, 4)]++;
    const next = createTraceIdGenerator(alea(randomSeed()));
    const ids: string[] = [];
    let sampled = 0;
    const total = 100_000;
    for (let i = 0; i < total; i++) {
      const id = next();
      if (i < 6) ids.push(id);
      if (traceIdToBucket(id) === 0) sampled++;
    }
    setStats({ buckets, ids, sampled, total });
  };
  return (
    <section className='card sr-card'>
      <h2>3. Chia nhóm A/B và lấy mẫu trace 1/32</h2>
      <button className='primary' onClick={run}>
        Chạy
      </button>
      {stats && (
        <>
          <p className='hint'>20.000 người dùng chia vào 4 nhóm của thí nghiệm &quot;new-composer&quot;:</p>
          <div className='stats' data-testid='sr-buckets'>
            {stats.buckets.map((n, i) => (
              <Stat key={i} label={`nhóm ${i}`} value={n.toLocaleString('vi-VN')} />
            ))}
          </div>
          <p className='hint'>ID trace 11 ký tự base64 (63 bit), nhóm lấy mẫu = ký tự cuối mod 32:</p>
          <ul className='sr-ids'>
            {stats.ids.map((id) => (
              <li key={id}>
                <code>{id}</code> → nhóm {traceIdToBucket(id)}
              </li>
            ))}
          </ul>
          <p data-testid='sr-sampled'>
            Giữ trace có nhóm 0: {stats.sampled.toLocaleString('vi-VN')}/{stats.total.toLocaleString('vi-VN')} ={' '}
            {((stats.sampled / stats.total) * 100).toFixed(2)}% (kỳ vọng 3,13%)
          </p>
        </>
      )}
    </section>
  );
}
