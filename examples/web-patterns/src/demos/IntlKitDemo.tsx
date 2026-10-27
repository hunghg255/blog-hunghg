import { useMemo, useState } from 'react';
import {
  compactNumber,
  outlookPluralIndex,
  pluralForm,
  resolveLocale,
  truncateAtSentence,
  type PluralForms,
} from '../lib/intlKit';
import './IntlKitDemo.css';

type Tab = 'truncate' | 'number' | 'plural' | 'locale';

const TABS: Array<[Tab, string]> = [
  ['truncate', 'Cắt theo câu'],
  ['number', 'Số rút gọn'],
  ['plural', 'Số nhiều'],
  ['locale', 'Chọn locale'],
];

// ---------- cắt theo câu ----------

const DESCRIPTIONS: Record<string, { locale: string; text: string }> = {
  vi: {
    locale: 'vi',
    text: 'Ghi chú nhanh, đồng bộ trên mọi thiết bị. Viết được cả khi offline, tự lưu từng chữ. Hỗ trợ Markdown, bảng và công thức toán. Miễn phí cho cá nhân, có gói nhóm cho công ty.',
  },
  en: {
    locale: 'en',
    text: 'Take notes in seconds and sync them everywhere. Works offline and saves every keystroke. Supports Markdown, tables and math. Free for personal use, with team plans for companies.',
  },
  ja: {
    locale: 'ja',
    text: 'すばやくメモを取り、すべての端末で同期できます。オフラインでも書けて、入力ごとに自動保存されます。Markdown、表、数式に対応しています。個人利用は無料です。',
  },
};

/** Cắt "ngây thơ": cắt đúng limit ký tự (UTF-16) rồi thêm dấu … */
const naiveCut = (text: string, limit: number) => (text.length <= limit ? text : text.slice(0, limit) + '…');

function TruncatePanel() {
  const [lang, setLang] = useState<keyof typeof DESCRIPTIONS>('vi');
  const [limit, setLimit] = useState(90);
  const { locale, text } = DESCRIPTIONS[lang];
  const result = truncateAtSentence(text, limit, { locale });
  return (
    <section>
      <div className='toolbar'>
        {Object.keys(DESCRIPTIONS).map((key) => (
          <button key={key} className={key === lang ? 'primary' : ''} onClick={() => setLang(key)}>
            {key}
          </button>
        ))}
        <label className='ik-range'>
          Giới hạn <b>{limit}</b> ký tự
          <input type='range' min={20} max={180} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
        </label>
      </div>
      <div className='ik-cards'>
        <div className='card'>
          <div className='ik-label'>Cắt cứng ở {limit} ký tự</div>
          <p className='ik-text' lang={locale}>{naiveCut(text, limit)}</p>
        </div>
        <div className='card'>
          <div className='ik-label'>
            truncateAtSentence · cắt theo <b className='ik-level'>{result.level}</b> · {result.text.length} ký tự
          </div>
          <p className='ik-text' lang={locale}>{result.text}</p>
        </div>
      </div>
      <p className='hint'>
        Kéo giới hạn: khi các câu nguyên vẹn đạt ít nhất 75% giới hạn thì giữ nguyên câu (không có dấu …), nếu không thì
        lùi xuống cắt theo từ. Tiếng Nhật không có dấu cách nhưng <code>Intl.Segmenter</code> vẫn tách được câu và từ.
      </p>
    </section>
  );
}

// ---------- số rút gọn ----------

const NUMBER_LOCALES = ['en', 'vi', 'hi-IN', 'my', 'ar-EG', 'bn', 'fa'];

function NumberPanel() {
  const [value, setValue] = useState(1234567);
  return (
    <section>
      <div className='toolbar'>
        {[987, 12345, 1234567, 2_500_000_000].map((v) => (
          <button key={v} className={v === value ? 'primary' : ''} onClick={() => setValue(v)}>
            {v.toLocaleString('en')}
          </button>
        ))}
      </div>
      <table className='ik-table'>
        <thead>
          <tr>
            <th>Locale</th>
            <th>Mặc định</th>
            <th>Hệ số</th>
            <th>
              Thêm <code>-u-nu-latn</code>
            </th>
          </tr>
        </thead>
        <tbody>
          {NUMBER_LOCALES.map((locale) => {
            const plain = compactNumber(value, locale, false);
            const latin = compactNumber(value, locale, true);
            return (
              <tr key={locale}>
                <td>
                  <code>{locale}</code>
                </td>
                <td>{plain.text}</td>
                <td className={plain.numberingSystem === 'latn' ? 'muted' : 'warn'}>{plain.numberingSystem}</td>
                <td>
                  {latin.text} <span className='muted'>({latin.tag})</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className='hint'>
        Cột "Hệ số" là <code>resolvedOptions().numberingSystem</code> trên trình duyệt của bạn. App Store ép{' '}
        <code>hi-IN</code> và <code>my</code> sang chữ số Latin vì yêu cầu sản phẩm, không phải vì chữ số bản địa sai.
      </p>
    </section>
  );
}

// ---------- số nhiều ----------

const PLURAL_LANGS: Array<{ lang: string; label: string; forms: PluralForms; outlook: [string, string, string] }> = [
  {
    lang: 'ru',
    label: 'Nga',
    forms: { one: '# файл', few: '# файла', many: '# файлов', other: '# файла' },
    outlook: ['# файл', '# файла', '# файлов'],
  },
  {
    lang: 'uk',
    label: 'Ukraina',
    forms: { one: '# файл', few: '# файли', many: '# файлів', other: '# файлу' },
    outlook: ['# файл', '# файли', '# файлів'],
  },
  {
    lang: 'pl',
    label: 'Ba Lan',
    forms: { one: '# plik', few: '# pliki', many: '# plików', other: '# pliku' },
    outlook: ['# plik', '# pliki', '# plików'],
  },
  {
    lang: 'cs',
    label: 'Séc',
    forms: { one: '# soubor', few: '# soubory', many: '# souboru', other: '# souborů' },
    outlook: ['# soubor', '# soubory', '# souborů'],
  },
];

const COUNTS = [0, 1, 2, 5, 11, 12, 21, 22, 25, 101, 111, 1.5];

function PluralPanel() {
  const [index, setIndex] = useState(0);
  const item = PLURAL_LANGS[index];
  const rows = useMemo(
    () =>
      COUNTS.map((n) => {
        const ours = pluralForm(n, item.forms, item.lang);
        const legacy = item.outlook[outlookPluralIndex(n, item.lang)].replace('#', new Intl.NumberFormat(item.lang).format(n));
        return { n, ours, legacy, category: new Intl.PluralRules(item.lang).select(n), differs: ours !== legacy };
      }),
    [item],
  );
  const diffCount = rows.filter((r) => r.differs).length;
  return (
    <section>
      <div className='toolbar'>
        {PLURAL_LANGS.map((l, i) => (
          <button key={l.lang} className={i === index ? 'primary' : ''} onClick={() => setIndex(i)}>
            {l.label}
          </button>
        ))}
        <span className={diffCount ? 'warn' : 'ok'}>{diffCount} số cho kết quả khác nhau</span>
      </div>
      <table className='ik-table'>
        <thead>
          <tr>
            <th>n</th>
            <th>Regex kiểu Outlook</th>
            <th>Intl.PluralRules</th>
            <th>Nhóm CLDR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n} className={r.differs ? 'ik-diff' : ''}>
              <td>{r.n}</td>
              <td>{r.legacy}</td>
              <td>{r.ours}</td>
              <td className='muted'>{r.category}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className='hint'>
        Outlook xếp tiếng Ukraina chung luật với tiếng Séc nên 21, 22 sai dạng; regex coi "1.5" là chuỗi nên số thập phân
        rơi vào dạng số nhiều thứ hai. <code>Intl.PluralRules</code> trả về đúng nhóm theo dữ liệu CLDR.
      </p>
    </section>
  );
}

// ---------- chọn locale ----------

const SUPPORTED = ['en', 'vi', 'ja', 'zh-Hans', 'zh-Hant', 'no', 'sr-Cyrl-RS', 'sr-Latn-RS', 'pt', 'pt-BR', 'ar', 'he'];
const SAMPLES = ['zh-TW', 'zh_HK', 'nb-NO', 'sr-RS', 'sr-Latn-BA', 'pt-PT', 'ar-EG', 'he-IL', 'vi-VN', 'de-AT'];

function LocalePanel() {
  const browser = typeof navigator !== 'undefined' ? navigator.language : 'en';
  const [input, setInput] = useState(browser);
  const result = resolveLocale(input, SUPPORTED, { aliases: { nb: 'no', nn: 'no' } });
  return (
    <section>
      <div className='ik-locale-row'>
        <input type='text' value={input} onChange={(e) => setInput(e.target.value)} aria-label='Locale người dùng' />
      </div>
      <div className='toolbar'>
        {SAMPLES.map((s) => (
          <button key={s} onClick={() => setInput(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className='card ik-result'>
        <div>
          Kết quả: <b className={result.notFound ? 'warn' : 'ok'}>{result.locale}</b>
          {result.notFound && <span className='warn'> (không tìm thấy, dùng mặc định)</span>} · hướng chữ{' '}
          <b>{result.dir}</b>
        </div>
        <ol className='ik-chain'>
          {result.tried.map((tag) => (
            <li key={tag} className={tag.toLowerCase() === result.locale.toLowerCase() ? 'ok' : 'muted'}>
              {tag}
            </li>
          ))}
        </ol>
        <p dir={result.dir} lang={result.locale} className='ik-dir-sample'>
          {result.dir === 'rtl' ? '← chữ chạy từ phải sang trái' : 'chữ chạy từ trái sang phải →'}
        </p>
      </div>
      <p className='hint'>
        Danh sách hỗ trợ: {SUPPORTED.join(', ')}. <code>zh-TW</code> tìm ra <code>zh-Hant</code> nhờ{' '}
        <code>Intl.Locale.maximize()</code>, không cần bảng tra như Outlook; chỉ <code>nb</code> → <code>no</code> là ngoại
        lệ phải khai báo.
      </p>
    </section>
  );
}

export default function IntlKitDemo() {
  const [tab, setTab] = useState<Tab>('truncate');
  return (
    <div className='page intl-kit'>
      <h1>Intl thực chiến</h1>
      <p className='hint'>Bốn việc nhỏ của app đa ngôn ngữ, làm bằng API có sẵn của trình duyệt.</p>
      <div className='toolbar' role='tablist'>
        {TABS.map(([id, label]) => (
          <button key={id} role='tab' aria-selected={tab === id} className={tab === id ? 'primary' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'truncate' && <TruncatePanel />}
      {tab === 'number' && <NumberPanel />}
      {tab === 'plural' && <PluralPanel />}
      {tab === 'locale' && <LocalePanel />}
    </div>
  );
}
