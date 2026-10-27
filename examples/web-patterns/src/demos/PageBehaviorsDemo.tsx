import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  defineBehavior,
  jsonToCss,
  PageBehaviors,
  type BehaviorEntry,
  type BehaviorIssue,
  type BehaviorRegistry,
  type CssJson,
} from '../lib/pageBehaviors';
import { Log, useLog } from './shared';
import './PageBehaviorsDemo.css';

// ---- các behavior mà dev viết sẵn; CMS chỉ chọn và cấu hình ----

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const announcementBar = defineBehavior({
  parse(raw) {
    if (!isRecord(raw) || typeof raw.text !== 'string' || !raw.text)
      throw new Error('cần configuration.text');
    return { text: raw.text, tone: raw.tone === 'warn' ? 'warn' : 'info' } as const;
  },
  component: ({ config, children }) => (
    <>
      <div className={`pb-announce ${config.tone}`}>{config.text}</div>
      {children}
    </>
  ),
});

const customStyles = defineBehavior({
  // jsonToCss throw khi CSS sai -> lỗi được bắt ngay ở bước parse, không phải lúc render
  parse: (raw) => jsonToCss(raw as CssJson, '.pb-preview'),
  component: ({ config, children }) => (
    <>
      <style>{config}</style>
      {children}
    </>
  ),
});

const RegionContext = createContext('global');

const regionPage = defineBehavior({
  parse(raw) {
    if (!isRecord(raw) || typeof raw.region !== 'string')
      throw new Error('cần configuration.region');
    return raw.region;
  },
  component: ({ config, children }) => (
    <RegionContext.Provider value={config}>{children}</RegionContext.Provider>
  ),
});

/** exit-intent + giới hạn số lần hiện theo id của entry (Intercom dùng cookie viewed-/dismissed-/submitted-<id>). */
const exitIntent = defineBehavior({
  parse(raw) {
    const c = isRecord(raw) ? raw : {};
    const delayMs = Number(c.delayMs ?? 2000);
    const maxViews = Number(c.maxViews ?? 4);
    if (!Number.isFinite(delayMs) || !Number.isFinite(maxViews))
      throw new Error('delayMs/maxViews phải là số');
    return { delayMs, maxViews, title: typeof c.title === 'string' ? c.title : 'Khoan đã!' };
  },
  component: function ExitIntent({ id, config, children }) {
    const [open, setOpen] = useState(false);
    const activeAfter = useRef(Date.now() + config.delayMs);
    const key = (kind: string) => `pb-${kind}-${id}`;
    const read = (kind: string) => Number(localStorage.getItem(key(kind)) ?? 0);

    useEffect(() => {
      if (open) return;
      const onMouseOut = (event: MouseEvent) => {
        // relatedTarget null + clientY <= 0: chuột rời cửa sổ qua mép trên (về phía thanh tab)
        if (event.relatedTarget !== null || event.clientY > 0) return;
        if (Date.now() < activeAfter.current) return;
        if (read('dismissed') || read('submitted') || read('viewed') >= config.maxViews) return;
        localStorage.setItem(key('viewed'), String(read('viewed') + 1));
        setOpen(true);
      };
      document.addEventListener('mouseout', onMouseOut);
      return () => document.removeEventListener('mouseout', onMouseOut);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, config.maxViews, id]);

    return (
      <>
        {children}
        {open && (
          <div className='pb-modal' role='dialog' aria-label={config.title}>
            <b>{config.title}</b>
            <p className='muted'>
              Đã hiện {read('viewed')}/{config.maxViews} lần cho entry <code>{id}</code>
            </p>
            <div className='toolbar'>
              <button
                className='primary'
                onClick={() => (localStorage.setItem(key('submitted'), '1'), setOpen(false))}
              >
                Đăng ký
              </button>
              <button onClick={() => setOpen(false)}>Để sau</button>
              <button onClick={() => (localStorage.setItem(key('dismissed'), '1'), setOpen(false))}>
                Không hiện nữa
              </button>
            </div>
          </div>
        )}
      </>
    );
  },
});

const crashy = defineBehavior({
  component: () => {
    throw new Error('behavior bị lỗi khi render');
  },
});

const registry: BehaviorRegistry = {
  'announcement-bar': announcementBar,
  'custom-styles': customStyles,
  'region-page': regionPage,
  'exit-intent-modal': exitIntent,
  'crashy-experiment': crashy,
};

// ---- dữ liệu "CMS" ----

const PRESETS: Record<string, BehaviorEntry[]> = {
  'Trang pricing': [
    {
      id: '4fK2',
      identifier: 'announcement-bar',
      configuration: { text: 'Giảm 20% gói năm tới hết tháng' },
    },
    { id: '9aQ1', identifier: 'region-page', configuration: { region: 'vn' } },
    {
      id: '7cE3',
      identifier: 'custom-styles',
      configuration: {
        '.hero': { background: 'linear-gradient(120deg, #ff7a3d33, #a78bfa33)' },
        '@media (max-width: 600px)': { '.hero h2': { 'font-size': '18px' } },
      },
    },
    {
      id: '2xR8',
      identifier: 'exit-intent-modal',
      configuration: { delayMs: 1000, maxViews: 3, title: 'Nhận bảng giá PDF?' },
    },
  ],
  'Cấu hình có lỗi': [
    {
      id: 'a1',
      identifier: 'announcement-bar',
      configuration: { text: 'Banner vẫn chạy bình thường' },
    },
    { id: 'b2', identifier: 'annoucement-bar', configuration: { text: 'gõ sai identifier' } },
    {
      id: 'c3',
      identifier: 'custom-styles',
      configuration: { '.hero': { color: 'red;} body{display:none' } },
    },
    { id: 'd4', identifier: 'crashy-experiment' },
  ],
  'Không behavior': [],
};

function PageContent() {
  const region = useContext(RegionContext);
  const [likes, setLikes] = useState(0);
  return (
    <div className='pb-page'>
      <div className='hero'>
        <h2>Bảng giá</h2>
        <p className='muted'>Nội dung do CMS dựng. Khu vực: {region}</p>
      </div>
      <button onClick={() => setLikes((n) => n + 1)}>👍 Hữu ích ({likes})</button>
    </div>
  );
}

export default function PageBehaviorsDemo() {
  const [preset, setPreset] = useState('Trang pricing');
  const [text, setText] = useState(() => JSON.stringify(PRESETS['Trang pricing'], null, 2));
  const [entries, setEntries] = useState<BehaviorEntry[]>(PRESETS['Trang pricing']);
  const [jsonError, setJsonError] = useState('');
  const { lines, add, clear } = useLog();

  // StrictMode chạy effect 2 lần ở dev: lọc báo cáo trùng cho log dễ đọc
  const reported = useRef(new Set<string>());
  const onIssue = useCallback(
    (issue: BehaviorIssue) => {
      const key = `${issue.id}:${issue.reason}`;
      if (reported.current.has(key)) return;
      reported.current.add(key);
      add(`⚠ ${issue.identifier} (${issue.id}): ${issue.reason}: ${issue.message}`, 'err');
    },
    [add],
  );

  const choose = (name: string) => {
    setPreset(name);
    setText(JSON.stringify(PRESETS[name], null, 2));
    setEntries(PRESETS[name]);
    setJsonError('');
    reported.current.clear();
    clear();
  };

  const apply = () => {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('cần một mảng entry');
      setEntries(parsed);
      setJsonError('');
      reported.current.clear();
      clear();
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : String(error));
    }
  };

  const simulateExit = () => {
    document.dispatchEvent(
      new MouseEvent('mouseout', { clientY: -1, relatedTarget: null, bubbles: true }),
    );
  };

  const resetCap = () => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('pb-'))
      .forEach((k) => localStorage.removeItem(k));
    add('Đã xoá bộ đếm exit-intent', 'muted');
  };

  return (
    <div className='page'>
      <h1>Page behaviors: gắn hành vi từ CMS</h1>
      <p className='hint'>
        Bên trái là dữ liệu CMS (người biên tập sửa), bên phải là trang. Code chỉ có registry các
        behavior; thêm, bớt, cấu hình behavior không cần deploy.
      </p>
      <div className='toolbar'>
        {Object.keys(PRESETS).map((name) => (
          <button key={name} aria-pressed={preset === name} onClick={() => choose(name)}>
            {name}
          </button>
        ))}
      </div>
      <div className='pb-layout'>
        <div className='pb-editor'>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            aria-label='JSON từ CMS'
          />
          <div className='toolbar'>
            <button className='primary' onClick={apply}>
              Áp dụng
            </button>
            {jsonError && <span className='err'>{jsonError}</span>}
          </div>
          <p className='muted pb-tree'>
            Thứ tự bọc (ngoài → trong): {entries.map((e) => `<${e.identifier}>`).join(' ')}{' '}
            {'<Page/>'}
          </p>
        </div>
        <div className='pb-preview card'>
          <PageBehaviors
            key={JSON.stringify(entries)}
            behaviors={entries}
            registry={registry}
            onIssue={onIssue}
          >
            <PageContent />
          </PageBehaviors>
        </div>
      </div>
      <div className='toolbar'>
        <button onClick={simulateExit}>Giả lập chuột rời trang</button>
        <button onClick={resetCap}>Xoá bộ đếm exit-intent</button>
      </div>
      <Log lines={lines} />
    </div>
  );
}
