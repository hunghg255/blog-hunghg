/**
 * Định dạng số điện thoại theo quốc gia khi người dùng đang gõ
 * (ý tưởng từ util/countries.ts + util/phoneNumber.ts của Telegram Web A).
 *
 * Dữ liệu là một chuỗi nén, mỗi dòng một nước, lấy từ Telegram Desktop (numbers.txt):
 *   `US🇺🇸1United States334`  =  mã ISO + cờ + mã vùng + tên + độ dài các nhóm số
 * "334" nghĩa là: 3 số, cách, 3 số, gạch, 4 số  →  `202 555-0123`.
 * Nước không có đuôi số thì dùng mặc định 3-3-3-3-3.
 */

// Một phần nhỏ của bảng (31/~240 nước) để demo; bảng đầy đủ nằm trong mã nguồn Telegram.
export const PHONE_DATA = `AE🇦🇪971United Arab Emirates234
AI🇦🇮1264Anguilla34
AG🇦🇬1268Antigua and Barbuda34
AU🇦🇺61Australia333
BR🇧🇷55Brazil254
CA🇨🇦1Canada334
CN🇨🇳86China344
DE🇩🇪49Germany38
ES🇪🇸34Spain333
FR🇫🇷33France12222
GB🇬🇧44United Kingdom46
HK🇭🇰852Hong Kong
ID🇮🇩62Indonesia
IN🇮🇳91India55
IT🇮🇹39Italy334
JP🇯🇵81Japan244
KZ🇰🇿7Kazakhstan3322
KR🇰🇷82South Korea
MX🇲🇽52Mexico
MY🇲🇾60Malaysia
NL🇳🇱31Netherlands12222
PH🇵🇭63Philippines334
PL🇵🇱48Poland333
RU🇷🇺7Russia3322
SG🇸🇬65Singapore44
TH🇹🇭66Thailand144
TR🇹🇷90Turkey334
TW🇹🇼886Taiwan
UA🇺🇦380Ukraine2322
US🇺🇸1United States334
VN🇻🇳84Vietnam`;

export interface Country {
  id: string;
  flag: string;
  /** chỉ chữ số, không có dấu + */
  code: string;
  name: string;
  /** độ dài từng nhóm, undefined = dùng mặc định */
  groups?: number[];
}

const DEFAULT_GROUPS = [3, 3, 3, 3, 3];

// mã ISO, hai ký tự "regional indicator" ghép thành cờ, mã vùng, tên, độ dài nhóm (có thể rỗng)
const LINE_RE = /^([A-Z]{2})(\p{Regional_Indicator}{2})(\d+)(.*?)(\d*)$/u;

export function parsePhoneData(data: string): Country[] {
  return data.split('\n').flatMap((line) => {
    const match = LINE_RE.exec(line.trim());
    if (!match) return [];
    const [, id, flag, code, name, groups] = match;
    return [{ id, flag, code, name, groups: groups ? groups.split('').map(Number) : undefined }];
  });
}

export const COUNTRIES = parsePhoneData(PHONE_DATA);

export const onlyDigits = (input: string) => input.replace(/\D+/g, '');

/**
 * Tìm nước theo mã vùng ở đầu số: lấy mã DÀI nhất khớp (+1264 Anguilla thắng +1 Mỹ).
 * Nhiều nước chung mã (+1 Mỹ/Canada, +7 Nga/Kazakhstan): giữ nước người dùng đang chọn
 * nếu vẫn khớp, thay vì nhảy sang nước đứng sau trong danh sách như bản gốc.
 */
export function detectCountry(input: string, current?: Country, countries = COUNTRIES) {
  const digits = onlyDigits(input);
  const candidates = countries.filter((c) => digits.startsWith(c.code));
  if (candidates.length === 0) return undefined;
  const longest = Math.max(...candidates.map((c) => c.code.length));
  const best = candidates.filter((c) => c.code.length === longest);
  return (
    best.find((c) => c.id === current?.id) ??
    best.find((c) => c.id === PRIMARY_FOR_CODE[c.code]) ??
    best[0]
  );
}

/** Mã dùng chung nhiều nước: chưa chọn nước nào thì đoán nước đông dân nhất. */
const PRIMARY_FOR_CODE: Record<string, string> = { '1': 'US', '7': 'RU' };

export interface FormatResult {
  text: string;
  /** đã đủ số theo mẫu của nước (mẫu mặc định thì luôn false) */
  isComplete: boolean;
  /** số chữ số gõ thừa so với mẫu */
  overflow: number;
}

/**
 * Định dạng PHẦN SAU mã vùng. Nhóm 1 và 2 cách nhau dấu cách, các nhóm sau nối bằng `-`
 * (riêng Anh dùng dấu cách), giống Telegram.
 *
 * Khác bản gốc: bản gốc dùng regex không neo nên chữ số thừa bị dính liền vào nhóm cuối
 * (`202 555-01234`); ở đây số thừa được tách riêng và báo về qua `overflow`.
 */
export function formatNational(nationalDigits: string, country?: Country): FormatResult {
  const digits = onlyDigits(nationalDigits);
  const groups = country?.groups ?? DEFAULT_GROUPS;
  const separator = country?.id === 'GB' ? ' ' : '-';
  const parts: string[] = [];
  let index = 0;
  for (const size of groups) {
    if (index >= digits.length) break;
    parts.push(digits.slice(index, index + size));
    index += size;
  }
  const capacity = groups.reduce((sum, size) => sum + size, 0);
  const overflow = Math.max(0, digits.length - capacity);

  let text = parts[0] ?? '';
  if (parts[1]) text += ` ${parts[1]}`;
  for (const part of parts.slice(2)) text += `${separator}${part}`;
  if (overflow) text += ` ${digits.slice(capacity)}`;

  return { text, isComplete: Boolean(country?.groups) && digits.length === capacity, overflow };
}

/** Định dạng cả số có mã vùng: `+84912345678` → `+84 912 345-678`. */
export function formatInternational(input: string, current?: Country) {
  const digits = onlyDigits(input);
  const country = detectCountry(digits, current);
  if (!country) return { country, text: digits ? `+${digits}` : '', isComplete: false, overflow: 0 };
  const national = formatNational(digits.slice(country.code.length), country);
  return {
    country,
    ...national,
    text: national.text ? `+${country.code} ${national.text}` : `+${country.code}`,
  };
}

/**
 * Bản sao cách làm của Telegram, để demo so sánh: dựng regex từ mẫu
 * (`334` → `(\d{1,3})(\d{1,3})?(\d{1,4})?()?()?`), thêm `()?` cho đủ 5 nhóm vì
 * callback của `String.replace` được viết cố định 5 tham số.
 */
export function formatNationalLikeOriginal(nationalDigits: string, country?: Country) {
  const groups = country?.groups ?? DEFAULT_GROUPS;
  const pattern = groups.map((size, i) => `(\\d{1,${size}})${i > 0 ? '?' : ''}`).join('');
  const re = new RegExp(`${pattern}${'()?'.repeat(5 - groups.length)}`);
  const separator = country?.id === 'GB' ? ' ' : '-';
  return onlyDigits(nationalDigits).replace(re, (_m, p1, p2, p3, p4, p5) => {
    let out = p1 ?? '';
    if (p2) out += ` ${p2}`;
    if (p3) out += `${separator}${p3}`;
    if (p4) out += `${separator}${p4}`;
    if (p5) out += `${separator}${p5}`;
    return out;
  });
}
