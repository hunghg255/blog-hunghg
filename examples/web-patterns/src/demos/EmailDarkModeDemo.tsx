import { useEffect, useRef, useState } from 'react';
import {
  applyDarkMode,
  copyWithOriginalColors,
  undoDarkMode,
  type ChangedElement,
} from '../lib/emailDarkMode';
import { Log, Stat, useLog } from './shared';
import './EmailDarkModeDemo.css';

// "Ảnh" trong email: một phong cảnh SVG, để thấy filter: invert làm hỏng ảnh thế nào
const PHOTO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><defs><linearGradient id="s" x2="0" y2="1"><stop offset="0" stop-color="#7cc4ff"/><stop offset="1" stop-color="#ffe7b0"/></linearGradient></defs><rect width="320" height="120" fill="url(#s)"/><circle cx="250" cy="40" r="18" fill="#ffb300"/><path d="M0 120 L80 55 L140 100 L200 50 L320 120Z" fill="#2e7d32"/></svg>`,
  );

// Email "thật": style inline, bảng, thuộc tính bgcolor/color kiểu cũ, đúng như HTML email ngoài đời
const EMAIL_HTML = `
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f3f4;font-family:Arial,sans-serif">
  <tr><td style="padding:16px">
    <table width="100%" bgcolor="#ffffff" cellpadding="16" cellspacing="0" style="border-radius:8px">
      <tr><td>
        <h2 style="color:#0b57d0;margin:0 0 8px">Ưu đãi tháng 10 🎉</h2>
        <p style="color:#333333;margin:0 0 12px">Chào bạn, đơn hàng <b>#4821</b> đã được giao. Cảm ơn bạn đã mua sắm!</p>
        <img src="${PHOTO}" alt="Ảnh sản phẩm" width="100%" style="display:block;border-radius:6px;max-width:320px">
        <p style="margin:12px 0"><span style="background-color:#fde293;color:#000000;padding:2px 4px">Mã giảm giá: OCT20</span></p>
        <p style="margin:0 0 12px"><font color="#d93025">Chỉ còn 2 ngày!</font> · <span style="color:#188038">Miễn phí vận chuyển</span></p>
        <a href="#" style="display:inline-block;background-color:#0b57d0;color:#ffffff;padding:8px 14px;border-radius:6px;text-decoration:none">Xem đơn hàng</a>
        <p style="color:#7a7a7a;font-size:12px;margin:16px 0 0">Bạn nhận email này vì đã đăng ký tại shop.example.</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;

const DARK_BASE = '#1f1f1f';

export default function EmailDarkModeDemo() {
  const labRef = useRef<HTMLDivElement>(null);
  const [changes, setChanges] = useState<ChangedElement[]>([]);
  const [isDark, setIsDark] = useState(false);
  const [pasted, setPasted] = useState<string | null>(null);
  const { lines, add } = useLog(8);

  const toggle = () => {
    const root = labRef.current!;
    if (isDark) {
      undoDarkMode(root);
      setChanges([]);
      add('Hoàn tác: trả màu gốc từ data-og-*', 'muted');
    } else {
      const t0 = performance.now();
      const list = applyDarkMode(root, DARK_BASE);
      setChanges(list);
      add(`Sửa ${list.length} màu trong ${(performance.now() - t0).toFixed(1)}ms`, 'ok');
    }
    setIsDark(!isDark);
  };

  const startedRef = useRef(false);
  useEffect(() => {
    // bật sẵn dark mode khi mở demo (StrictMode chạy effect 2 lần, nên chặn bằng ref)
    if (startedRef.current) return;
    startedRef.current = true;
    toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className='page edm'>
      <h1>Dark mode cho email HTML</h1>
      <p className='hint'>
        Cùng một email: bản gốc, bản đảo màu bằng <code>filter: invert()</code>, và bản đổi màu trong CIELAB như Outlook
        (chỉ đổi độ sáng L*, giữ sắc độ). Bôi đen một đoạn ở khung thứ ba rồi copy, dán vào ô cuối để xem màu được chép.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={toggle}>
          {isDark ? 'Hoàn tác (về màu gốc)' : 'Bật dark mode CIELAB'}
        </button>
      </div>

      <div className='edm-grid'>
        <figure>
          <figcaption>Gốc (nền sáng)</figcaption>
          <div className='edm-mail edm-light' dangerouslySetInnerHTML={{ __html: EMAIL_HTML }} />
        </figure>
        <figure>
          <figcaption>
            <code>filter: invert(1) hue-rotate(180deg)</code>
          </figcaption>
          <div className='edm-mail edm-invert' dangerouslySetInnerHTML={{ __html: EMAIL_HTML }} />
        </figure>
        <figure>
          <figcaption>CIELAB, chỉ sửa chỗ thiếu tương phản</figcaption>
          <div
            ref={labRef}
            className='edm-mail edm-dark'
            style={{ background: DARK_BASE }}
            data-testid='lab'
            onCopy={() => {
              copyWithOriginalColors(labRef.current!);
              add('copy: tạm trả màu gốc, frame sau đặt lại dark mode');
            }}
            dangerouslySetInnerHTML={{ __html: EMAIL_HTML }}
          />
        </figure>
      </div>

      <div className='stats'>
        <Stat label='màu bị sửa' value={changes.length} />
        <Stat label='màu chữ' value={changes.filter((c) => c.property === 'color').length} />
        <Stat label='màu nền' value={changes.filter((c) => c.property === 'background-color').length} />
      </div>

      {changes.length > 0 && (
        <div className='edm-table-wrap'>
          <table className='edm-table'>
            <thead>
              <tr>
                <th>Phần tử</th>
                <th>Thuộc tính</th>
                <th>Trước</th>
                <th>Sau</th>
                <th>Tương phản</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c, i) => (
                <tr key={i}>
                  <td>
                    <code>{c.element.tagName.toLowerCase()}</code>
                  </td>
                  <td>{c.property === 'color' ? 'chữ' : 'nền'}</td>
                  <td>
                    <i className='edm-swatch' style={{ background: c.before }} /> {c.before}
                  </td>
                  <td>
                    <i className='edm-swatch' style={{ background: c.after }} /> {c.after}
                  </td>
                  <td>
                    <span className='err'>{c.contrastBefore.toFixed(2)}</span> →{' '}
                    <span className='ok'>{c.contrastAfter.toFixed(2)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className='card'>
        <b>Dán vào đây (giả lập Word/Gmail nền trắng)</b>
        <div
          className='edm-paste'
          contentEditable
          suppressContentEditableWarning
          aria-label='Ô dán thử'
          onPaste={(e) => {
            e.preventDefault();
            const html = e.clipboardData.getData('text/html');
            setPasted(html || e.clipboardData.getData('text/plain'));
            add(`Dán ${html ? 'HTML' : 'text'}: ${html.length} ký tự`);
          }}
        >
          Bấm vào đây rồi Ctrl/⌘+V
        </div>
        {pasted !== null && (
          // sandbox rỗng: không chạy script, không cùng origin. Nội dung dán vào là dữ liệu lạ.
          <iframe className='edm-pasted' title='Nội dung đã dán' sandbox='' srcDoc={pasted} />
        )}
      </div>
      <Log lines={lines} />
    </div>
  );
}
