import { useEffect, useRef, useState } from 'react';
import {
  challengeMessage,
  createChallengeIssuer,
  solve,
  verify,
  type Challenge,
  type Solution,
} from '../lib/proofOfWork';
import { solveInWorker } from '../lib/proofOfWorkWorkerClient';
import { Log, Stat, useLog } from './shared';
import './ProofOfWorkDemo.css';

const SALT = 'share-email';
const DIFFICULTIES = [8, 12, 14, 16, 18];

type Where = 'main' | 'worker';
type ServerMode = 'udemy' | 'challenge';

/**
 * Đo khung hình dài nhất trong lúc một việc async đang chạy. Lúc dừng tính thêm khoảng từ
 * frame cuối tới giờ: nếu main thread bận suốt thì rAF không chạy lần nào, khoảng đó mới là
 * khung hình bị đứng.
 */
function watchFrames(onWorst: (ms: number) => void) {
  let last = performance.now();
  let worst = 0;
  let id = requestAnimationFrame(function loop(now) {
    worst = Math.max(worst, now - last);
    last = now;
    onWorst(worst);
    id = requestAnimationFrame(loop);
  });
  return () => {
    cancelAnimationFrame(id);
    onWorst(Math.max(worst, performance.now() - last));
  };
}

export default function ProofOfWorkDemo() {
  const { lines, add } = useLog(40);
  const [difficulty, setDifficulty] = useState(16);
  const [busy, setBusy] = useState<Where | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [result, setResult] = useState<(Solution & { where: Where }) | null>(null);
  const [worstFrame, setWorstFrame] = useState(0);
  const [serverMode, setServerMode] = useState<ServerMode>('challenge');
  const [email, setEmail] = useState('ban@example.com');
  const abortRef = useRef<AbortController | null>(null);
  const issuerRef = useRef(createChallengeIssuer({ salt: SALT, difficulty }));
  // lời giải gần nhất đã gửi lên server, để thử "gửi lại"
  const lastSent = useRef<{ payload: string; nonce: string; challengeId?: string } | null>(null);
  const [sentOk, setSentOk] = useState(0);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    issuerRef.current = createChallengeIssuer({ salt: SALT, difficulty });
  }, [difficulty]);

  async function run<T>(where: Where, task: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(where);
    setAttempts(0);
    setWorstFrame(0);
    const stop = watchFrames(setWorstFrame);
    try {
      return await task(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) add('Đã huỷ.', 'muted');
      else add(`Lỗi: ${(error as Error).message}`, 'err');
    } finally {
      stop();
      if (abortRef.current === controller) setBusy(null);
    }
  }

  const solveWith = (where: Where, message: string, signal: AbortSignal) =>
    (where === 'main' ? solve : solveInWorker)({ salt: SALT, message, difficulty, signal, onProgress: setAttempts });

  async function benchmark(where: Where) {
    const solution = await run(where, (signal) => solveWith(where, `bench-${Date.now()}`, signal));
    if (!solution) return;
    setResult({ ...solution, where });
    add(
      `${where === 'main' ? 'Main thread' : 'Worker'}: nonce "${solution.nonce}" sau ${solution.attempts.toLocaleString('vi-VN')} lần thử, ${Math.round(solution.ms)}ms`,
      'ok',
    );
  }

  async function send(where: Where) {
    const payload = email.trim();
    if (serverMode === 'udemy') {
      // Udemy: salt cố định, message chỉ là email, không có gì do server cấp
      const solution = await run(where, (signal) => solveWith(where, payload, signal));
      if (!solution) return;
      const ok = await verify(SALT, payload, solution.nonce, difficulty);
      lastSent.current = { payload, nonce: solution.nonce };
      setSentOk((n) => n + (ok ? 1 : 0));
      add(`Gửi "${payload}" với upow="${solution.nonce}" → ${ok ? 'server nhận' : 'server từ chối'}`, ok ? 'ok' : 'err');
      return;
    }
    const challenge: Challenge = issuerRef.current.issue();
    add(`Server cấp challenge ${challenge.id.slice(0, 8)}…, độ khó ${challenge.difficulty} bit, hạn 5 phút`, 'muted');
    const solution = await run(where, (signal) => solveWith(where, challengeMessage(payload, challenge), signal));
    if (!solution) return;
    const verdict = await issuerRef.current.redeem(payload, challenge.id, solution.nonce);
    lastSent.current = { payload, nonce: solution.nonce, challengeId: challenge.id };
    setSentOk((n) => n + (verdict === 'ok' ? 1 : 0));
    add(`Gửi kèm lời giải "${solution.nonce}" → ${verdict}`, verdict === 'ok' ? 'ok' : 'err');
  }

  /** Kẻ spam: giải một lần rồi gửi lại cùng lời giải 20 lần. */
  async function replay() {
    const sent = lastSent.current;
    if (!sent) return add('Gửi một lần trước đã.', 'warn');
    let accepted = 0;
    for (let i = 0; i < 20; i++) {
      const ok =
        sent.challengeId === undefined
          ? await verify(SALT, sent.payload, sent.nonce, difficulty)
          : (await issuerRef.current.redeem(sent.payload, sent.challengeId, sent.nonce)) === 'ok';
      if (ok) accepted++;
    }
    setSentOk((n) => n + accepted);
    add(
      `Gửi lại cùng lời giải 20 lần → server nhận ${accepted}/20`,
      accepted > 0 ? 'err' : 'ok',
    );
  }

  const expected = 2 ** difficulty;

  return (
    <div className='page pow'>
      <h1>Proof-of-work trên client</h1>
      <p className='hint'>
        Tìm chuỗi <code>nonce</code> sao cho HMAC-SHA256 có {difficulty} bit đầu bằng 0: trung bình phải thử{' '}
        {expected.toLocaleString('vi-VN')} lần, server kiểm lại chỉ cần 1 lần. Quả bóng chạy bằng
        requestAnimationFrame: nó khựng nghĩa là main thread đang bận.
      </p>

      <div className='toolbar'>
        <label>
          Độ khó{' '}
          <select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))} disabled={busy !== null}>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d} bit (~{(2 ** d).toLocaleString('vi-VN')} lần)
              </option>
            ))}
          </select>
        </label>
        <button className='primary' onClick={() => benchmark('main')} disabled={busy !== null}>
          Giải trên main thread
        </button>
        <button className='primary' onClick={() => benchmark('worker')} disabled={busy !== null}>
          Giải trong Worker
        </button>
        <button onClick={() => abortRef.current?.abort()} disabled={busy === null}>
          Huỷ
        </button>
        <Ball />
      </div>

      <div className='stats'>
        <Stat label='Đang thử' value={busy ? attempts.toLocaleString('vi-VN') : '–'} />
        <Stat label='Lần thử (lần gần nhất)' value={result ? result.attempts.toLocaleString('vi-VN') : '–'} />
        <Stat label='Thời gian' value={result ? `${Math.round(result.ms)}ms` : '–'} />
        <Stat
          label='Băm mỗi giây'
          value={result ? Math.round((result.attempts / result.ms) * 1000).toLocaleString('vi-VN') : '–'}
        />
        <Stat label='Khung hình dài nhất' value={worstFrame ? `${Math.round(worstFrame)}ms` : '–'} />
      </div>

      <h2>Gửi form "chia sẻ qua email"</h2>
      <div className='toolbar' role='radiogroup' aria-label='Kiểu server'>
        <button
          className={serverMode === 'udemy' ? 'primary' : ''}
          aria-pressed={serverMode === 'udemy'}
          onClick={() => setServerMode('udemy')}
        >
          Kiểu Udemy: không có challenge
        </button>
        <button
          className={serverMode === 'challenge' ? 'primary' : ''}
          aria-pressed={serverMode === 'challenge'}
          onClick={() => setServerMode('challenge')}
        >
          Có challenge dùng một lần
        </button>
      </div>
      <div className='toolbar'>
        <input
          aria-label='Email người nhận'
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className='pow-email'
        />
        <button className='primary' onClick={() => send('worker')} disabled={busy !== null}>
          Giải + gửi
        </button>
        <button onClick={replay} disabled={busy !== null}>
          Gửi lại cùng lời giải ×20
        </button>
        <span className='badge'>server đã nhận: {sentOk}</span>
      </div>

      <Log lines={lines} />
    </div>
  );
}

/** Quả bóng chạy bằng JS (không dùng CSS animation, vì CSS transform chạy được cả khi main thread bận). */
function Ball() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let id = requestAnimationFrame(function loop(now) {
      if (ref.current) ref.current.style.transform = `translateX(${40 + 40 * Math.sin(now / 250)}px)`;
      id = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className='pow-ball-track' aria-hidden='true'>
      <div className='pow-ball' ref={ref} />
    </div>
  );
}
