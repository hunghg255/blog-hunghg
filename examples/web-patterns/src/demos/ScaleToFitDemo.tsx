import { useEffect, useRef, useState } from 'react';
import { autoScaleTables, EMOJI_FONT_FACE, hasEmoji, patchEmojiFonts, resetScale, type ScaleResult } from '../lib/scaleToFit';
import { Log, Stat, useLog } from './shared';
import './ScaleToFitDemo.css';

// Ảnh "tải chậm": src được gán sau 1,2 giây để thấy vì sao phải đợi ảnh rồi mới đo
const BANNER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="140"><rect width="600" height="140" fill="#ff8a3d"/><text x="24" y="84" font-size="40" font-family="Arial" fill="#fff">SALE 50% · 600×140</text></svg>`,
  );

// Bản tin kiểu email marketing: bảng ngoài 640px, bảng lồng bên trong, font-family inline
const NEWSLETTER = `
<table width="640" cellpadding="0" cellspacing="0" style="margin:0 auto;background:#ffffff;color:#222;font-family:Georgia">
  <tr><td style="padding:20px;font-size:22px;font-weight:bold">Bản tin tuần 43 📬</td></tr>
  <tr><td style="padding:0 20px"><img data-src="${BANNER}" width="600" alt="Banner" style="display:block;min-height:20px;background:#eee"></td></tr>
  <tr><td style="padding:16px 20px">
    <table width="600" cellpadding="8" cellspacing="0" style="border:1px solid #ddd">
      <tr style="background:#f5f5f5"><th align="left">Sản phẩm</th><th align="right">Giá cũ</th><th align="right">Giá mới</th></tr>
      <tr><td>Tai nghe chống ồn 🎧</td><td align="right">2.490.000đ</td><td align="right" style="color:#d93025">1.245.000đ</td></tr>
      <tr><td>Bàn phím cơ ⌨️</td><td align="right">1.890.000đ</td><td align="right" style="color:#d93025">945.000đ</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:0 20px 20px;font-size:12px;color:#777">Bạn nhận email này vì đã đăng ký nhận tin. Huỷ đăng ký · Liên hệ</td></tr>
</table>`;

type Mode = 'overflow' | 'scale';

export default function ScaleToFitDemo() {
  const paneRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [mode, setMode] = useState<Mode>('scale');
  const [results, setResults] = useState<ScaleResult[]>([]);
  const [patched, setPatched] = useState<string | null>(null);
  const { lines, add } = useLog(8);

  // Mỗi lần đổi chế độ: dựng lại HTML (để có "ảnh tải chậm" mới) rồi gắn auto-scale
  useEffect(() => {
    const pane = paneRef.current!;
    pane.innerHTML = NEWSLETTER;
    setResults([]);
    const img = pane.querySelector<HTMLImageElement>('img[data-src]')!;
    const imgTimer = setTimeout(() => {
      img.src = img.dataset.src!;
      add('Ảnh banner tải xong (sau 1,2s)', 'muted');
    }, 1200);
    if (mode === 'overflow') {
      add('Chế độ tràn: bảng 640px nằm nguyên, khung phải cuộn ngang', 'warn');
      return () => clearTimeout(imgTimer);
    }
    // ảnh chưa có src thì chưa tính là "đang tải"; đợi gán src xong mới bắt đầu
    let stop = () => {};
    let lastScale = -1;
    const startTimer = setTimeout(() => {
      add('Đợi ảnh trong bảng tải xong (tối đa 2s) rồi mới đo');
      stop = autoScaleTables(pane, (r) => {
        setResults(r);
        const main = r[0];
        // ResizeObserver gọi cả lúc vừa observe: chỉ ghi log khi scale thật sự đổi
        if (main && main.scale !== lastScale) {
          lastScale = main.scale;
          add(`scale = ${main.scale.toFixed(3)} (khung ${pane.clientWidth}px / bảng 640px)`, 'ok');
        }
      });
    }, 1210);
    return () => {
      clearTimeout(imgTimer);
      clearTimeout(startTimer);
      stop();
    };
  }, [mode, add]);

  const main = results[0];

  return (
    <div className='page s2f'>
      <style>{EMOJI_FONT_FACE}</style>
      <h1>Thu nhỏ bảng rộng cho vừa khung đọc</h1>
      <p className='hint'>
        Bản tin email có bảng rộng cố định 640px. Kéo thanh trượt để đổi bề rộng khung đọc: chế độ "Thu nhỏ" tính lại scale
        mỗi lần khung đổi cỡ, chỉ thu nhỏ bảng ngoài cùng (bảng lồng bên trong đi theo).
      </p>
      <div className='toolbar' role='group' aria-label='Chế độ'>
        <button className={mode === 'overflow' ? 'primary' : ''} aria-pressed={mode === 'overflow'} onClick={() => setMode('overflow')}>
          Để tràn
        </button>
        <button className={mode === 'scale' ? 'primary' : ''} aria-pressed={mode === 'scale'} onClick={() => setMode('scale')}>
          Thu nhỏ (kiểu Outlook)
        </button>
        {main && main.scale < 1 && (
          <button
            onClick={() => {
              resetScale(main.element);
              main.element.parentElement!.style.overflowX = 'auto';
              add('Phóng to: bỏ scale, cho cuộn ngang trong khung', 'muted');
            }}
          >
            🔍 Xem kích thước thật
          </button>
        )}
      </div>
      <label className='s2f-range'>
        Bề rộng khung đọc: <b>{width}px</b>
        <input type='range' min={260} max={760} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
      </label>

      <div className='s2f-frame' style={{ width: `min(${width}px, 100%)` }}>
        <div ref={paneRef} className={`s2f-pane ${mode}`} data-testid='pane' />
      </div>

      <div className='stats'>
        <Stat label='scale bảng ngoài' value={main ? main.scale.toFixed(3) : '…'} />
        <Stat label='bảng được scale' value={results.filter((r) => r.scale < 1).length} />
        <Stat label='cao wrapper' value={main?.element.parentElement?.style.height || '–'} />
      </div>

      <div className='card'>
        <b>Vá font emoji</b>
        <p className='muted'>
          Email đặt <code>font-family: Georgia</code>. Font đó không có emoji, trình duyệt phải tự đoán font dự phòng (trên
          Windows đời cũ hay ra ký tự đen trắng). Vá: nối <code>, serif, EmojiFont</code> với EmojiFont là{' '}
          <code>@font-face</code> trỏ vào font emoji có sẵn trên máy.
        </p>
        <button
          onClick={() => {
            const pane = paneRef.current!;
            if (!hasEmoji(pane.textContent ?? '')) return;
            const n = patchEmojiFonts(pane);
            const first = pane.querySelector<HTMLElement>('[style*="font-family"]');
            setPatched(first?.style.fontFamily ?? null);
            add(`Vá font-family cho ${n} phần tử`, 'ok');
          }}
        >
          Vá font emoji trong khung
        </button>
        {patched && (
          <p>
            font-family sau khi vá: <code data-testid='patched'>{patched}</code>
          </p>
        )}
      </div>
      <Log lines={lines} />
    </div>
  );
}
