/**
 * Cảnh báo link có ký tự giả dạng (homograph) và làm sạch tên file chống giả đuôi bằng ký tự điều khiển bidi.
 * Viết lại từ ý tưởng của WhatsApp Web 2020 (module fjehahjbc, cjegdbihch, dibidhdcdg, dbejeibfid).
 */

/** Chữ Kirin trông như chữ Latin (cùng danh sách với bản gốc). */
export const CYRILLIC_LOOKALIKES = 'авгекмнорстухшщьѕіјѡѵүһӏԁԛԝԧꚙ';
/** Mã vùng điện thoại của nước dùng chữ Kirin: Nga, Ukraina, Belarus, Kazakhstan, Serbia… */
const CYRILLIC_CALLING_CODES = new Set(['7', '359', '373', '374', '375', '380', '381', '382', '383', '387', '389', '976', '992', '993', '994', '995', '996', '998']);
/** Một phần ngôn ngữ viết chữ Kirin. */
const CYRILLIC_LANGS = new Set(['ru', 'uk', 'be', 'bg', 'sr', 'mk', 'kk', 'ky', 'tg', 'mn', 'uz', 'az', 'ba', 'tt', 'cv', 'ce', 'os', 'sah', 'tk']);

/** Ký tự Latin có dấu dễ nhầm với chữ không dấu → ngôn ngữ dùng nó thật (rút gọn). */
const ACCENT_LANGS: Record<string, string[]> = {
  í: ['es', 'pt', 'fr', 'cs', 'sk', 'hu', 'is', 'ga', 'nl', 'vi'],
  î: ['fr', 'ro', 'tr', 'ku', 'af'],
  ü: ['de', 'tr', 'hu', 'es', 'et', 'az', 'nl', 'fr'],
  ı: ['tr', 'az'],
  ł: ['pl'],
  š: ['cs', 'sk', 'sl', 'hr', 'bs', 'lv', 'lt', 'et', 'fi'],
  ī: ['lv', 'mi', 'haw'],
  ċ: ['mt'],
  ļ: ['lv'],
  ɑ: ['tmh'],
  ạ: ['vi'],
  ẹ: ['vi', 'yo'],
  ị: ['vi', 'ig'],
};
/** Ngôn ngữ → mã vùng nơi ngôn ngữ đó phổ biến (rút gọn từ bảng LANGUAGE_TO_REGIONS). */
const LANGUAGE_REGIONS: Record<string, string[]> = {
  vi: ['84', '855'], es: ['34', '52', '54', '56', '57'], pt: ['351', '55'], fr: ['33', '32', '41', '1'],
  cs: ['420'], sk: ['421'], hu: ['36'], de: ['49', '43', '41'], tr: ['90'], pl: ['48'], az: ['994'],
  ro: ['40', '373'], lv: ['371'], lt: ['370'], et: ['372'], mt: ['356'], nl: ['31', '32'], hr: ['385'],
  sl: ['386'], fi: ['358'], is: ['354'], ga: ['353'], mi: ['64'], yo: ['234'], ig: ['234'],
};

const ASCII_LABEL = /^[a-z0-9-]+$/;
const LATIN = /\p{sc=Latin}/u;
const CONFUSABLE_SCRIPT = /[\p{sc=Cyrillic}\p{sc=Greek}]/u;

export interface Party {
  /** Mã vùng điện thoại của mình và của người gửi ("" nếu tin của hệ thống). */
  myCallingCode: string;
  senderCallingCode: string;
  /** Ngôn ngữ của người dùng (navigator.languages rút gọn), vd ['vi', 'en']. */
  languages: string[];
}

export type Reason = 'lookalike-label' | 'mixed-script' | 'rare-accent';

export interface Suspicion {
  label: string;
  chars: Set<string>;
  reason: Reason;
}

/** Lấy host từ URL người dùng gõ (có hoặc không có http://), bỏ cổng, chữ thường. */
export function extractHost(url: string): string | null {
  const m = /^(?:https?:\/\/)?(?:[^@/?#]*@)?([^/?#:]+)(?::\d+)?(?:[/?#]|$)/i.exec(url.trim());
  return m ? m[1].toLowerCase().replace(/\.$/, '') : null;
}

function checkLabel(label: string, party: Party): Suspicion | null {
  const chars = Array.from(label);
  const lang = (l: string) => party.languages.some((x) => x.toLowerCase().split('-')[0] === l);

  // 1. Cả nhãn toàn chữ Kirin giống Latin: "аррӏе". Bỏ qua nếu một trong hai bên dùng chữ Kirin.
  if (chars.every((c) => CYRILLIC_LOOKALIKES.includes(c) || /[0-9-]/.test(c)) && chars.some((c) => CYRILLIC_LOOKALIKES.includes(c))) {
    const cyrillicUser =
      CYRILLIC_CALLING_CODES.has(party.myCallingCode) ||
      CYRILLIC_CALLING_CODES.has(party.senderCallingCode) ||
      [...CYRILLIC_LANGS].some(lang);
    return cyrillicUser ? null : { label, chars: new Set(chars.filter((c) => !/[0-9-]/.test(c))), reason: 'lookalike-label' };
  }

  // 2. Trộn Latin với Kirin/Hy Lạp trong cùng một nhãn: "аpple". Bản gốc bỏ sót trường hợp này.
  const foreign = chars.filter((c) => CONFUSABLE_SCRIPT.test(c));
  if (foreign.length && chars.some((c) => LATIN.test(c))) return { label, chars: new Set(foreign), reason: 'mixed-script' };

  // 3. Một hai chữ có dấu hiếm gặp với người dùng này: "wíkipedia".
  const accents = chars.filter((c) => c in ACCENT_LANGS);
  if (!accents.length || accents.length > 2) return null; // nhiều dấu: có lẽ là chữ thật của một ngôn ngữ
  const odd = accents.filter((c) => {
    const langs = ACCENT_LANGS[c];
    if (langs.some(lang)) return false;
    const regions = new Set(langs.flatMap((l) => LANGUAGE_REGIONS[l] ?? []));
    return !regions.has(party.myCallingCode) && !regions.has(party.senderCallingCode);
  });
  return odd.length ? { label, chars: new Set(odd), reason: 'rare-accent' } : null;
}

/** Xét MỌI nhãn không phải ASCII (kể cả TLD như ".сом"), trả về nhãn đáng ngờ đầu tiên. */
export function findSuspicious(host: string, party: Party): Suspicion | null {
  for (const label of host.toLowerCase().split('.')) {
    if (!label || ASCII_LABEL.test(label)) continue;
    const hit = checkLabel(label, party);
    if (hit) return hit;
  }
  return null;
}

/** Hành vi của bản 2020 (để so sánh): chỉ xét nhãn không-ASCII đầu tiên, bỏ cuộc nếu nhãn CUỐI không phải ASCII. */
export function findSuspicious2020(host: string, party: Party): Suspicion | null {
  const labels = host.split('.');
  const first = labels.find((l) => !ASCII_LABEL.test(l));
  if (!first || !ASCII_LABEL.test(labels[labels.length - 1])) return null;
  const chars = Array.from(first);
  if (!chars.every((c) => CYRILLIC_LOOKALIKES.includes(c))) {
    const hit = checkLabel(first, party);
    return hit?.reason === 'rare-accent' ? hit : null; // không có nhánh "trộn script"
  }
  return checkLabel(first, party);
}

// ---------------- Tên file ----------------

/** LRE RLE PDF LRO RLO, LRI RLI FSI PDI, LRM RLM, ALM. */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;
export const DANGEROUS_EXTENSIONS = new Set([
  'bat', 'exe', 'cmd', 'com', 'lnk', 'pif', 'scr', 'vb', 'vbe', 'vbs', 'wsh', 'js', 'ps1', 'hta', 'sh',
  'csh', 'msi', 'app', 'scpt', 'applescript', 'reg', 'wsf', 'sct', 'jar', 'dmg', 'pkg', 'iso',
]);

export interface CleanResult {
  name: string;
  extension: string;
  changed: boolean;
  dangerous: boolean;
}

/**
 * Thay ký tự điều khiển bidi bằng U+FFFD (để người dùng THẤY có gì đó lạ) và bỏ "đuôi rỗng" ở cuối:
 * "hoa_don\u202Efdp.exe" → "hoa_don�fdp.exe", "a.exe. " → "a.exe".
 */
export function cleanFilename(input: string): CleanResult {
  let name = input.replace(BIDI_CONTROLS, '\uFFFD');
  const parts = name.split('.');
  if (parts.length > 1) {
    for (let i = parts.length - 1; i > 0; i--) {
      const ext = parts[i].trim();
      if (ext) {
        name = parts.slice(0, i).join('.') + '.' + ext;
        break;
      }
    }
  }
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return { name, extension, changed: name !== input, dangerous: DANGEROUS_EXTENSIONS.has(extension) };
}
