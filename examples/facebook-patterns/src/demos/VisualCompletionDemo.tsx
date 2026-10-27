import { use, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  InteractionTracker,
  InteractionTrackerProvider,
  TrackedSuspense,
  useInteraction,
} from '../lib/interactionTracker';
import { VC_ATTRIBUTE, VC_IGNORE, VisualCompletionTrace, type VCReport } from '../lib/visualCompletion';
import { Stat } from './shared';
import './VisualCompletionDemo.css';

const tracker = new InteractionTracker();

// Delay ngẫu nhiên nhưng cố định theo lần điều hướng, để mỗi lần bấm ra một "trang" khác nhau.
function random(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}
const delayFor = (nav: number, slot: number, min: number, max: number) =>
  Math.round(min + random(nav * 31 + slot) * (max - min));

// Promise được cache theo khoá để dùng với use() + Suspense.
const cache = new Map<string, Promise<string>>();
function load(key: string, ms: number, value: string) {
  let promise = cache.get(key);
  if (!promise) {
    promise = new Promise((resolve) => setTimeout(() => resolve(value), ms));
    cache.set(key, promise);
  }
  return promise;
}

function SuspendedCard({ nav, slot, title }: { nav: number; slot: number; title: string }) {
  const text = use(load(`${nav}-${slot}`, delayFor(nav, slot, 300, 1400), `Nội dung của ${title}`));
  return (
    <div className='card vc-card' data-vc-label={title}>
      <b>{title}</b>
      <p className='muted'>{text}</p>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className='card vc-card'>
      <div className='skeleton' style={{ width: '50%' }} />
      <div className='skeleton' />
    </div>
  );
}

/** Hiện sau `ms` bằng setState thường, KHÔNG qua Suspense. */
function useAppearAfter(ms: number) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return shown;
}

function heroImage(nav: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 120;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 480, 120);
  gradient.addColorStop(0, `hsl(${(nav * 47) % 360} 80% 60%)`);
  gradient.addColorStop(1, `hsl(${(nav * 47 + 90) % 360} 80% 55%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 480, 120);
  return canvas.toDataURL();
}

function FakePage({ nav, ignoreSpinner }: { nav: number; ignoreSpinner: boolean }) {
  const heroShown = useAppearAfter(delayFor(nav, 1, 200, 700));
  const sidebarShown = useAppearAfter(delayFor(nav, 2, 600, 1800));
  const spinnerShown = useAppearAfter(300);
  // Sidebar không dùng Suspense nên tracker không tự biết nó đang tải: giữ tương tác bằng tay.
  useLayoutEffect(() => {
    if (sidebarShown) return;
    return tracker.hold('Sidebar (hold thủ công)');
  }, [sidebarShown]);
  const [heroSrc, setHeroSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!heroShown) return;
    // ảnh "tải" chậm thêm một chút sau khi khung hero đã hiện
    const id = setTimeout(() => setHeroSrc(heroImage(nav)), 300);
    return () => clearTimeout(id);
  }, [heroShown, nav]);

  return (
    <div className='vc-page' data-vc-label='Khung trang'>
      <header className='vc-header' data-vc-label='Header'>
        Trang #{nav}
      </header>
      {spinnerShown && (
        <div
          className='vc-sync'
          data-vc-label='Dải "đang đồng bộ"'
          {...(ignoreSpinner ? { [VC_ATTRIBUTE]: VC_IGNORE } : {})}
        >
          <span className='spinner' /> Đang đồng bộ dữ liệu…
        </div>
      )}
      {heroShown && (
        <div className='vc-hero' data-vc-label='Khung hero'>
          {heroSrc && <img src={heroSrc} alt='' data-vc-label='Ảnh hero (đã tải)' />}
        </div>
      )}
      <div className='vc-grid'>
        <div className='vc-col'>
          {['Thẻ A', 'Thẻ B', 'Thẻ C'].map((title, i) => (
            <TrackedSuspense key={title} name={title} fallback={<CardSkeleton />}>
              <SuspendedCard nav={nav} slot={10 + i} title={title} />
            </TrackedSuspense>
          ))}
        </div>
        <aside className='vc-side'>
          {sidebarShown ? (
            <div className='card vc-sidebar' data-vc-label='Sidebar'>
              <b>Gợi ý kết bạn</b>
              <p className='muted'>Hiện bằng setState, giữ tương tác bằng tracker.hold().</p>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function ProgressChart({ report }: { report: VCReport }) {
  const max = Math.max(report.visuallyComplete, 1);
  const points = [[0, 0], ...report.progress.map((p) => [p.latency, p.percent])];
  // đường bậc thang: % hoàn tất chỉ đổi khi có phần tử mới được vẽ
  const d = points
    .map(([x, y], i) => {
      const px = (x / max) * 300;
      const py = 80 - (y / 100) * 80;
      const prevY = i === 0 ? py : 80 - (points[i - 1][1] / 100) * 80;
      return i === 0 ? `M${px},${py}` : `L${px},${prevY} L${px},${py}`;
    })
    .join(' ');
  return (
    <svg viewBox='-4 -4 308 92' className='vc-chart' role='img' aria-label='Tiến độ hiển thị theo thời gian'>
      <rect x='0' y='0' width={(report.speedIndex / max) * 300} height='80' className='vc-si' />
      <path d={d} className='vc-line' />
    </svg>
  );
}

export default function VisualCompletionDemo() {
  const [nav, setNav] = useState(0);
  const [ignoreSpinner, setIgnoreSpinner] = useState(true);
  const [report, setReport] = useState<VCReport | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const traceRef = useRef<VisualCompletionTrace | null>(null);
  const interaction = useInteraction(tracker);

  const navigate = () => {
    traceRef.current?.dispose();
    setReport(null);
    // Bắt đầu đo NGAY trong click handler, trước khi React render trang mới.
    const trace = new VisualCompletionTrace({ root: pageRef.current!, timeoutMs: 8000 });
    // Giống HERO_TRACING_HOLD của Facebook: VC chưa được chốt khi tương tác còn chờ Suspense.
    const release = trace.lock('interaction');
    const off = tracker.onDone(() => {
      off();
      release();
    });
    trace.onComplete(setReport);
    traceRef.current = trace;
    tracker.start('Điều hướng');
    setNav((n) => n + 1);
  };

  useEffect(() => () => traceRef.current?.dispose(), []);

  const spans = useMemo(() => interaction?.spans ?? [], [interaction]);

  return (
    <div className='page'>
      <h1>Visual Completion & interaction tracing</h1>
      <p className='hint'>
        Bấm "Điều hướng": trang mới có header, ảnh hero, 3 thẻ dùng Suspense và sidebar giữ tương
        tác bằng hold(). Dải "đang đồng bộ" hiện rất sớm: bỏ chọn "ignore" để thấy nó làm
        Speed Index đẹp giả.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={navigate}>
          Điều hướng
        </button>
        <label className='switch'>
          <input type='checkbox' checked={ignoreSpinner} onChange={(e) => setIgnoreSpinner(e.target.checked)} />
          Dải loading có data-visualcompletion="ignore"
        </label>
      </div>
      <div className='split'>
        <div ref={pageRef} className='vc-root'>
          <InteractionTrackerProvider tracker={tracker}>
            {nav > 0 ? (
              <FakePage key={nav} nav={nav} ignoreSpinner={ignoreSpinner} />
            ) : (
              <p className='muted'>Chưa điều hướng.</p>
            )}
          </InteractionTrackerProvider>
        </div>
        <aside className='vc-panel'>
          <div className='stats'>
            <Stat
              label='Interaction'
              value={
                <output data-testid='interaction'>
                  {!interaction
                    ? '—'
                    : interaction.status === 'pending'
                      ? 'đang chờ…'
                      : interaction.status === 'done'
                        ? `${interaction.duration}ms`
                        : `huỷ (${interaction.abortReason})`}
                </output>
              }
            />
            <Stat label='Visually Complete' value={<output data-testid='vc'>{report ? `${report.visuallyComplete}ms` : '…'}</output>} />
            <Stat label='Speed Index' value={<output data-testid='si'>{report ? `${report.speedIndex}ms` : '…'}</output>} />
            <Stat label='First paint' value={report ? `${report.firstPaint}ms` : '…'} />
          </div>
          {spans.length > 0 && (
            <div className='vc-spans'>
              <b>Suspense đang chờ</b>
              {spans.map((span, i) => (
                <div key={i}>
                  {span.name}: {span.start}ms → {span.end == null ? '…' : `${span.end}ms`}
                </div>
              ))}
            </div>
          )}
          {report && (
            <>
              <ProgressChart report={report} />
              <div className='log vc-elements' data-testid='vc-elements'>
                {report.elements.map((el, i) => (
                  <div key={i}>
                    {el.latency}ms · {el.label} · {((el.pixels / report.viewportPixels) * 100).toFixed(1)}%
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
