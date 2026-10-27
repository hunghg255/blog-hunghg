import { useMemo, useState } from 'react';
import { buildMergedText, merge3, type MergeChunk, type Resolution } from '../lib/threeWayMerge';
import { indexLineMerge } from '../lib/threeWayMergeIndex';
import { Stat } from './shared';
import './ThreeWayMergeDemo.css';

const BASE = `pm.test("Status 200", () => {
  pm.response.to.have.status(200);
});
const json = pm.response.json();
pm.test("Có token", () => {
  pm.expect(json.token).to.be.a("string");
});
pm.environment.set("token", json.token);`;

const PRESETS: Record<string, { label: string; ours: string; theirs: string }> = {
  apart: {
    label: 'Hai người sửa hai chỗ khác nhau',
    ours: BASE.replace('status(200)', 'status(201)'),
    theirs:
      '// chạy sau mỗi request đăng nhập\n' +
      BASE.replace('pm.environment.set', 'pm.collectionVariables.set'),
  },
  same: {
    label: 'Cùng sửa một dòng',
    ours: BASE.replace('status(200)', 'status(204)'),
    theirs: BASE.replace('status(200)', 'status(202)'),
  },
  identical: {
    label: 'Cùng thêm một dòng giống nhau',
    ours: BASE + '\nconsole.log("done");',
    theirs: BASE + '\nconsole.log("done");',
  },
};

const KIND_LABEL: Record<Exclude<MergeChunk['kind'], 'same' | 'conflict'>, string> = {
  ours: 'chỉ tôi sửa → lấy của tôi',
  theirs: 'chỉ họ sửa → lấy của họ',
  both: 'hai bên sửa giống nhau',
};

export default function ThreeWayMergeDemo() {
  const [base, setBase] = useState(BASE);
  const [ours, setOurs] = useState(PRESETS.apart.ours);
  const [theirs, setTheirs] = useState(PRESETS.apart.theirs);
  const [choices, setChoices] = useState<Partial<Record<number, Resolution>>>({});

  const result = useMemo(() => {
    try {
      return { ok: true as const, ...merge3(base, ours, theirs) };
    } catch (error) {
      return { ok: false as const, message: (error as Error).message };
    }
  }, [base, ours, theirs]);
  const byIndex = useMemo(() => indexLineMerge(base, ours, theirs), [base, ours, theirs]);
  const merged = result.ok ? buildMergedText(result.chunks, choices) : null;

  const load = (key: string) => {
    setBase(BASE);
    setOurs(PRESETS[key].ours);
    setTheirs(PRESETS[key].theirs);
    setChoices({});
  };
  const edit = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setChoices({});
  };

  return (
    <div className='page twm'>
      <h1>Three-way merge ngay trên trình duyệt</h1>
      <p className='hint'>
        Ba bản của một test script: <b>base</b> (bản gốc chung), <b>của tôi</b> và <b>của họ</b>. Thuật toán
        diff3 tự gộp chỗ chỉ một bên sửa, chỉ hỏi bạn ở chỗ hai bên sửa khác nhau. Sửa thẳng trong ô để thử.
      </p>

      <div className='toolbar'>
        {Object.entries(PRESETS).map(([key, preset]) => (
          <button key={key} onClick={() => load(key)}>
            {preset.label}
          </button>
        ))}
      </div>

      <div className='twm-inputs'>
        <Editor label='base' value={base} onChange={edit(setBase)} />
        <Editor label='của tôi' value={ours} onChange={edit(setOurs)} />
        <Editor label='của họ' value={theirs} onChange={edit(setTheirs)} />
      </div>

      <div className='stats'>
        <Stat label='xung đột (diff3, căn dòng bằng LCS)' value={result.ok ? result.conflicts : '—'} />
        <Stat label='xung đột nếu so theo số thứ tự dòng (kiểu Postman)' value={byIndex.conflicts} />
        <Stat label='dòng nằm trong khối xung đột (kiểu Postman)' value={byIndex.blocks.filter((b) => b.conflict).reduce((n, b) => n + b.to - b.from, 0)} />
        <Stat label='xung đột chưa chọn' value={merged?.unresolved ?? '—'} />
      </div>

      {!result.ok ? (
        <p className='err'>{result.message}</p>
      ) : (
        <div className='twm-chunks'>
          {result.chunks.map((chunk, i) =>
            chunk.kind === 'same' ? (
              <pre key={i} className='twm-same'>
                {chunk.lines.join('\n') || ' '}
              </pre>
            ) : chunk.kind === 'conflict' ? (
              <div key={i} className='twm-conflict'>
                <div className='twm-sides'>
                  <Side title='của tôi' lines={chunk.ours} />
                  <Side title='của họ' lines={chunk.theirs} />
                </div>
                <div className='toolbar' role='group' aria-label={`Chọn cho xung đột #${chunk.id + 1}`}>
                  {(['ours', 'theirs', 'both', 'base'] as const).map((choice) => (
                    <button
                      key={choice}
                      className={choices[chunk.id] === choice ? 'primary' : ''}
                      aria-pressed={choices[chunk.id] === choice}
                      onClick={() => setChoices((prev) => ({ ...prev, [chunk.id]: choice }))}
                    >
                      {{ ours: 'Giữ của tôi', theirs: 'Giữ của họ', both: 'Giữ cả hai', base: 'Về bản gốc' }[choice]}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div key={i} className={`twm-auto twm-${chunk.kind}`}>
                <span className='twm-tag'>{KIND_LABEL[chunk.kind]}</span>
                <pre>{chunk.lines.join('\n') || '(xoá dòng)'}</pre>
              </div>
            ),
          )}
        </div>
      )}

      <h2>Kết quả</h2>
      <pre className='twm-output' data-testid='merged'>
        {merged?.text}
      </pre>
    </div>
  );
}

function Editor({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className='twm-editor'>
      <span>{label}</span>
      <textarea value={value} spellCheck={false} rows={9} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Side({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div>
      <span className='twm-tag'>{title}</span>
      <pre>{lines.join('\n') || '(xoá)'}</pre>
    </div>
  );
}
