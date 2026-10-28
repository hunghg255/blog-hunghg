import { useMemo, useState } from 'react';
import { parseQuery, serializeQuery, toJSON } from '../lib/querySerializer';
import { makeSandboxProto, parseFbStyle, parseNaive } from './querySerializerFbStyle';
import './QuerySerializerDemo.css';

const PRESETS = [
  { label: 'Lồng + mảng', q: 'user[name]=An&user[tags][]=js&user[tags][]=css&page=2' },
  { label: '__proto__', q: '__proto__[isAdmin]=1&name=An' },
  { label: 'constructor.prototype', q: 'constructor[prototype][isAdmin]=1' },
  { label: 'a[__proto__]', q: 'a[__proto__][isAdmin]=1' },
  { label: 'Chỉ số khổng lồ', q: 'a[99999999]=x&b[5]=y' },
  { label: 'Key mã hoá', q: 'a%5Bb%5D=1&a%5Bb%20c%5D=2' },
  { label: 'Gán lên chuỗi', q: 'a=1&a[b][c]=2&z=3' },
  { label: '[] giữa object', q: 'a[x]=1&a[][y]=2' },
];

/** JSON hoá có đánh dấu key U+1F756 cho dễ thấy */
function show(value: unknown) {
  return JSON.stringify(value, null, 2) ?? 'undefined';
}

export default function QuerySerializerDemo() {
  const [query, setQuery] = useState(PRESETS[1].q);

  const result = useMemo(() => {
    const proto = makeSandboxProto();
    let naive: Record<string, unknown> = {};
    let naiveError = '';
    try {
      naive = parseNaive(query, proto);
    } catch (e) {
      naiveError = (e as Error).message;
    }
    // object mới, "không liên quan", tạo từ cùng prototype: có bị nhiễm không?
    const victim = Object.create(proto) as Record<string, unknown>;
    const polluted = Object.keys(proto).filter((k) => k !== 'constructor');
    const safe = parseQuery(query);
    let fb: unknown;
    try {
      fb = parseFbStyle(query);
    } catch (e) {
      fb = `ném ${(e as Error).name}: ${(e as Error).message}`;
    }
    return {
      safe,
      fb,
      naive,
      naiveError,
      polluted,
      victimIsAdmin: victim.isAdmin,
      roundTrip: serializeQuery(safe),
    };
  }, [query]);

  return (
    <div className='page qs'>
      <h1>Query kiểu PHP và prototype pollution</h1>
      <p className='hint'>
        Ba parser đọc cùng một query. Bản “ngây thơ” chạy trên một prototype hộp cát riêng của demo, nên trang này không bị
        nhiễm thật; bạn vẫn thấy một object mới tạo ra đột nhiên có <code>isAdmin</code>.
      </p>
      <div className='toolbar'>
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => setQuery(p.q)} className={query === p.q ? 'primary' : ''}>
            {p.label}
          </button>
        ))}
      </div>
      <input type='text' value={query} onChange={(e) => setQuery(e.target.value)} aria-label='Query string' spellCheck={false} />

      <div className='qs-verdict'>
        {result.polluted.length > 0 ? (
          <span className='badge qs-bad' data-testid='pollution'>
            Bản ngây thơ làm nhiễm prototype: {result.polluted.join(', ')} · object mới có isAdmin ={' '}
            {String(result.victimIsAdmin)}
          </span>
        ) : (
          <span className='badge qs-good' data-testid='pollution'>
            Prototype sạch{result.naiveError ? ` (bản ngây thơ ném lỗi: ${result.naiveError})` : ''}
          </span>
        )}
      </div>

      <div className='qs-cols'>
        <section className='card'>
          <h2>parseQuery (bản viết lại)</h2>
          <pre data-testid='safe'>{toJSON(result.safe)}</pre>
          <p className='muted'>serialize lại:</p>
          <pre>{result.roundTrip || '(rỗng)'}</pre>
        </section>
        <section className='card'>
          <h2>Kiểu Facebook (lính canh 🝖)</h2>
          <pre data-testid='fb'>{show(result.fb)}</pre>
        </section>
        <section className='card'>
          <h2>Ngây thơ: obj[k] ||= {'{}'}</h2>
          <pre data-testid='naive'>{show(result.naive)}</pre>
        </section>
      </div>
    </div>
  );
}
