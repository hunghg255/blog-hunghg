/**
 * Preview code HTML/CSS/JS do người dùng viết, chạy trong iframe sandbox origin khác,
 * có chặn vòng lặp vô hạn. Ý tưởng từ `instructor/coding-exercise-preview/preview.react-component.tsx`
 * và `instructor/code-editor/language-settings.js` của Udemy, viết lại từ đầu.
 */

export interface CodeFile {
  name: string;
  content: string;
}

export const extensionOf = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

const byExtension = (files: CodeFile[], ...exts: string[]) =>
  files.filter((f) => exts.includes(extensionOf(f.name)));

// ---------------------------------------------------------------------------
// Chặn vòng lặp vô hạn

/** Tên hàm kiểm tra được chèn vào thân vòng lặp. Định nghĩa trong runtime của iframe. */
export const LOOP_GUARD = '__loopGuard';

/**
 * Chèn `if (__loopGuard(id)) break;` vào đầu thân mọi vòng `for`, `while`, `do` có dấu `{`.
 * Bộ quét bỏ qua chuỗi, template literal và comment. Giới hạn (giống mọi công cụ dựa trên
 * quét chữ): không hiểu regex literal chứa `{`, và vòng lặp không có ngoặc nhọn thì không được bảo vệ.
 * Trả về code đã chèn và số vòng lặp đã bảo vệ.
 */
export function protectLoops(code: string): { code: string; loops: number } {
  let out = '';
  let i = 0;
  let id = 0;
  const n = code.length;
  const isIdent = (ch: string | undefined) => !!ch && /[\w$]/.test(ch);

  /** chép nguyên một chuỗi / comment bắt đầu ở i, trả về vị trí ngay sau nó */
  const skipLiteral = (start: number): number => {
    const ch = code[start];
    if (ch === '/' && code[start + 1] === '/') {
      const end = code.indexOf('\n', start);
      return end === -1 ? n : end;
    }
    if (ch === '/' && code[start + 1] === '*') {
      const end = code.indexOf('*/', start + 2);
      return end === -1 ? n : end + 2;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = start + 1;
      while (j < n && code[j] !== ch) j += code[j] === '\\' ? 2 : 1;
      return j + 1;
    }
    return start;
  };

  /** từ vị trí j (ngay sau từ khoá), bỏ qua khoảng trắng + cụm (...) cân bằng; trả vị trí sau đó */
  const skipParens = (j: number): number => {
    while (j < n && /\s/.test(code[j])) j++;
    if (code[j] !== '(') return -1;
    let depth = 0;
    while (j < n) {
      const after = skipLiteral(j);
      if (after !== j) {
        j = after;
        continue;
      }
      if (code[j] === '(') depth++;
      else if (code[j] === ')' && --depth === 0) return j + 1;
      j++;
    }
    return -1;
  };

  while (i < n) {
    const after = skipLiteral(i);
    if (after !== i) {
      out += code.slice(i, after);
      i = after;
      continue;
    }
    const match = /^(for|while|do)\b/.exec(code.slice(i, i + 6));
    if (match && !isIdent(code[i - 1]) && code[i - 1] !== '.') {
      const keyword = match[1];
      const j = keyword === 'do' ? i + 2 : skipParens(i + keyword.length);
      if (j !== -1) {
        let k = j;
        while (k < n && /\s/.test(code[k])) k++;
        if (code[k] === '{') {
          id++;
          out += code.slice(i, k + 1) + ` if (${LOOP_GUARD}(${id})) break;`;
          i = k + 1;
          continue;
        }
      }
    }
    out += code[i];
    i++;
  }
  return { code: out, loops: id };
}

/**
 * Runtime của guard, chạy TRONG iframe. Mỗi vòng lặp được đếm thời gian từ lần đầu chạm
 * guard trong lượt chạy đồng bộ hiện tại; quá `limitMs` thì break và báo ra ngoài.
 * Lượt chạy kết thúc (trả quyền cho event loop) thì bộ đếm reset.
 */
export const loopGuardRuntime = (limitMs: number) => `
(function () {
  var first = Object.create(null), scheduled = false;
  window.${LOOP_GUARD} = function (id) {
    var now = Date.now();
    if (!scheduled) { scheduled = true; setTimeout(function () { first = Object.create(null); scheduled = false; }, 0); }
    if (first[id] === undefined) first[id] = now;
    if (now - first[id] > ${limitMs}) {
      first[id] = now;
      console.error('Vòng lặp #' + id + ' chạy quá ${limitMs}ms, đã dừng (có thể là vòng lặp vô hạn)');
      return true;
    }
    return false;
  };
})();`;

// ---------------------------------------------------------------------------
// Ghép file thành một trang

export interface BuildOptions {
  /** giới hạn mỗi vòng lặp (ms), mặc định 1000 */
  loopLimitMs?: number;
}

/**
 * Ghép HTML + CSS + JS thành một tài liệu hoàn chỉnh để chạy trong iframe.
 * - HTML được parse bằng DOMParser: tài liệu "trơ", không tải ảnh, không chạy onerror,
 *   khác với cách gán innerHTML vào một phần tử của trang chính.
 * - Các file JS nối bằng ';\n' để file trước không "dính" vào file sau.
 */
export function buildPreviewDocument(files: CodeFile[], { loopLimitMs = 1000 }: BuildOptions = {}) {
  const html = byExtension(files, 'html', 'htm')[0]?.content ?? '';
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const style = doc.createElement('style');
  style.textContent = byExtension(files, 'css').map((f) => f.content).join('\n');
  doc.head.appendChild(style);

  const guard = doc.createElement('script');
  guard.textContent = CONSOLE_BRIDGE + loopGuardRuntime(loopLimitMs);
  doc.head.prepend(guard);

  const jsFiles = byExtension(files, 'js', 'jsx');
  const { code, loops } = protectLoops(jsFiles.map((f) => `// ${f.name}\n${f.content}`).join(';\n'));
  const script = doc.createElement('script');
  script.textContent = code;
  doc.body.appendChild(script);

  return { html: '<!doctype html>' + doc.documentElement.outerHTML, loops };
}

// ---------------------------------------------------------------------------
// Cầu nối console từ iframe ra trang cha

export type PreviewMessage =
  | { source: 'ud-preview'; type: 'console'; level: 'log' | 'warn' | 'error'; text: string }
  | { source: 'ud-preview'; type: 'loaded' };

/**
 * Script chạy đầu tiên trong iframe: chuyển console.log/warn/error và lỗi chưa bắt ra trang
 * cha bằng postMessage. Gửi với targetOrigin '*' vì iframe origin "null" không biết chắc
 * origin của trang cha; dữ liệu chỉ là log của chính code người dùng.
 */
export const CONSOLE_BRIDGE = `
(function () {
  function post(msg) { msg.source = 'ud-preview'; parent.postMessage(msg, '*'); }
  ['log', 'warn', 'error'].forEach(function (level) {
    var orig = console[level];
    console[level] = function () {
      var text = Array.prototype.map.call(arguments, function (a) {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }).join(' ');
      post({ type: 'console', level: level, text: text });
      orig.apply(console, arguments);
    };
  });
  window.addEventListener('error', function (e) { post({ type: 'console', level: 'error', text: String(e.message) }); });
  window.addEventListener('load', function () { post({ type: 'loaded' }); });
})();`;

/**
 * Quyền tối thiểu cho iframe preview. KHÔNG có `allow-same-origin`, nên code chạy ở origin
 * "null": không đọc được cookie, localStorage hay DOM của trang cha.
 */
export const PREVIEW_SANDBOX = 'allow-scripts allow-modals allow-forms';
