import { useState } from 'react';
import { satisfies } from '../lib/semverRange';
import { Stat } from './shared';
import './SemverRangeDemo.css';

// ---------- mô phỏng hành vi VersionRange gốc (không phải mã gốc) ----------

function cmpPart(a: string, b: string): number {
  const x = parseInt(/^(\d*)/.exec(a)![1], 10);
  const y = parseInt(/^(\d*)/.exec(b)![1], 10);
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x > y ? 1 : -1;
  return a > b ? 1 : a < b ? -1 : 0; // còn lại so chuỗi: "0-rc" > "0"
}

function cmp(version: string[], range: string[]): number {
  const a = version.slice();
  const b = range.slice();
  while (a.length < b.length) a.push('0');
  b.forEach((part, i) => {
    if (/^[x*]$/i.test(part)) {
      a[i] = b[i] = '0';
      if (part === '*' && i === b.length - 1) a.fill('0', i);
    }
  });
  while (b.length < a.length) b.push('0');
  for (let i = 0; i < b.length; i++) {
    const r = cmpPart(a[i], b[i]);
    if (r) return r;
  }
  return 0;
}

function fbSimple(range: string, version: string): boolean {
  range = range.trim();
  if (range === '') return true;
  const v = version.split('.');
  const parts = range.split('.');
  const m = /^(<=|<|=|>=|~>|~|>|)?\s*(.+)/.exec(parts[0]);
  if (!m) throw new Error('range sai');
  const op = m[1] ?? '';
  const r = [m[2], ...parts.slice(1)]; // ">=1.2 <2" thành ["1", "2 <2"]: phần sau dấu cách bị nuốt
  const c = cmp(v, r);
  switch (op) {
    case '<':
      return c === -1;
    case '<=':
      return c <= 0;
    case '>=':
      return c >= 0;
    case '>':
      return c === 1;
    case '~':
    case '~>': {
      const upper = r.slice();
      if (upper.length > 1) upper.pop();
      const n = parseInt(upper[upper.length - 1], 10);
      if (Number.isFinite(n)) upper[upper.length - 1] = String(n + 1);
      return c >= 0 && cmp(v, upper) === -1;
    }
    default:
      return c === 0; // "^1.2.0" rơi vào đây: so "1" với "^1" → luôn false
  }
}

function fbStyleContains(range: string, version: string): boolean {
  const ors = range.trim().split(/\|\|/);
  if (ors.length > 1) return ors.some((r) => fbStyleContains(r, version));
  const h = ors[0].trim().split(/\s+-\s+/);
  if (h.length > 2) throw new Error('quá nhiều dấu gạch nối');
  return h.length === 1 ? fbSimple(h[0], version) : fbSimple('>=' + h[0], version) && fbSimple('<=' + h[1], version);
}

// ---------- demo ----------

const CASES: [string, string, string][] = [
  ['^1.2.0', '1.5.0', 'không có ^, âm thầm false'],
  ['>=1.2.0 <2.0.0', '3.0.0', 'dấu cách (AND) bị bỏ qua'],
  ['>=1.0.0', '1.0.0-rc.1', 'rc lớn hơn bản chính thức?'],
  ['<2.0.0', '2.0.0-beta.1', 'beta của 2.0 vẫn nằm ngoài'],
  ['~1.2', '1.3.0', '~ kiểu Ruby (<2) hay npm (<1.3)'],
  ['1.x', '1.5.3', 'x không phủ phần sau'],
  ['1.0.0 - 2.0', '2.0.5', 'cận trên thiếu số'],
  ['<=1.2', '1.2.5', '<=1.2 nghĩa là <1.3.0'],
  ['14 - 15', '15.4', 'kiểu UserAgent: Safari 14 tới 15'],
  ['>= 100', '120.0.6099.109', 'version Chrome 4 số, cả hai đều đúng'],
  ['1.2.x || >=3', '3.1.0', 'cả hai đều đúng'],
  ['~1.2.3', '1.2.9', 'cả hai đều đúng'],
];

function run(fn: () => boolean): string {
  try {
    return fn() ? 'true' : 'false';
  } catch (e) {
    return `lỗi: ${(e as Error).message}`;
  }
}

export default function SemverRangeDemo() {
  const [range, setRange] = useState('>=1.2.0 <2.0.0');
  const [version, setVersion] = useState('3.0.0');
  const rows = CASES.map(([r, v, note]) => ({ r, v, note, fb: run(() => fbStyleContains(r, v)), mine: run(() => satisfies(v, r, { loose: true })) }));
  const diff = rows.filter((x) => x.fb !== x.mine).length;

  return (
    <div className='page sv-demo'>
      <h1>Tự cài semver range</h1>
      <section className='card sv-section'>
        <h2>Thử range của bạn</h2>
        <p className='hint'>
          Facebook dùng VersionRange cho <code>UserAgent.isBrowser('Chrome &gt;= 100')</code>, nên version có thể có
          2 hoặc 4 số. Bản viết lại chạy với <code>loose: true</code>.
        </p>
        <div className='sv-form'>
          <label>
            Range
            <input value={range} onChange={(e) => setRange(e.target.value)} />
          </label>
          <label>
            Version
            <input value={version} onChange={(e) => setVersion(e.target.value)} />
          </label>
        </div>
        <div className='stats'>
          <Stat
            label='kiểu VersionRange (Facebook)'
            value={<output data-testid='sv-fb'>{run(() => fbStyleContains(range, version))}</output>}
          />
          <Stat
            label='satisfies (bản viết lại)'
            value={<output data-testid='sv-mine'>{run(() => satisfies(version, range, { loose: true }))}</output>}
          />
          <Stat
            label='có includePrerelease'
            value={<output>{run(() => satisfies(version, range, { loose: true, includePrerelease: true }))}</output>}
          />
        </div>
      </section>
      <section className='card sv-section'>
        <h2>Các ca hay gặp</h2>
        <div className='stats'>
          <Stat label='ca hai bản trả lời khác nhau' value={<output data-testid='sv-diff'>{diff}</output>} />
        </div>
        <div className='sv-scroll'>
          <table className='sv-table'>
            <thead>
              <tr>
                <th>Range</th>
                <th>Version</th>
                <th>Kiểu FB</th>
                <th>Viết lại</th>
                <th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr
                  key={x.r + x.v}
                  className={x.fb !== x.mine ? 'diff' : ''}
                  onClick={() => {
                    setRange(x.r);
                    setVersion(x.v);
                  }}
                >
                  <td>
                    <code>{x.r}</code>
                  </td>
                  <td>
                    <code>{x.v}</code>
                  </td>
                  <td className={x.fb !== x.mine ? 'err' : ''}>{x.fb}</td>
                  <td className='ok'>{x.mine}</td>
                  <td className='note'>{x.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className='hint'>Bấm một dòng để nạp vào ô thử ở trên.</p>
      </section>
    </div>
  );
}
