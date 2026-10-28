import { useState } from 'react';
import { closestMatch, damerauDistance, osaDistance, withinDistance } from '../lib/editDistance';
import { alea } from '../lib/seededRandom';
import { Stat } from './shared';
import './EditDistanceDemo.css';

export default function EditDistanceDemo() {
  return (
    <div className='page ed-demo'>
      <h1>Damerau-Levenshtein và tự sửa tên gõ sai</h1>
      <p className='hint'>
        Khoảng cách sửa chuỗi đếm số thao tác chèn, xoá, thay, hoán vị hai ký tự kề nhau. Facebook dùng nó để đoán
        bang Mỹ từ chữ người dùng gõ ở form thanh toán.
      </p>
      <DistanceSection />
      <AutocorrectSection />
      <BandSection />
    </div>
  );
}

function DistanceSection() {
  const [a, setA] = useState('ca');
  const [b, setB] = useState('abc');
  const osa = osaDistance(a, b);
  const full = damerauDistance(a, b);
  return (
    <section className='card ed-card'>
      <h2>1. OSA (bản Facebook) và Damerau-Levenshtein đầy đủ</h2>
      <div className='toolbar'>
        <input value={a} onChange={(e) => setA(e.target.value)} aria-label='chuỗi a' data-testid='ed-a' />
        <span>→</span>
        <input value={b} onChange={(e) => setB(e.target.value)} aria-label='chuỗi b' data-testid='ed-b' />
      </div>
      <div className='toolbar'>
        {[
          ['ca', 'abc'],
          ['teh', 'the'],
          ['kitten', 'sitting'],
          ['Hà Nội', 'Ha Noi'],
          ['👍🏽ok', 'ok👍🏽'],
        ].map(([x, y]) => (
          <button key={x + y} onClick={() => (setA(x), setB(y))}>
            {x} → {y}
          </button>
        ))}
      </div>
      <div className='stats'>
        <Stat label='OSA' value={<output data-testid='ed-osa'>{osa}</output>} />
        <Stat label='Damerau đầy đủ' value={<output data-testid='ed-full'>{full}</output>} />
      </div>
      {osa !== full && (
        <p className='hint warn'>
          OSA không cho sửa tiếp một cặp đã hoán vị: &quot;ca&quot; → &quot;ac&quot; (hoán vị) → &quot;abc&quot; (chèn b) là 2
          bước, nhưng OSA phải tính 3.
        </p>
      )}
    </section>
  );
}

const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
const CANDIDATES = Object.entries(US_STATES).map(([value, label]) => ({ value, label }));

const expandPrefix = (s: string) =>
  s.toLowerCase().replace(/^columbia/, 'district of columbia').replace(/^n\.?\s+/, 'north ').replace(/^s\.?\s+/, 'south ');

/** Chép lại logic USAState trong CommerceInputNormalizer: ngưỡng tuyệt đối < 5, không có thì lấy 2 chữ đầu. */
function facebookUSAState(input: string) {
  let a = input;
  if (a.length > 2) {
    a = expandPrefix(a);
    let best = 1000;
    let code: string | null = null;
    for (const [k, name] of Object.entries(US_STATES)) {
      const f = name.toLowerCase();
      let d = osaDistance(a, f);
      if (a.charAt(0) !== f.charAt(0)) d++;
      if (d === 0) {
        best = 0;
        code = k;
        break;
      }
      if (d < best) {
        best = d;
        code = k;
      }
    }
    if (best < 5 && code) a = code;
  }
  return a.replace(/[^a-zA-Z]/, '').substr(0, 2).toUpperCase();
}

const SAMPLES = ['Calfornia', 'new yrok', 'n. carolina', 'texs', 'misisipi', 'carolina', 'york', 'Hà Nội', 'vietnam', 'dakota'];

function AutocorrectSection() {
  const [text, setText] = useState('york');
  const rows = [text, ...SAMPLES.filter((s) => s !== text)];
  return (
    <section className='card ed-card'>
      <h2>2. Đoán bang Mỹ: bản gốc và bản viết lại</h2>
      <p className='hint'>
        Bản gốc lấy bang có khoảng cách nhỏ nhất (+1 nếu khác chữ cái đầu), chấp nhận nếu &lt; 5 lỗi bất kể độ dài
        từ. Bản viết lại cho tối đa ~1 lỗi trên 3 ký tự của tên bang, không đủ gần thì trả &quot;không chắc&quot;.
      </p>
      <div className='toolbar'>
        <label>
          Gõ bang:{' '}
          <input value={text} onChange={(e) => setText(e.target.value)} data-testid='ed-state' />
        </label>
      </div>
      <div className='ed-scroll'>
        <table className='ed-table' data-testid='ed-table'>
          <thead>
            <tr>
              <th>Người dùng gõ</th>
              <th>Facebook</th>
              <th>Viết lại</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((input, i) => {
              const fb = facebookUSAState(input);
              const match = closestMatch(expandPrefix(input), CANDIDATES);
              const fbName = US_STATES[fb];
              return (
                <tr key={input + i} className={i === 0 ? 'ed-current' : ''}>
                  <td>{input || '—'}</td>
                  <td>
                    <b>{fb || '—'}</b> <small className='muted'>{fbName ?? '(không phải mã bang)'}</small>
                  </td>
                  <td>
                    {match ? (
                      <>
                        <b className='ok'>{match.value}</b>{' '}
                        <small className='muted'>
                          {match.label}, {match.distance} lỗi
                        </small>
                      </>
                    ) : (
                      <span className='warn'>không chắc, hỏi lại</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function randomText(random: () => number, n: number) {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(97 + Math.floor(random() * 26));
  return s;
}

function BandSection() {
  const [result, setResult] = useState<string | null>(null);
  const run = () => {
    const random = alea('band');
    const n = 3000;
    const a = randomText(random, n);
    // b = a với 3 lỗi gõ
    const b = a.slice(0, 500) + 'x' + a.slice(501, 1500) + a.slice(1501, 2600) + 'y' + a.slice(2600);
    let t = performance.now();
    const d = osaDistance(a, b);
    const full = performance.now() - t;
    t = performance.now();
    const ok3 = withinDistance(a, b, 3);
    const ok2 = withinDistance(a, b, 2);
    const band = performance.now() - t;
    setResult(
      `Hai chuỗi ${n} ký tự: bảng đầy đủ ra ${d} (${full.toFixed(1)}ms, ${(n * n).toLocaleString('vi-VN')} ô); ` +
        `dải chéo: ≤3 lỗi? ${ok3 ? 'có' : 'không'}, ≤2 lỗi? ${ok2 ? 'có' : 'không'} (cả hai ${band.toFixed(1)}ms, ~${(7 * n).toLocaleString('vi-VN')} ô mỗi lần)`,
    );
  };
  return (
    <section className='card ed-card'>
      <h2>3. Chỉ hỏi &quot;có ≤ k lỗi không&quot;</h2>
      <p className='hint'>
        Khi chỉ cần biết khoảng cách có vượt k không, chỉ ô có |i − j| ≤ k mới quan trọng: O(k·n) thay vì O(m·n).
        Relay cổ điển (testEditDistance) dùng ý này để gợi ý &quot;bạn có định viết…&quot;.
      </p>
      <button className='primary' onClick={run}>
        Chạy so sánh
      </button>
      {result && (
        <p data-testid='ed-band' className='ed-result'>
          {result}
        </p>
      )}
    </section>
  );
}
