import { useContext, useEffect, useRef, useState } from 'react';
import {
  ComposerContext,
  useComposer,
  useComposerStore,
  usePlugin,
  useWarnBeforeUnload,
  type ComposerStore,
  type PluginParts,
} from '../lib/pluginComposer';
import { Log, useLog } from './shared';
import './ComposerDemo.css';

type Post = { text: string; background: string | null; photos: string[]; trace: string[] };

const BEGIN: Post = { text: '', background: null, photos: [], trace: [] };
const BACKGROUNDS = ['#f97316', '#2563eb', '#16a34a', '#db2777'];
const MAX_BG_TEXT = 130;

/**
 * Mô phỏng cách đăng ký của bản gốc (không phải code của Facebook): đăng ký CHÍNH hàm
 * plugin truyền vào, deps là hàm đó. Hàm inline đổi mỗi render, nên bị gỡ rồi thêm lại ở cuối.
 */
function usePluginLikeOriginal(parts: PluginParts<Post>) {
  const store = useContext(ComposerContext) as ComposerStore<Post>;
  const { reducer, isAltered } = parts;
  useEffect(() => {
    if (!reducer) return;
    const release = store.reducers.add(reducer);
    return release;
  }, [store, reducer]);
  useEffect(() => {
    if (!isAltered) return;
    // như bản gốc: chỉ thêm vào Map, isDirty được tính lại ở lần dispatch sau
    return store.checkers.add(isAltered);
  }, [store, isAltered]);
}

function useRegister(parts: PluginParts<Post>, original: boolean) {
  // gọi cả hai hook để thứ tự hook không đổi; chỉ một bên được bật
  usePlugin(original ? {} : parts);
  usePluginLikeOriginal(original ? parts : {});
}

function TextPlugin({ original }: { original: boolean }) {
  const { state, dispatch } = useComposer<Post>();
  // state riêng của plugin: focus/blur chỉ làm RIÊNG plugin này render lại
  const [focused, setFocused] = useState(false);
  useRegister(
    {
      reducer: (s, a) => {
        if (a.type === 'text') return { ...s, text: String(a.value) };
        if (a.type === 'trace') return { ...s, trace: [...s.trace, 'chữ'] };
        return s;
      },
      isAltered: (b, c) => b.text !== c.text,
      validate: (s) =>
        s.text.trim() === '' && s.photos.length === 0 ? 'Bài viết đang trống' : null,
    },
    original,
  );
  return (
    <div>
      <textarea
        className='cp-text'
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder='Bạn đang nghĩ gì?'
        value={state.text}
        onChange={(e) => dispatch({ type: 'text', value: e.target.value })}
        style={state.background ? { background: state.background, color: '#fff' } : undefined}
        aria-label='Nội dung bài viết'
      />
      <div className='muted cp-count'>{focused ? `${state.text.length} ký tự` : '\u00a0'}</div>
    </div>
  );
}

function BackgroundPlugin({ original }: { original: boolean }) {
  const { state, dispatch } = useComposer<Post>();
  useRegister(
    {
      reducer: (s, a) => {
        if (a.type === 'bg') return { ...s, background: (a.value as string | null) ?? null };
        // chữ dài quá thì nền màu tự tắt (giống luật "không đủ điều kiện" của Facebook)
        if (a.type === 'text' && s.background && s.text.length > MAX_BG_TEXT)
          return { ...s, background: null };
        if (a.type === 'trace') return { ...s, trace: [...s.trace, 'nền'] };
        return s;
      },
      isAltered: (b, c) => b.background !== c.background,
    },
    original,
  );
  const disabled = state.text.length > MAX_BG_TEXT;
  return (
    <div className='cp-swatches' role='group' aria-label='Nền màu'>
      <button
        aria-pressed={state.background == null}
        onClick={() => dispatch({ type: 'bg', value: null })}
      >
        Không nền
      </button>
      {BACKGROUNDS.map((c) => (
        <button
          key={c}
          className='cp-swatch'
          style={{ background: c }}
          disabled={disabled}
          aria-label={`Nền ${c}`}
          aria-pressed={state.background === c}
          onClick={() => dispatch({ type: 'bg', value: c })}
        />
      ))}
      {disabled && (
        <span className='muted'>Chữ dài hơn {MAX_BG_TEXT} ký tự thì không dùng nền màu</span>
      )}
    </div>
  );
}

function PhotoPlugin({
  ask,
  original,
}: {
  ask: (q: string) => Promise<boolean>;
  original: boolean;
}) {
  const { state, dispatch } = useComposer<Post>();
  useRegister(
    {
      reducer: (s, a) => {
        if (a.type === 'photo/add')
          return { ...s, photos: [...s.photos, `ảnh ${s.photos.length + 1}`] };
        if (a.type === 'photo/clear') return { ...s, photos: [] };
        if (a.type === 'trace') return { ...s, trace: [...s.trace, 'ảnh'] };
        return s;
      },
      isAltered: (b, c) => b.photos.length !== c.photos.length,
      beforeSubmit: (s) =>
        s.photos.length > 0 ? Promise.resolve(true) : ask('Đăng mà không kèm ảnh?'),
    },
    original,
  );
  return (
    <div className='toolbar'>
      <button onClick={() => dispatch({ type: 'photo/add' })}>+ Thêm ảnh</button>
      <button
        onClick={() => dispatch({ type: 'photo/clear' })}
        disabled={state.photos.length === 0}
      >
        Bỏ ảnh
      </button>
      <span className='muted'>{state.photos.join(', ') || 'chưa có ảnh'}</span>
    </div>
  );
}

function Status({ log }: { log: ReturnType<typeof useLog> }) {
  const { state, isDirty, errors, dispatch, store } = useComposer<Post>();
  useWarnBeforeUnload(isDirty);
  return (
    <>
      <div className='stats'>
        <div className='stat'>
          <b data-testid='dirty'>{isDirty ? 'có' : 'không'}</b>
          <span>đã sửa (isDirty)</span>
        </div>
        <div className='stat'>
          <b data-testid='reducers'>{store.reducers.size}</b>
          <span>reducer đang đăng ký</span>
        </div>
        <div className='stat'>
          <b data-testid='trace'>{state.trace.length ? state.trace.join(' → ') : '—'}</b>
          <span>thứ tự reducer chạy</span>
        </div>
      </div>
      {errors.length > 0 && <p className='err'>Chặn đăng: {errors.join('; ')}</p>}
      <div className='toolbar'>
        <button
          onClick={() => {
            dispatch({ type: 'trace-reset' });
            store.dispatch({ type: 'trace' });
          }}
        >
          Xem thứ tự reducer
        </button>
        <button
          className='primary'
          onClick={async () => {
            const result = await store.submit();
            if (result.status === 'invalid')
              log.add(`không đăng: ${result.errors.join('; ')}`, 'err');
            else if (result.status === 'halted')
              log.add('một pre-submit hook đã dừng việc đăng', 'warn');
            else
              log.add(`đã đăng: "${result.state.text}" (${result.state.photos.length} ảnh)`, 'ok');
          }}
        >
          Đăng
        </button>
      </div>
    </>
  );
}

export default function ComposerDemo() {
  const store = useComposerStore<Post>(BEGIN);
  const log = useLog(20);
  const [showBg, setShowBg] = useState(true);
  const [original, setOriginal] = useState(false);
  const [question, setQuestion] = useState<string | null>(null);
  const answer = useRef<(ok: boolean) => void>(() => {});

  // reducer "trace-reset" do composer tự giữ để xoá vết trước mỗi lần xem thứ tự
  useEffect(
    () => store.reducers.add((s, a) => (a.type === 'trace-reset' ? { ...s, trace: [] } : s)),
    [store],
  );

  const ask = (q: string) =>
    new Promise<boolean>((resolve) => {
      setQuestion(q);
      answer.current = (ok) => {
        setQuestion(null);
        resolve(ok);
      };
    });

  return (
    <ComposerContext.Provider value={store}>
      <div className='page composer-demo'>
        <h1>Composer dạng plugin</h1>
        <p className='hint'>
          Ba plugin (chữ, nền màu, ảnh) tự đăng ký reducer, dirty checker, validator và pre-submit
          hook. Composer không biết plugin nào tồn tại.
        </p>
        <div className='toolbar'>
          <label>
            <input type='checkbox' checked={showBg} onChange={(e) => setShowBg(e.target.checked)} />{' '}
            Gắn plugin nền màu
          </label>
          <label>
            <input
              type='checkbox'
              checked={original}
              onChange={(e) => setOriginal(e.target.checked)}
            />{' '}
            Đăng ký kiểu bản gốc (hàm inline)
          </label>
        </div>
        <div className='card cp-card'>
          <TextPlugin key={`t${original}`} original={original} />
          {showBg && <BackgroundPlugin key={`b${original}`} original={original} />}
          <PhotoPlugin key={`p${original}`} ask={ask} original={original} />
        </div>
        <Status log={log} />
        <Log lines={log.lines} />
        {question && (
          <div className='backdrop'>
            <div className='dialog' role='dialog' aria-modal='true' aria-label='Xác nhận'>
              <p>{question}</p>
              <div className='toolbar'>
                <button className='primary' onClick={() => answer.current(true)}>
                  Vẫn đăng
                </button>
                <button onClick={() => answer.current(false)}>Quay lại</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ComposerContext.Provider>
  );
}
