import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';

/**
 * Validate form theo hướng "giúp người dùng điền xong", gom từ hai nơi:
 * - auth.udacity.com: chấm độ mạnh mật khẩu bằng số ký tự KHÁC NHAU, kiểm tra ngày sinh có thật
 *   bằng cách để Date tự "tràn" sang tháng sau.
 * - Pipedrive: một trường chỉ được coi là bắt buộc khi nó thật sự hiện trên form.
 */

// ---------- Mật khẩu ----------

export type PasswordScore = 0 | 1 | 2 | 3;

export interface PasswordRules {
  minLength?: number;
  minUniqueChars?: number;
}

/** 0 = trống, 1 = quá ngắn, 2 = đủ dài nhưng ít ký tự khác nhau, 3 = đạt. */
export function passwordStrength(password: string, { minLength = 10, minUniqueChars = 8 }: PasswordRules = {}) {
  // [...str] tách theo code point: emoji 😀 là 1 ký tự, không phải 2 nửa surrogate
  const chars = [...password];
  const unique = new Set(chars).size;
  let score: PasswordScore;
  if (chars.length === 0) score = 0;
  else if (chars.length < minLength) score = 1;
  else if (unique < minUniqueChars) score = 2;
  else score = 3;
  return { score, length: chars.length, unique };
}

// ---------- Ngày tháng ----------

export interface DateParts {
  day: number;
  month: number; // 1–12
  year: number;
}

/**
 * 30/02/2024 có tồn tại không? Tạo Date rồi đọc ngược lại: ngày không có thật sẽ bị Date
 * "tràn" sang tháng sau (30/02 thành 01/03), nên các phần đọc ra không khớp đầu vào.
 */
export function isRealDate({ day, month, year }: DateParts) {
  if (![day, month, year].every(Number.isInteger)) return false;
  const date = new Date(2000, 0, 1, 12); // 12h trưa: tránh nửa đêm không tồn tại ở múi giờ có DST
  // setFullYear thay vì new Date(year, …): new Date(99, 0, 1) bị hiểu là năm 1999
  date.setFullYear(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** Tuổi tròn tính tới `today`, dùng CÙNG một múi giờ (giờ địa phương) cho cả năm, tháng, ngày. */
export function ageOn(birth: DateParts, today = new Date()) {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const d = today.getDate();
  const hadBirthday = m > birth.month || (m === birth.month && d >= birth.day);
  return y - birth.year - (hadBirthday ? 0 : 1);
}

// ---------- Validate cả form ----------

export interface SignupValues {
  name: string;
  email: string;
  password: string;
  birth: { day: string; month: string; year: string };
}

export type SignupErrors = Partial<Record<'name' | 'email' | 'password' | 'birth', string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateSignup(values: SignupValues, minAge = 13, today = new Date()): SignupErrors {
  const errors: SignupErrors = {};
  if (!values.name.trim()) errors.name = 'Hãy nhập tên';
  if (!EMAIL.test(values.email.trim())) errors.email = 'Email chưa đúng định dạng';

  const { score } = passwordStrength(values.password);
  if (score < 2) errors.password = 'Mật khẩu cần ít nhất 10 ký tự';
  else if (score < 3) errors.password = 'Mật khẩu quá dễ đoán: dùng nhiều ký tự khác nhau hơn';

  const birth = { day: Number(values.birth.day), month: Number(values.birth.month), year: Number(values.birth.year) };
  if (!values.birth.day || !values.birth.month || !values.birth.year) errors.birth = 'Hãy nhập đủ ngày sinh';
  else if (!isRealDate(birth)) errors.birth = 'Ngày này không có trong lịch';
  else if (ageOn(birth, today) < minAge) errors.birth = `Bạn cần đủ ${minAge} tuổi`;
  return errors;
}

// ---------- Trường bắt buộc phải "điền được" ----------

export interface FieldDef {
  key: string;
  type: string;
}

export type RequiredFields = Record<string, { type: string }>;

/**
 * Bỏ khỏi danh sách bắt buộc những trường KHÔNG có trên form (bị ẩn theo quyền, chưa tải
 * được, đã bị xoá khỏi cấu hình…). Nếu không, nút Lưu bị khoá vì một trường người dùng
 * không nhìn thấy và không cách nào điền.
 */
export function filterRequiredFields(required: RequiredFields, available: readonly FieldDef[]) {
  const kept: RequiredFields = {};
  const missing: string[] = [];
  for (const [key, rule] of Object.entries(required)) {
    if (available.some((field) => field.key === key && field.type === rule.type)) kept[key] = rule;
    else missing.push(key);
  }
  return { required: kept, missing };
}

/** Hook: trả về danh sách bắt buộc đã lọc, và báo (log/telemetry) khi cấu hình lệch với form. */
export function useRequiredFields(
  required: RequiredFields,
  available: readonly FieldDef[],
  onMissing?: (keys: string[]) => void,
) {
  const result = useMemo(() => filterRequiredFields(required, available), [required, available]);
  const onMissingRef = useRef(onMissing);
  useLayoutEffect(() => {
    onMissingRef.current = onMissing;
  });
  const missingKey = result.missing.join(',');
  useEffect(() => {
    if (missingKey) onMissingRef.current?.(missingKey.split(','));
  }, [missingKey]);
  return result.required;
}

/** Trường bắt buộc nào còn trống. */
export function emptyRequired(required: RequiredFields, values: Record<string, unknown>) {
  return Object.keys(required).filter((key) => {
    const value = values[key];
    return value === undefined || value === null || String(value).trim() === '';
  });
}
