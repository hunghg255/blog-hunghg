/* Service worker cho demo "Phát media qua Service Worker bằng Range request" (web-patterns #39).
 * File tĩnh trong public/: không qua Vite, nên viết JS thuần và không import được code TS.
 * Chỉ xử lý URL dưới `<scope>/sw-range/`; mọi request khác đi mạng như khi không có SW. */

const CACHE_PREFIX = 'sw-range-';
const CACHE_NAME = `${CACHE_PREFIX}v2`; // đổi format lưu -> đổi tên, activate sẽ dọn bản cũ
const PART_SIZE = 512 * 1024;
const MAX_END_TO_CACHE = 2 * 1024 * 1024 - 1; // chỉ cache 2MB đầu mỗi file (như Telegram)
const PART_TIMEOUT = 10000;

self.addEventListener('install', () => {
  // không chờ các tab cũ đóng hết mới kích hoạt
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME).map((n) => caches.delete(n)));
      // nhận điều khiển các trang đang mở ngay, khỏi bắt người dùng tải lại
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const base = new URL(self.registration.scope).pathname; // vd /demos/web-patterns/

  if (url.pathname.startsWith(`${base}sw-range/media/`)) {
    event.respondWith(respondRange(event, url));
  } else if (request.mode === 'navigate' && url.pathname === `${base}sw-range/old-link`) {
    // Link cũ: chuyển hướng bằng JS để giữ nguyên #hash (cách sendJavascriptRedirect của Outlook)
    event.respondWith(javascriptRedirect(`${base}index.html${url.search}`));
  }
  // còn lại: không gọi respondWith -> trình duyệt tự đi mạng
});

// Bản sao của parseRange trong src/lib/swRange.ts
function parseRange(header, size) {
  if (!(size > 0)) return null;
  const m = /^bytes=(\d*)-(\d*)/.exec(header || 'bytes=0-');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || end < start) return null;
  return { start, end: Math.min(end, start + PART_SIZE - 1) };
}

function headersFor(start, end, size, mime) {
  return {
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Content-Length': String(end - start + 1),
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
  };
}

async function respondRange(event, url) {
  const size = Number(url.searchParams.get('size'));
  const mime = url.searchParams.get('mime') || 'application/octet-stream';
  const id = decodeURIComponent(url.pathname.split('/').pop());
  const rangeHeader = event.request.headers.get('range');
  const range = parseRange(rangeHeader, size);
  const client = event.clientId ? await self.clients.get(event.clientId) : null;
  const log = (text, tone) => client && client.postMessage({ type: 'sw-log', text, tone });

  if (!range) {
    log(`${rangeHeader || '(không có Range)'} → 416`, 'err');
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }

  // Cache API không nhận response 206 (cache.put ném TypeError), nên lưu phần thân như một
  // response 200 bình thường dưới key riêng, header thì dựng lại từ size/mime.
  const cacheKey = `${url.origin}${url.pathname}?size=${size}&start=${range.start}&end=${range.end}`;
  const cacheable = range.end <= MAX_END_TO_CACHE;
  if (cacheable) {
    const cached = await caches.open(CACHE_NAME).then((c) => c.match(cacheKey));
    if (cached) {
      const body = await cached.arrayBuffer();
      log(`${rangeHeader} → 206 ${range.start}-${range.end} (từ Cache Storage)`, 'ok');
      return new Response(body, { status: 206, statusText: 'Partial Content', headers: headersFor(range.start, range.end, size, mime) });
    }
  }

  const t0 = Date.now();
  let buffer;
  try {
    buffer = await requestPart(client, { type: 'requestPart', id, start: range.start, end: range.end });
  } catch (error) {
    log(`${rangeHeader} → 504 (${error.message})`, 'err');
    return new Response('', { status: 504, statusText: 'Part not available' });
  }

  // trang có thể trả ít hơn (cuối file): sửa `end` theo dữ liệu thật
  const end = range.start + buffer.byteLength - 1;
  if (cacheable) {
    event.waitUntil(caches.open(CACHE_NAME).then((c) => c.put(cacheKey, new Response(buffer.slice(0)))));
  }
  log(`${rangeHeader} → 206 ${range.start}-${end}/${size} (từ trang, ${Date.now() - t0}ms)`);
  return new Response(buffer, { status: 206, statusText: 'Partial Content', headers: headersFor(range.start, end, size, mime) });
}

/** Hỏi trang đúng tab đã gửi request; trả lời đi qua MessagePort riêng của lần hỏi này. */
function requestPart(client, message) {
  if (!client) return Promise.reject(new Error('không tìm thấy tab'));
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error('quá thời gian chờ'));
    }, PART_TIMEOUT);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      channel.port1.close();
      if (e.data && e.data.buffer) resolve(e.data.buffer);
      else reject(new Error((e.data && e.data.error) || 'trang không có dữ liệu'));
    };
    client.postMessage(message, [channel.port2]);
  });
}

function javascriptRedirect(target) {
  // JSON.stringify tạo chuỗi JS an toàn, không lo dấu nháy trong URL phá vỡ script
  const html = `<!doctype html><meta charset="utf-8"><script>location.replace(${JSON.stringify(target)} + location.hash)</script>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
