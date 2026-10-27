/**
 * Một ngôn ngữ markup riêng cho nội dung bài học, dịch hai chiều với HTML.
 *
 * Ý tưởng từ Coursera (static/bundles/cml/models): nội dung khoá học không lưu HTML mà lưu
 * "CML", một XML nhỏ chỉ có vài loại block (text, heading, code, list, img…) và vài thẻ inline.
 * - Editor xuất HTML → HTMLToCMLConverter → CML (lưu vào DB). Thẻ lạ bị từ chối, không lọt qua.
 * - Khi hiển thị: CMLToHTMLConverter → HTML, có thay biến %tên%, render công thức, làm sạch URL.
 *
 * Bản viết lại nhỏ hơn, dùng DOM để dựng HTML thay vì nối chuỗi, và sửa vài chỗ hở của bản gốc
 * (xem bài viết).
 */

export const INLINE_TAGS = ['strong', 'em', 'u', 'a', 'sup', 'sub', 'code', 'br'] as const;
const INLINE_ALIASES: Record<string, string> = { b: 'strong', i: 'em' };

/** Công thức toán: \( … \), \[ … \] hoặc $$ … $$ (giống MATH_REGEX của Coursera). */
export const MATH_REGEX = /\\\((.*?[^\\])\\\)|\\\[(.*?[^\\])\\\]|\$\$(.*?[^\\])\$\$/gs;

/** Cặp dấu mở/đóng của công thức, để dịch ngược span.math về TeX */
const DELIMITERS: Record<string, [string, string]> = { '()': ['\\(', '\\)'], '[]': ['\\[', '\\]'], $$: ['$$', '$$'] };

export interface Diagnostic {
  path: string;
  message: string;
}

export class CMLError extends Error {
  constructor(public diagnostics: Diagnostic[]) {
    super(diagnostics.map((d) => `${d.path}: ${d.message}`).join('\n'));
  }
}

// ---------------------------------------------------------------------------
// HTML → CML
// ---------------------------------------------------------------------------

export interface ToCMLOptions {
  /** bọc chữ/thẻ inline nằm trần ở cấp ngoài cùng vào <text> thay vì báo lỗi */
  repair?: boolean;
}

export function htmlToCML(html: string, { repair = false }: ToCMLOptions = {}): string {
  // Parser HTML của trình duyệt chịu được <br>, &copy;, thẻ không đóng… (Coursera dùng
  // 'application/xml' nên phải vá HTML bằng regex trước khi parse)
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const out = document.implementation.createDocument(null, 'co-content', null);
  const root = out.documentElement;
  const errors: Diagnostic[] = [];
  let pendingText: Element | null = null;

  const inline = (source: Node, target: Element, path: string, parentTag = '') => {
    for (const node of Array.from(source.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        target.appendChild(out.createTextNode(node.textContent ?? ''));
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue; // bỏ comment
      const el = node as Element;
      const tag = INLINE_ALIASES[el.localName] ?? el.localName;
      const here = `${path} > ${el.localName}`;
      // HTML do chính cmlToHTML sinh ra: công thức đã bọc span → trả lại cú pháp TeX
      if (tag === 'span' && el.classList.contains('math')) {
        const [open, close] = DELIMITERS[(el as HTMLElement).dataset.delim ?? '()'] ?? DELIMITERS['()'];
        target.appendChild(out.createTextNode(open + ((el as HTMLElement).dataset.tex ?? el.textContent) + close));
        continue;
      }
      if (tag === 'span' && el.classList.contains('cml-unsafe-link')) {
        inline(el, target, here, parentTag);
        continue;
      }
      if (!(INLINE_TAGS as readonly string[]).includes(tag)) {
        errors.push({ path: here, message: `thẻ inline không được phép <${el.localName}>` });
        continue;
      }
      if (tag === parentTag) {
        errors.push({ path: here, message: `không lồng <${tag}> trong <${tag}>` });
        continue;
      }
      const child = out.createElement(tag);
      if (tag === 'a') {
        const href = el.getAttribute('href');
        if (!href) {
          errors.push({ path: here, message: '<a> thiếu href' });
          continue;
        }
        child.setAttribute('href', href);
        const title = el.getAttribute('title');
        if (title) child.setAttribute('title', title);
      }
      inline(el, child, here, tag);
      target.appendChild(child);
    }
  };

  const textBlock = (source: Node, path: string, tag = 'text') => {
    const block = out.createElement(tag);
    inline(source, block, path);
    if (hasMath(block.textContent ?? '')) block.setAttribute('hasMath', 'true');
    return block;
  };

  const flushPending = () => {
    if (pendingText) {
      if (hasMath(pendingText.textContent ?? '')) pendingText.setAttribute('hasMath', 'true');
      root.appendChild(pendingText);
    }
    pendingText = null;
  };

  Array.from(body.childNodes).forEach((node, index) => {
    const path = `body[${index}]`;
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) return;
    if (node.nodeType === Node.COMMENT_NODE) return;
    const el = node as Element;
    const tag = node.nodeType === Node.ELEMENT_NODE ? el.localName : '#text';

    if (tag === '#text' || (INLINE_TAGS as readonly string[]).includes(INLINE_ALIASES[tag] ?? tag)) {
      if (!repair) {
        errors.push({ path, message: `${tag === '#text' ? 'chữ' : `<${tag}>`} nằm ngoài block (bật repair để tự bọc)` });
        return;
      }
      pendingText ??= out.createElement('text');
      const holder = document.createElement('div');
      holder.appendChild(node.cloneNode(true));
      inline(holder, pendingText, path);
      return;
    }
    flushPending();

    switch (tag) {
      case 'p':
        root.appendChild(textBlock(el, path));
        break;
      case 'h1':
      case 'h2':
      case 'h3': {
        const heading = textBlock(el, path, 'heading');
        heading.setAttribute('level', tag[1]);
        root.appendChild(heading);
        break;
      }
      case 'pre': {
        const code = out.createElement('code');
        const lang = el.getAttribute('data-language');
        if (lang) code.setAttribute('language', lang);
        if (el.children.length > 0 && !(el.children.length === 1 && el.firstElementChild!.localName === 'code')) {
          errors.push({ path, message: '<pre> chỉ được chứa chữ' });
        }
        code.textContent = el.textContent ?? '';
        root.appendChild(code);
        break;
      }
      case 'ul':
      case 'ol': {
        const list = out.createElement('list');
        list.setAttribute('bulletType', tag === 'ul' ? 'bullets' : 'numbers');
        Array.from(el.children).forEach((li, i) => {
          if (li.localName !== 'li') {
            errors.push({ path: `${path} > ${li.localName}`, message: 'list chỉ chứa <li>' });
            return;
          }
          const item = out.createElement('li');
          item.appendChild(textBlock(li, `${path} > li[${i}]`));
          list.appendChild(item);
        });
        root.appendChild(list);
        break;
      }
      case 'figure':
      case 'img': {
        const img = tag === 'img' ? el : el.querySelector('img');
        if (!img?.getAttribute('src')) {
          errors.push({ path, message: 'ảnh thiếu src' });
          break;
        }
        const block = out.createElement('img');
        block.setAttribute('src', img.getAttribute('src')!);
        block.setAttribute('alt', img.getAttribute('alt') ?? '');
        root.appendChild(block);
        break;
      }
      default:
        errors.push({ path, message: `block không được phép <${tag}>` });
    }
  });
  flushPending();

  if (errors.length) throw new CMLError(errors);
  return new XMLSerializer().serializeToString(out);
}

export function hasMath(text: string) {
  MATH_REGEX.lastIndex = 0; // regex có cờ g giữ lastIndex giữa các lần test
  return MATH_REGEX.test(text);
}

// ---------------------------------------------------------------------------
// CML → HTML
// ---------------------------------------------------------------------------

const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:'];

/**
 * URL an toàn để đặt vào href/src, hoặc null.
 * Dùng chính parser URL của trình duyệt: nó cắt khoảng trắng/tab/xuống dòng giống hệt lúc
 * trình duyệt đọc href, và tự đổi tên miền Unicode sang punycode (xn--…).
 */
export function safeUrl(raw: string, base = 'https://example.invalid/'): string | null {
  try {
    const url = new URL(raw, base);
    if (!SAFE_PROTOCOLS.includes(url.protocol)) return null;
    // Link tương đối ("/courses/x"): giữ tương đối, đừng gắn host giả của `base`
    if (url.origin === new URL(base).origin) return url.pathname + url.search + url.hash;
    return url.href;
  } catch {
    return null;
  }
}

export interface ToHTMLOptions {
  /** %key% → value, chỉ thay trong chữ và trong href (giá trị được coi là chữ, không phải HTML) */
  variables?: Record<string, string>;
  /** host được coi là nội bộ: link tới đó không thêm rel="nofollow" */
  internalHosts?: string[];
}

export function cmlToHTML(cml: string, { variables = {}, internalHosts = [] }: ToHTMLOptions = {}): string {
  const doc = new DOMParser().parseFromString(cml, 'application/xml');
  const parseError = doc.getElementsByTagName('parsererror')[0];
  if (parseError) throw new CMLError([{ path: 'cml', message: `XML lỗi: ${parseError.textContent?.trim().split('\n')[0]}` }]);

  const out = document.createElement('div');
  const errors: Diagnostic[] = [];
  const keys = Object.keys(variables);
  const varRegex = keys.length ? new RegExp(`%(${keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})%`, 'g') : null;
  const sub = (text: string) => (varRegex ? text.replace(varRegex, (_, k: string) => variables[k]) : text);

  const inline = (source: Element, target: HTMLElement) => {
    for (const node of Array.from(source.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        target.appendChild(document.createTextNode(sub(node.textContent ?? '')));
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element;
      if (!(INLINE_TAGS as readonly string[]).includes(el.localName)) {
        errors.push({ path: el.localName, message: 'thẻ inline lạ' });
        continue;
      }
      if (el.localName === 'a') {
        const href = safeUrl(sub(el.getAttribute('href') ?? ''));
        if (!href) {
          // link nguy hiểm: giữ chữ, bỏ link
          const span = document.createElement('span');
          span.className = 'cml-unsafe-link';
          inline(el, span);
          target.appendChild(span);
          continue;
        }
        const a = document.createElement('a');
        a.href = href;
        a.target = '_blank';
        const relative = href.startsWith('/');
        const host = relative ? '' : new URL(href).hostname;
        a.rel = relative || internalHosts.includes(host) ? 'noopener' : 'noopener nofollow';
        const title = el.getAttribute('title');
        if (title) a.title = title.slice(0, 125);
        inline(el, a);
        // Chữ của link trông như URL: hiện dạng punycode để lộ tên miền giả (аpple.com với chữ а Cyrillic)
        const shown = a.textContent ?? '';
        if (/^https?:\/\//i.test(shown) && a.childNodes.length === 1) a.textContent = safeUrl(shown) ?? shown;
        target.appendChild(a);
        continue;
      }
      const child = document.createElement(el.localName);
      inline(el, child);
      target.appendChild(child);
    }
  };

  const withMath = (block: Element, target: HTMLElement) => {
    inline(block, target);
    if (block.getAttribute('hasMath') !== 'true') return;
    // Bọc công thức vào <span class="math"> (Coursera gọi katex ở đây)
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    for (const textNode of texts) {
      const value = textNode.data;
      MATH_REGEX.lastIndex = 0;
      if (!MATH_REGEX.test(value)) continue;
      const frag = document.createDocumentFragment();
      let last = 0;
      value.replace(MATH_REGEX, (match, a, b, c, offset: number) => {
        frag.append(value.slice(last, offset));
        const span = document.createElement('span');
        span.className = 'math';
        span.dataset.delim = a !== undefined ? '()' : b !== undefined ? '[]' : '$$';
        span.dataset.tex = a ?? b ?? c;
        span.textContent = a ?? b ?? c;
        frag.append(span);
        last = offset + match.length;
        return match;
      });
      frag.append(value.slice(last));
      textNode.replaceWith(frag);
    }
  };

  for (const block of Array.from(doc.documentElement.children)) {
    switch (block.localName) {
      case 'text': {
        const p = document.createElement('p');
        withMath(block, p);
        out.appendChild(p);
        break;
      }
      case 'heading': {
        const level = Math.min(3, Math.max(1, Number(block.getAttribute('level')) || 1));
        const h = document.createElement(`h${level}`);
        withMath(block, h);
        out.appendChild(h);
        break;
      }
      case 'code': {
        const pre = document.createElement('pre');
        pre.dir = 'ltr'; // code luôn trái sang phải, kể cả khi trang là tiếng Ả Rập
        const lang = block.getAttribute('language');
        if (lang) pre.dataset.language = lang;
        pre.textContent = block.textContent;
        out.appendChild(pre);
        break;
      }
      case 'list': {
        const list = document.createElement(block.getAttribute('bulletType') === 'numbers' ? 'ol' : 'ul');
        for (const li of Array.from(block.children)) {
          const item = document.createElement('li');
          const text = li.firstElementChild;
          if (text) withMath(text, item);
          list.appendChild(item);
        }
        out.appendChild(list);
        break;
      }
      case 'img': {
        const src = safeUrl(block.getAttribute('src') ?? '');
        if (!src) {
          errors.push({ path: 'img', message: 'src không an toàn' });
          break;
        }
        const img = document.createElement('img');
        img.src = src;
        img.alt = block.getAttribute('alt') ?? '';
        out.appendChild(img);
        break;
      }
      default:
        errors.push({ path: block.localName, message: 'block lạ' });
    }
  }

  if (errors.length) throw new CMLError(errors);
  return out.innerHTML;
}
