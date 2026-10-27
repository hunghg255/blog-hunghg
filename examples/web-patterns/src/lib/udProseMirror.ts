/**
 * Những mẹo quanh editor rich text của Udemy (ProseMirror), viết lại không phụ thuộc ProseMirror:
 * schema bật/tắt theo feature, chuẩn hoá HTML dán từ IDE, và xuất HTML hiển thị đúng trong email.
 * Mỗi hàm ứng với một hook của ProseMirror (ghi trong comment) để áp vào editor thật.
 */
import { checkHref, getDetachedDoc, parseInert } from './udSafeHtml';

// ---------- 1. "Schema" theo feature flag ----------

export type Feature = 'bold' | 'italic' | 'code' | 'link' | 'codeBlock' | 'list';

/** Thẻ được giữ lại theo từng feature (ProseMirror: chỉ thêm mark/node vào Schema khi feature bật). */
const TAGS_BY_FEATURE: Record<Feature, string[]> = {
  bold: ['strong', 'b'],
  italic: ['em', 'i'],
  code: ['code'],
  link: ['a'],
  codeBlock: ['pre'],
  list: ['ul', 'ol', 'li'],
};
const ALWAYS = ['p', 'br'];

export function allowedTags(features: Set<Feature>): Set<string> {
  const tags = new Set(ALWAYS);
  features.forEach((f) => TAGS_BY_FEATURE[f].forEach((t) => tags.add(t)));
  return tags;
}

/**
 * Lọc HTML theo "schema": thẻ không cho phép thì bỏ thẻ, giữ chữ bên trong
 * (giống cách ProseMirror bỏ qua mark/node không có trong schema khi parse).
 * Link phải qua checkHref; href lưu lại là giá trị đã chuẩn hoá, không phải chuỗi gốc.
 */
export function filterToSchema(html: string, features: Set<Feature>): string {
  const allowed = allowedTags(features);
  const root = parseInert(html);

  const visit = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      let el = child as Element;
      visit(el);
      // Google Docs không dùng <b>/<i> mà dùng <span style="font-weight:700">: đổi sang thẻ ngữ nghĩa
      // (ProseMirror: parse rule theo style, Udemy dùng /^(bold(er)?|[5-9]\d{2,})$/ cho font-weight)
      const semantic = styleToTag(el as HTMLElement);
      if (semantic) {
        const replacement = getDetachedDoc().createElement(semantic);
        replacement.append(...Array.from(el.childNodes));
        el.replaceWith(replacement);
        el = replacement;
      }
      const tag = el.tagName.toLowerCase();
      // <b style="font-weight:normal"> là vỏ bọc Google Docs thêm vào, không phải chữ đậm
      const fakeBold = tag === 'b' && (el as HTMLElement).style.fontWeight === 'normal';
      if (!allowed.has(tag) || fakeBold) {
        if (tag === 'script' || tag === 'style') el.remove();
        else el.replaceWith(...Array.from(el.childNodes));
        continue;
      }
      // bỏ mọi attribute, trừ href đã kiểm tra
      const href = tag === 'a' ? el.getAttribute('href') : null;
      for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
      if (tag === 'a') {
        const check = href ? checkHref(href) : null;
        if (check?.ok) el.setAttribute('href', check.href);
        else el.replaceWith(...Array.from(el.childNodes));
      }
    }
  };
  visit(root);
  return root.innerHTML;
}

function styleToTag(el: HTMLElement): 'strong' | 'em' | null {
  if (el.tagName !== 'SPAN') return null;
  if (/^(bold(er)?|[6-9]\d{2})$/.test(el.style.fontWeight)) return 'strong';
  if (el.style.fontStyle === 'italic') return 'em';
  return null;
}

// ---------- 2. Dán từ IDE (ProseMirror: EditorProps.transformPastedHTML) ----------

/** Chữ trong một nút, coi <br> và mỗi <div> con là xuống dòng. Không sửa nút đầu vào. */
export function textWithNewlines(node: Element): string {
  const clone = node.cloneNode(true) as Element;
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  clone.querySelectorAll('div').forEach((div) => {
    if (!div.querySelector('div') && div.nextSibling) div.append('\n');
  });
  return clone.textContent ?? '';
}

/**
 * VS Code dán <div style="white-space: pre">, PyCharm dán <pre> có <br> bên trong.
 * Chuẩn hoá về <pre>text</pre>; nếu editor không có code block thì mỗi dòng một <p>.
 */
export function normalizePastedHtml(html: string, opts: { codeBlock: boolean }): string {
  const doc = getDetachedDoc();
  const root = parseInert(html);

  const toParagraphs = (el: Element, text: string) => {
    for (const line of text.split('\n')) {
      const p = doc.createElement('p');
      p.textContent = line;
      el.before(p);
    }
    el.remove();
  };

  root.querySelectorAll('pre').forEach((pre) => {
    const text = textWithNewlines(pre);
    if (opts.codeBlock) pre.textContent = text;
    else toParagraphs(pre, text);
  });
  root.querySelectorAll('div').forEach((div) => {
    if ((div as HTMLElement).style.whiteSpace !== 'pre') return;
    const text = textWithNewlines(div);
    if (opts.codeBlock) {
      const pre = doc.createElement('pre');
      pre.textContent = text;
      div.replaceWith(pre);
    } else toParagraphs(div, text);
  });
  return root.innerHTML;
}

/** Dán chữ thuần: mỗi dòng một đoạn (ProseMirror: clipboardTextParser). */
export function textToParagraphs(text: string): string {
  const root = parseInert('');
  for (const line of text.split(/\r\n?|\n/)) {
    const p = getDetachedDoc().createElement('p');
    p.textContent = line;
    root.append(p);
  }
  return root.innerHTML;
}

// ---------- 3. Xuất HTML cho email (ProseMirror: DOMSerializer tuỳ biến) ----------

const NBSP = '\u00a0';

/**
 * Email client không hỗ trợ `white-space: pre-wrap`, nên nhiều dấu cách liền nhau bị gộp thành một.
 * Đổi chuỗi dấu cách thành NBSP và cách thường xen kẽ (vẫn xuống dòng được), và đổi cả dấu cách
 * đơn ở đầu/cuối đoạn (bản của Udemy bỏ sót hai trường hợp này).
 */
export function preserveSpaces(text: string, opts: { atStart: boolean; atEnd: boolean }): string {
  let out = text.replace(/ {2,}/g, (spaces) =>
    Array.from(spaces, (_, i) => (i % 2 === 0 ? NBSP : ' ')).join(''),
  );
  if (opts.atStart && out.startsWith(' ')) out = NBSP + out.slice(1);
  if (opts.atEnd && out.endsWith(' ')) out = out.slice(0, -1) + NBSP;
  return out;
}

/** HTML editor → HTML gửi email: giữ dấu cách, và đoạn rỗng <p></p> thành <p><br></p> để vẫn cao một dòng. */
export function toEmailHtml(html: string): string {
  const root = parseInert(html);
  root.querySelectorAll('p').forEach((p) => {
    if (p.childNodes.length === 0) p.append(getDetachedDoc().createElement('br'));
  });

  // Xử lý theo từng khối (đoạn, mục danh sách): biết nút chữ nào đứng đầu, nút nào đứng cuối khối.
  const blocks = [root, ...Array.from(root.querySelectorAll('p, li'))];
  for (const block of blocks) {
    const texts: Text[] = [];
    const walker = getDetachedDoc().createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode as Text;
      const owner = text.parentElement?.closest('p, li') ?? root;
      if (owner !== block) continue; // thuộc khối con, xử lý ở vòng của khối đó
      if (text.parentElement?.closest('pre, code')) continue; // code giữ nguyên
      // khoảng trắng định dạng giữa các thẻ khối (vd "\n  " giữa hai <p>): để nguyên, nếu không sẽ thành dòng thừa
      if (owner === root && text.data.trim() === '') continue;
      texts.push(text);
    }
    const nonEmpty = texts.filter((t) => t.data.trim() !== '');
    texts.forEach((text) => {
      text.data = preserveSpaces(text.data, {
        atStart: text === nonEmpty[0] || nonEmpty.length === 0,
        atEnd: text === nonEmpty[nonEmpty.length - 1] || nonEmpty.length === 0,
      });
    });
  }
  return root.innerHTML;
}
