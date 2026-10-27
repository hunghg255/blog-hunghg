import { useMemo, useState } from 'react';
import { fold, highlightMatch, isQueryMatch, type Segment } from '../lib/searchTokenize';
import { fbFlatten, fbHighlight, fbIsQueryMatch } from './searchTokenizeFbStyle';
import './SearchTokenizeDemo.css';

const PEOPLE = [
  'Nguyễn Văn An',
  'Trần Thị Hưng',
  'Lê Hùng',
  'Phạm Đức Anh',
  'Đặng Thu Ơn',
  'Võ Quốc Bảo (Bảo Võ)',
  'Александр Пушкин',
  'Привет Мир',
  'Jürgen Müller',
  'Søren Kierkegaard',
  'Hello – World Café',
  'سلام عليكم',
  'محمد ﻻ',
];

const PRESETS = ['nguyen', 'hung', 'anh ', 'duc', 'privet', 'bao', 'hello', 'jurgen'];

function Highlighted({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.matched ? (
          <mark key={i} className='st-mark'>
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

function ResultList({ query, mode }: { query: string; mode: 'fb' | 'new' }) {
  const rows = PEOPLE.filter((name) =>
    mode === 'fb' ? fbIsQueryMatch(query, name) : isQueryMatch(query, name),
  );
  return (
    <ul className='st-list' data-testid={`list-${mode}`}>
      {rows.length === 0 && <li className='muted'>Không có kết quả</li>}
      {rows.map((name) => (
        <li key={name}>
          <Highlighted segments={mode === 'fb' ? fbHighlight(query, name) : highlightMatch(query, name)} />
        </li>
      ))}
    </ul>
  );
}

export default function SearchTokenizeDemo() {
  const [query, setQuery] = useState('nguyen');
  const flattenRows = useMemo(() => ['Nguyễn', 'Hưng', 'Hùng', 'Đặng', 'Ơn', 'Привет', 'Жуков'], []);

  return (
    <div className='page'>
      <h1>Tìm kiếm gấp dấu</h1>
      <p className='hint'>
        Gõ không dấu như người dùng hay làm. Cột trái mô phỏng cách của Facebook (bảng gấp dấu tra từng
        ký tự, highlight chỉ sau dấu cách). Cột phải là bản viết lại dùng Unicode NFD.
      </p>
      <div className='toolbar'>
        <input
          type='text'
          aria-label='Tìm tên'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Gõ tên…'
        />
        {PRESETS.map((p) => (
          <button key={p} onClick={() => setQuery(p)}>
            {JSON.stringify(p)}
          </button>
        ))}
      </div>

      <div className='split'>
        <div className='card'>
          <h3>Kiểu Facebook</h3>
          <ResultList query={query} mode='fb' />
        </div>
        <div className='card'>
          <h3>Bản viết lại</h3>
          <ResultList query={query} mode='new' />
        </div>
      </div>

      <h3>Gấp chữ</h3>
      <div className='st-table-wrap'>
        <table className='st-table'>
          <thead>
            <tr>
              <th>Gốc</th>
              <th>Facebook</th>
              <th>NFD</th>
            </tr>
          </thead>
          <tbody>
            {flattenRows.map((w) => {
              const fb = fbFlatten(w);
              const nfd = fold(w);
              return (
                <tr key={w}>
                  <td>{w}</td>
                  <td className={/^[a-z]+$/.test(fb) ? 'ok' : 'err'}>{fb}</td>
                  <td className={/^[a-z]+$/.test(nfd) ? 'ok' : 'err'}>{nfd}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
