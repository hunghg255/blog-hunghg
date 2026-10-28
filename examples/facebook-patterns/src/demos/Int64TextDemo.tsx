import { useMemo, useState } from 'react';
import {
  decodeUtf8,
  parseInt64,
  parseJsonKeepBigInts,
  segment,
  toHiLo,
  type CodePointRange,
  type NullPolicy,
} from '../lib/int64Text';
import { Stat } from './shared';
import './Int64TextDemo.css';

// ---------- mô phỏng hành vi bản gốc (không phải mã gốc) ----------

/** Long.fromString: cắt từng khúc 8 chữ số, parseInt từng khúc, tràn thì quấn vòng. */
function fbStyleFromString(text: string): string {
  if (text.length === 0) throw new Error('number format error: empty string');
  if (text[0] === '-') return String(BigInt.asIntN(64, -BigInt(fbStyleFromString(text.slice(1)))));
  if (text.includes('-')) throw new Error('number format error: interior "-"');
  let acc = 0n;
  for (let i = 0; i < text.length; i += 8) {
    const part = text.slice(i, i + 8);
    const n = parseInt(part, 10); // "12a45" → 12, "abc" → NaN
    acc = BigInt.asIntN(64, acc * 10n ** BigInt(part.length) + BigInt(Number.isNaN(n) ? 0 : n));
  }
  return String(acc);
}

class Stuck extends Error {}

/** StringEncoding gốc: nhận cả dạng 5–6 byte và overlong, "ignore" quên tăng chỉ số. */
function fbStyleUtf8(a: Uint8Array, nulls: NullPolicy): string {
  const cps: number[] = [];
  let i = 0;
  let guard = 0;
  while (i < a.length) {
    if (++guard > 10_000) throw new Stuck('kẹt vòng lặp vô hạn (demo dừng sau 10.000 vòng)');
    let cp = a[i];
    let len: number;
    if (cp >> 7 === 0) len = 1;
    else if (cp >> 5 === 6) (cp &= 31), (len = 2);
    else if (cp >> 4 === 14) (cp &= 15), (len = 3);
    else if (cp >> 3 === 30) (cp &= 7), (len = 4);
    else if (cp >> 2 === 62) (cp &= 3), (len = 5);
    else if (cp >> 1 === 126) (cp &= 1), (len = 6);
    else throw new Error('UTF-8: byte đầu không nhận ra');
    if (i + len > a.length) throw new Error('UTF-8: thiếu byte');
    for (let k = 1; k < len; k++) {
      if (a[i + k] >> 6 !== 2) throw new Error('UTF-8: byte tiếp theo sai');
      cp = (cp << 6) | (a[i + k] & 63);
    }
    if (cp > 0x10ffff) throw new Error('UTF-8: code point > 0x10FFFF');
    if (cp === 0) {
      if (nulls === 'error') throw new Error('UTF-8: có NUL');
      if (nulls === 'ignore') continue; // không tăng i
      if (nulls === 'truncate') break;
    }
    cps.push(cp);
    i += len;
  }
  return String.fromCodePoint(...cps);
}

/** Decoder gốc thử utf-8, lỗi thì thử utf-16 (little-endian như Uint16Array trên máy thường). */
function fbStyleDecode(bytes: Uint8Array, nulls: NullPolicy): { text: string; via: string } {
  try {
    return { text: fbStyleUtf8(bytes, nulls), via: 'utf-8' };
  } catch (e) {
    if (e instanceof Stuck) throw e;
    if (bytes.length % 2 !== 0) throw e;
    const units: number[] = [];
    for (let i = 0; i < bytes.length; i += 2) units.push(bytes[i] | (bytes[i + 1] << 8));
    return { text: String.fromCharCode(...units), via: 'utf-16 (dự phòng)' };
  }
}

// ---------- tiện ích hiển thị ----------

const codePoints = (s: string) =>
  [...s].map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(' ') || '(rỗng)';

function run(fn: () => string): { ok: boolean; text: string } {
  try {
    return { ok: true, text: fn() };
  } catch (e) {
    return { ok: false, text: (e as Error).message };
  }
}

// ---------- 1. Int64 ----------

const ID_PRESETS = ['10158012345678901', '9223372036854775808', '12a45', '-42'];

function Int64Section() {
  const [id, setId] = useState(ID_PRESETS[0]);
  const viaNumber = run(() => String(Number(id)));
  const fb = run(() => fbStyleFromString(id));
  const strict = run(() => {
    const n = parseInt64(id);
    const { high, low } = toHiLo(n);
    return `${n}  (high ${high}, low ${low})`;
  });
  const json = `{"post_id":${/^-?\d+$/.test(id) ? id : 0}}`;
  const parsed = run(() => JSON.stringify(JSON.parse(json)));
  const kept = run(() => JSON.stringify(parseJsonKeepBigInts(json)));

  return (
    <section className='card i6-section'>
      <h2>1. ID 64-bit</h2>
      <div className='toolbar'>
        <input aria-label='ID' value={id} onChange={(e) => setId(e.target.value.trim())} className='i6-input' />
        {ID_PRESETS.map((p) => (
          <button key={p} onClick={() => setId(p)}>
            {p}
          </button>
        ))}
      </div>
      <table className='i6-table'>
        <tbody>
          <tr>
            <th>Number(id)</th>
            <td>
              <output data-testid='i6-num' className={viaNumber.text === id ? 'ok' : 'err'}>
                {viaNumber.text}
              </output>
            </td>
          </tr>
          <tr>
            <th>Kiểu Long.fromString</th>
            <td>
              <output data-testid='i6-fb' className={fb.ok && fb.text === id ? 'ok' : 'err'}>
                {fb.text}
              </output>
            </td>
          </tr>
          <tr>
            <th>parseInt64 (BigInt, chặt)</th>
            <td>
              <output data-testid='i6-big' className={strict.ok ? 'ok' : 'warn'}>
                {strict.text}
              </output>
            </td>
          </tr>
          <tr>
            <th>JSON.parse({json})</th>
            <td>
              <output className={parsed.text.includes(id) ? 'ok' : 'err'}>{parsed.text}</output>
            </td>
          </tr>
          <tr>
            <th>Giữ số lớn ở dạng chuỗi</th>
            <td>
              <output>{kept.text}</output>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

// ---------- 2. UTF-8 ----------

const BYTE_PRESETS: [string, string][] = [
  ['Tiếng Việt', '56 69 E1 BB 87 74'],
  ['Overlong "/"', '2E 2E C0 AF 65 74 63'],
  ['Overlong 5 byte', 'F8 80 80 80 AF'],
  ['Surrogate lẻ', 'ED A0 80'],
  ['Latin-1 "café"', '63 61 66 E9'],
  ['Có NUL', '61 00 62'],
];

function Utf8Section() {
  const [hex, setHex] = useState(BYTE_PRESETS[1][1]);
  const [nulls, setNulls] = useState<NullPolicy>('ignore');
  const bytes = useMemo(() => {
    const parts = hex.split(/[\s,]+/).filter(Boolean);
    if (!parts.every((p) => /^[0-9a-f]{1,2}$/i.test(p))) return null;
    return Uint8Array.from(parts.map((p) => parseInt(p, 16)));
  }, [hex]);

  const rows = bytes
    ? [
        {
          name: 'Kiểu StringEncoding',
          id: 'u8-fb',
          ...run(() => {
            const r = fbStyleDecode(bytes, nulls);
            return `${JSON.stringify(r.text)}  ${codePoints(r.text)}  [${r.via}]`;
          }),
        },
        {
          name: 'decodeUtf8 (fatal)',
          id: 'u8-strict',
          ...run(() => {
            const t = decodeUtf8(bytes, { fatal: true, nulls });
            return `${JSON.stringify(t)}  ${codePoints(t)}`;
          }),
        },
        {
          name: 'decodeUtf8 (thay U+FFFD)',
          id: 'u8-lenient',
          ...run(() => {
            const t = decodeUtf8(bytes, { nulls });
            return `${JSON.stringify(t)}  ${codePoints(t)}`;
          }),
        },
        {
          name: 'TextDecoder fatal',
          id: 'u8-td',
          ...run(() => {
            const t = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            return `${JSON.stringify(t)}  ${codePoints(t)}`;
          }),
        },
      ]
    : [];

  return (
    <section className='card i6-section'>
      <h2>2. Decode bytes thành chữ</h2>
      <div className='toolbar'>
        {BYTE_PRESETS.map(([label, h]) => (
          <button key={label} onClick={() => setHex(h)}>
            {label}
          </button>
        ))}
      </div>
      <div className='toolbar'>
        <input aria-label='Bytes dạng hex' value={hex} onChange={(e) => setHex(e.target.value)} className='i6-input' />
        <label>
          NUL:{' '}
          <select value={nulls} onChange={(e) => setNulls(e.target.value as NullPolicy)}>
            <option value='error'>error</option>
            <option value='ignore'>ignore</option>
            <option value='truncate'>truncate</option>
            <option value='include'>include</option>
          </select>
        </label>
      </div>
      {!bytes && <p className='hint'>Nhập các byte hex cách nhau bởi dấu cách.</p>}
      <table className='i6-table'>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th>{r.name}</th>
              <td>
                <output data-testid={r.id} className={r.ok ? '' : 'err'}>
                  {r.ok ? r.text : `Lỗi: ${r.text}`}
                </output>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------- 3. Entity ranges ----------

const TEXT = 'Chúc mừng 🎉🎂 sinh nhật Lan 👩🏽‍💻, xem ảnh tại blog';
// server đếm theo code point: "Lan" bắt đầu ở code point 23, "blog" ở 45
const RANGES: CodePointRange<'mention' | 'link'>[] = [
  { offset: 23, length: 3, key: 'mention' },
  { offset: 45, length: 4, key: 'link' },
];

function Render({ parts }: { parts: { text: string; key: 'mention' | 'link' | null }[] }) {
  return (
    <span className='i6-render'>
      {parts.map((p, i) =>
        p.key === 'mention' ? (
          <b key={i} className='i6-mention'>
            {p.text}
          </b>
        ) : p.key === 'link' ? (
          <u key={i} className='i6-link'>
            {p.text}
          </u>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

function RangeSection() {
  const naive = useMemo(() => {
    // dùng thẳng offset code point làm chỉ số UTF-16: lệch sau mỗi emoji
    const parts: { text: string; key: 'mention' | 'link' | null }[] = [];
    let pos = 0;
    for (const r of RANGES) {
      parts.push({ text: TEXT.slice(pos, r.offset), key: null });
      parts.push({ text: TEXT.slice(r.offset, r.offset + r.length), key: r.key });
      pos = r.offset + r.length;
    }
    parts.push({ text: TEXT.slice(pos), key: null });
    return parts;
  }, []);
  const fixed = useMemo(() => segment(TEXT, RANGES), []);
  const label = (parts: typeof naive) =>
    parts
      .filter((p) => p.key)
      .map((p) => p.text)
      .join(' | ');

  return (
    <section className='card i6-section'>
      <h2>3. Offset theo code point</h2>
      <p className='hint'>
        Server gửi range "mention" ở code point 23, "link" ở 45. Chuỗi có {[...TEXT].length} code point nhưng{' '}
        {TEXT.length} đơn vị UTF-16.
      </p>
      <div className='stats'>
        <Stat label='cắt thẳng theo chỉ số JS' value={<output data-testid='er-naive'>{label(naive)}</output>} />
        <Stat label='đổi offset trước khi cắt' value={<output data-testid='er-fixed'>{label(fixed)}</output>} />
      </div>
      <div className='i6-rows'>
        <div>
          Sai: <Render parts={naive} />
        </div>
        <div>
          Đúng: <Render parts={fixed} />
        </div>
      </div>
    </section>
  );
}

export default function Int64TextDemo() {
  return (
    <div className='page i6-demo'>
      <h1>Int64, decode UTF-8, offset code point</h1>
      <Int64Section />
      <Utf8Section />
      <RangeSection />
    </div>
  );
}
