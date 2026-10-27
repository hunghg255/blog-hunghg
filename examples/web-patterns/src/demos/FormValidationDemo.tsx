import { useMemo, useState } from 'react';
import {
  emptyRequired,
  passwordStrength,
  useRequiredFields,
  validateSignup,
  type FieldDef,
  type RequiredFields,
  type SignupErrors,
  type SignupValues,
} from '../lib/formValidation';
import { Log, useLog } from './shared';
import './FormValidationDemo.css';

const EMPTY: SignupValues = { name: '', email: '', password: '', birth: { day: '', month: '', year: '' } };
const LABELS = ['Trống', 'Quá ngắn', 'Dễ đoán', 'Tốt'];

function SignupForm({ log }: { log: ReturnType<typeof useLog> }) {
  const [values, setValues] = useState(EMPTY);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const errors = validateSignup(values);
  const strength = passwordStrength(values.password);
  // Chỉ hiện lỗi của ô người dùng đã rời khỏi (blur) hoặc sau khi bấm gửi: không mắng khi đang gõ dở
  const show = (field: keyof SignupErrors) => (touched[field] || submitted ? errors[field] : undefined);
  const set = (patch: Partial<SignupValues>) => setValues((v) => ({ ...v, ...patch }));
  const setBirth = (patch: Partial<SignupValues['birth']>) => setValues((v) => ({ ...v, birth: { ...v.birth, ...patch } }));
  const blur = (field: string) => () => setTouched((t) => ({ ...t, [field]: true }));

  return (
    <form
      className='card fv-form'
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        const keys = Object.keys(errors);
        log.add(keys.length ? `Đăng ký: còn lỗi ở ${keys.join(', ')}` : 'Đăng ký: hợp lệ ✓', keys.length ? 'warn' : 'ok');
      }}
    >
      <h3>Đăng ký (kiểu Udacity)</h3>
      <label>
        Tên
        <input type='text' value={values.name} onChange={(e) => set({ name: e.target.value })} onBlur={blur('name')} aria-invalid={!!show('name')} />
        {show('name') && <small className='err'>{show('name')}</small>}
      </label>
      <label>
        Email
        <input type='email' value={values.email} onChange={(e) => set({ email: e.target.value })} onBlur={blur('email')} aria-invalid={!!show('email')} />
        {show('email') && <small className='err'>{show('email')}</small>}
      </label>
      <label>
        Mật khẩu
        <input
          type='text'
          autoComplete='off'
          value={values.password}
          onChange={(e) => set({ password: e.target.value })}
          onBlur={blur('password')}
          aria-invalid={!!show('password')}
          aria-describedby='fv-meter'
        />
        <span id='fv-meter' className={`fv-meter s${strength.score}`}>
          <i />
          <span>
            {LABELS[strength.score]} · {strength.length} ký tự, {strength.unique} ký tự khác nhau
          </span>
        </span>
        {show('password') && <small className='err'>{show('password')}</small>}
      </label>
      <fieldset onBlur={blur('birth')}>
        <legend>Ngày sinh (ngày / tháng / năm)</legend>
        <div className='fv-birth'>
          <input type='text' inputMode='numeric' aria-label='Ngày' value={values.birth.day} onChange={(e) => setBirth({ day: e.target.value })} />
          <input type='text' inputMode='numeric' aria-label='Tháng' value={values.birth.month} onChange={(e) => setBirth({ month: e.target.value })} />
          <input type='text' inputMode='numeric' aria-label='Năm' value={values.birth.year} onChange={(e) => setBirth({ year: e.target.value })} />
        </div>
        {show('birth') && <small className='err'>{show('birth')}</small>}
      </fieldset>
      <div className='toolbar'>
        <button type='submit' className='primary'>
          Đăng ký
        </button>
        <button type='button' onClick={() => set({ password: 'aaaaaaaaaaaa' })}>
          Thử "aaaaaaaaaaaa"
        </button>
        <button type='button' onClick={() => setBirth({ day: '30', month: '2', year: '2004' })}>
          Thử 30/02/2004
        </button>
        <button
          type='button'
          onClick={() => {
            setValues({ name: 'Lan', email: 'lan@example.com', password: 'mây-trắng-bay-2026', birth: { day: '29', month: '2', year: '2004' } });
          }}
        >
          Điền hợp lệ
        </button>
      </div>
    </form>
  );
}

// ---- Pipedrive: cấu hình nói "bắt buộc", nhưng form có thể không hiện trường đó ----
const REQUIRED_CONFIG: RequiredFields = { title: { type: 'text' }, value: { type: 'number' }, source: { type: 'enum' } };
const ALL_FIELDS: FieldDef[] = [
  { key: 'title', type: 'text' },
  { key: 'value', type: 'number' },
  { key: 'source', type: 'enum' },
];

function DealForm({ log }: { log: ReturnType<typeof useLog> }) {
  const [hideSource, setHideSource] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({ title: '', value: '' });
  const available = useMemo(() => (hideSource ? ALL_FIELDS.filter((f) => f.key !== 'source') : ALL_FIELDS), [hideSource]);
  const required = useRequiredFields(REQUIRED_CONFIG, available, (missing) =>
    log.add(`Telemetry: trường bắt buộc không có trên form: ${missing.join(', ')}`, 'warn'),
  );
  const naiveMissing = emptyRequired(REQUIRED_CONFIG, values);
  const smartMissing = emptyRequired(required, values);

  return (
    <div className='card fv-form'>
      <h3>Thêm deal (kiểu Pipedrive)</h3>
      <label className='switch'>
        <input type='checkbox' checked={hideSource} onChange={(e) => setHideSource(e.target.checked)} /> Tài khoản này không được xem trường
        "Nguồn"
      </label>
      <label>
        Tiêu đề *
        <input type='text' value={values.title} onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))} />
      </label>
      <label>
        Giá trị *
        <input type='text' inputMode='numeric' value={values.value} onChange={(e) => setValues((v) => ({ ...v, value: e.target.value }))} />
      </label>
      {!hideSource && (
        <label>
          Nguồn *
          <select value={values.source ?? ''} onChange={(e) => setValues((v) => ({ ...v, source: e.target.value }))}>
            <option value=''>— chọn —</option>
            <option value='web'>Website</option>
            <option value='ref'>Giới thiệu</option>
          </select>
        </label>
      )}
      <div className='fv-compare'>
        <div>
          <b>Bắt buộc theo cấu hình</b>
          <button disabled={naiveMissing.length > 0}>Lưu</button>
          <small className={naiveMissing.length ? 'err' : 'ok'}>
            {naiveMissing.length ? `Thiếu: ${naiveMissing.join(', ')}` : 'Lưu được'}
          </small>
        </div>
        <div>
          <b>useRequiredFields</b>
          <button className='primary' disabled={smartMissing.length > 0} onClick={() => log.add('Deal đã lưu ✓', 'ok')}>
            Lưu
          </button>
          <small className={smartMissing.length ? 'err' : 'ok'}>
            {smartMissing.length ? `Thiếu: ${smartMissing.join(', ')}` : 'Lưu được'}
          </small>
        </div>
      </div>
    </div>
  );
}

export default function FormValidationDemo() {
  const log = useLog();
  return (
    <div className='page'>
      <h1>Validate form thân thiện</h1>
      <div className='fv-grid'>
        <SignupForm log={log} />
        <DealForm log={log} />
      </div>
      <Log lines={log.lines} />
    </div>
  );
}
