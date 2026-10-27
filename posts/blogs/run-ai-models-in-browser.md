---
title: 'Chạy AI Trực Tiếp Trong Trình Duyệt: Hướng Dẫn Thực Chiến Cho Frontend Dev (WebGPU, Transformers.js, WebLLM, Chrome Built-in AI)'
description: 'Khi nào nên chạy model ngay trên máy người dùng, WebGPU vs WASM, Transformers.js (sentiment, embeddings, Whisper), WebLLM với streaming chat, Prompt API/Summarizer của Chrome, Web Worker, cache model, progress UI và fallback về server'
date: '2026-10-23'
series: ai
seriesOrder: 3
author: hunghg255
image: https://blog.hunghg.me/blogs/browser-ai.png
tags: ['ai', 'webgpu', 'wasm', 'transformers-js', 'webllm', 'chrome', 'frontend', 'javascript']
---

# Chạy AI Trực Tiếp Trong Trình Duyệt: Hướng Dẫn Thực Chiến Cho Frontend Dev

## **Không cần GPU server, không cần API key — chỉ cần một tab trình duyệt và một chút kiên nhẫn lúc tải model**

---

Vài năm trước, "AI trên web" gần như đồng nghĩa với `fetch('/api/chat')`. Giờ thì khác: WebGPU đã có mặt trên phần lớn trình duyệt, Transformers.js đã lên v4, WebLLM chạy được LLM vài tỉ tham số ngay trong tab, và Chrome còn kèm sẵn một model (Gemini Nano) mà bạn gọi bằng JavaScript thuần.

Bài này dành cho frontend dev muốn biết: **khi nào nên đưa model xuống client, dùng công cụ nào, và làm sao để UX không thảm họa.**

---

## 1. Vì sao lại chạy model ở client?

| Lợi ích | Giải thích |
| --- | --- |
| **Riêng tư** | Dữ liệu (ảnh, giọng nói, văn bản nội bộ) không rời khỏi máy người dùng. Đây thường là lý do thuyết phục nhất với các sản phẩm y tế, tài chính, công cụ nội bộ. |
| **Chi phí** | Mỗi lần suy luận chạy bằng điện và phần cứng của người dùng. Bạn không trả tiền theo token hay thuê GPU. |
| **Offline** | Model đã cache xong thì tính năng vẫn chạy khi mất mạng — rất hợp với PWA. |
| **Độ trễ** | Không có round-trip mạng. Với các tác vụ nhỏ (phân loại, embeddings, gợi ý khi gõ) cảm giác gần như tức thì. |

### Nhưng cái giá phải trả là gì?

- **Kích thước model**: model phân loại nhỏ có thể chỉ vài chục MB, nhưng LLM dù đã lượng tử hóa 4-bit vẫn thường ở mức hàng trăm MB tới vài GB. Người dùng phải tải về ít nhất một lần.
- **Lần đầu chậm**: tải + biên dịch shader + khởi tạo model. Nếu không có progress UI, người dùng sẽ nghĩ trang bị treo.
- **Phần cứng không đồng đều**: RAM, VRAM, GPU tích hợp hay rời, điện thoại hay desktop… cùng một đoạn code có thể chạy mượt trên MacBook nhưng crash tab trên máy yếu.
- **Chất lượng**: model nhỏ chạy được trong trình duyệt không thể so với model lớn trên cloud. Hãy giao cho nó những việc vừa sức.

> Quy tắc ngón tay cái: **tác vụ hẹp, input nhạy cảm, tần suất cao** → cân nhắc client. **Suy luận phức tạp, cần kiến thức rộng** → để server lo.

---

## 2. WebGPU vs WASM

Hai "động cơ" chính để chạy model trong trình duyệt:

- **WASM (WebAssembly)**: chạy trên CPU, có SIMD và đa luồng (khi trang bật cross-origin isolation). Ưu điểm lớn nhất: **chạy ở mọi nơi**. Phù hợp với model nhỏ.
- **WebGPU**: truy cập GPU để tính toán tổng quát (compute shader). Nhanh hơn rõ rệt với model vừa và lớn, gần như bắt buộc nếu muốn chạy LLM. Theo tài liệu của Transformers.js, tính tới tháng 3/2026 WebGPU phủ khoảng 85% người dùng toàn cầu (theo caniuse) — tức là vẫn còn một phần đáng kể không có.

Kiểm tra WebGPU đúng cách — có `navigator.gpu` thôi là chưa đủ, phải xin được adapter:

```js
export async function detectWebGPU() {
  if (!('gpu' in navigator)) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}
```

Chiến lược phổ biến: **WebGPU nếu có, không thì WASM**, và nếu cả hai đều quá chậm thì gọi server.

---

## 3. Transformers.js — "Hugging Face pipeline" phiên bản JavaScript

[Transformers.js](https://huggingface.co/docs/transformers.js) (package `@huggingface/transformers`, hiện ở v4) chạy model ONNX bằng ONNX Runtime Web, hỗ trợ cả WASM lẫn WebGPU. API bám sát thư viện Python: tạo một `pipeline` cho một task, rồi gọi nó như một hàm.

```bash
npm i @huggingface/transformers
```

Hai option quan trọng nhất:

- `device`: `'webgpu'` hoặc `'wasm'`.
- `dtype`: độ chính xác/lượng tử hóa, ví dụ `'fp32'`, `'fp16'`, `'q8'`, `'q4'`. Danh sách khả dụng tùy từng model; dtype càng thấp thì file càng nhẹ nhưng có thể giảm chất lượng.

### 3.1. Phân tích cảm xúc (sentiment)

```js
import { pipeline } from '@huggingface/transformers';

const classify = await pipeline(
  'sentiment-analysis',
  'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
  { dtype: 'q8' }, // model nhỏ: WASM là đủ nhanh
);

const reviews = ['The checkout flow is so smooth!', 'App crashed twice today.'];
const results = await classify(reviews);
// → [{ label: 'POSITIVE', score: ... }, { label: 'NEGATIVE', score: ... }]
```

Lưu ý: model này chỉ được huấn luyện cho tiếng Anh. Với tiếng Việt hãy tìm model đa ngôn ngữ đã có bản ONNX trên Hugging Face Hub (lọc theo thư viện `transformers.js`).

### 3.2. Embeddings + tìm kiếm ngữ nghĩa ngay trên client

Embeddings biến câu chữ thành vector; hai câu cùng ý nghĩa sẽ có vector gần nhau. Ứng dụng: tìm kiếm trong tài liệu offline, gom nhóm ghi chú, gợi ý bài liên quan…

```js
import { pipeline } from '@huggingface/transformers';

const embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
  device: 'webgpu',
});

const docs = [
  'Cách cấu hình ESLint cho dự án React',
  'Tối ưu ảnh với next/image',
  'Hướng dẫn viết unit test bằng Vitest',
];

// normalize: true → vector có độ dài 1, nên dot product = cosine similarity
const docVecs = (await embed(docs, { pooling: 'mean', normalize: true })).tolist();

async function search(query) {
  const [q] = (await embed([query], { pooling: 'mean', normalize: true })).tolist();
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  return docs
    .map((text, i) => ({ text, score: dot(q, docVecs[i]) }))
    .sort((a, b) => b.score - a.score);
}

console.log(await search('testing component'));
```

> `all-MiniLM-L6-v2` mạnh nhất với tiếng Anh. Nếu nội dung chủ yếu là tiếng Việt, hãy chọn một model embedding đa ngôn ngữ.

### 3.3. Whisper: chuyển giọng nói thành văn bản

Pipeline `automatic-speech-recognition` nhận một `Float32Array` âm thanh mono **16 kHz**. Ta có thể dùng `AudioContext` để giải mã và resample file người dùng chọn:

```js
import { pipeline } from '@huggingface/transformers';

const transcriber = await pipeline(
  'automatic-speech-recognition',
  'onnx-community/whisper-tiny', // bản đa ngôn ngữ; whisper-tiny.en chỉ cho tiếng Anh
  { device: 'webgpu' },
);

async function fileToPCM16k(file) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  await ctx.close();
  return buffer.getChannelData(0); // lấy kênh đầu tiên
}

document.querySelector('#audio').addEventListener('change', async (e) => {
  const pcm = await fileToPCM16k(e.target.files[0]);
  const { text } = await transcriber(pcm, {
    language: 'vietnamese',
    task: 'transcribe',
    chunk_length_s: 30, // cắt audio dài thành từng đoạn 30s
    stride_length_s: 5,
  });
  document.querySelector('#output').textContent = text;
});
```

`whisper-tiny` nhẹ nhưng độ chính xác với tiếng Việt chỉ ở mức "dùng được". Nếu máy khỏe hơn, thử các bản `base`/`small` và đo lại.

---

## 4. WebLLM — chạy LLM với API kiểu OpenAI

[WebLLM](https://github.com/mlc-ai/web-llm) (package `@mlc-ai/web-llm`) của nhóm MLC biên dịch LLM sang WebGPU. Điểm hay: API `engine.chat.completions.create()` gần giống OpenAI SDK, nên code chat cũ chuyển sang khá dễ. **WebLLM yêu cầu WebGPU.**

```bash
npm i @mlc-ai/web-llm
```

### Streaming chat

```js
import { CreateMLCEngine } from '@mlc-ai/web-llm';

const MODEL = 'Llama-3.2-1B-Instruct-q4f16_1-MLC'; // model nhỏ, hợp để thử

const engine = await CreateMLCEngine(MODEL, {
  initProgressCallback: ({ progress, text }) => {
    progressBar.value = progress; // 0 → 1
    statusEl.textContent = text;
  },
});

const history = [{ role: 'system', content: 'Bạn là trợ lý ngắn gọn, trả lời bằng tiếng Việt.' }];

async function ask(question) {
  history.push({ role: 'user', content: question });

  const stream = await engine.chat.completions.create({
    messages: history,
    stream: true,
    temperature: 0.7,
  });

  let answer = '';
  for await (const chunk of stream) {
    answer += chunk.choices[0]?.delta?.content ?? '';
    outputEl.textContent = answer; // render dần từng token
  }

  history.push({ role: 'assistant', content: answer });
}
```

Danh sách model ID có sẵn nằm trong `prebuiltAppConfig.model_list` (export từ package). Bạn có thể dùng `engine.interruptGenerate()` cho nút "Dừng".

> Một model 1B lượng tử hóa 4-bit chạy được trên nhiều laptop, nhưng đừng kỳ vọng nó giỏi như model cloud. Nó hợp với việc viết lại câu, trích xuất thông tin, phân loại theo prompt, trả lời dựa trên ngữ cảnh bạn đưa vào.

---

## 5. Chrome Built-in AI — model có sẵn trong trình duyệt

Thay vì bắt bạn tự tải model, Chrome cung cấp các API gọi tới **Gemini Nano** do trình duyệt quản lý. Model được tải **một lần** cho cả trình duyệt (không phải mỗi website một bản).

### Trạng thái hiện tại (tháng 10/2026, theo tài liệu Chrome for Developers)

| API | Trạng thái trên web |
| --- | --- |
| Translator, Language Detector, Summarizer | Stable từ **Chrome 138** |
| Prompt API (`LanguageModel`) | Stable trên web từ **Chrome 148** (trước đó chỉ cho Extensions từ Chrome 138). Hỗ trợ input text, ảnh, audio và ràng buộc output theo JSON Schema/regex. Tham số sampling (`samplingMode`) vẫn đang ở origin trial |
| Writer, Rewriter, Proofreader | Mới ở dạng developer trial (cần bật flag, chưa dùng được cho người dùng thật) |

Yêu cầu phần cứng cũng khá "khó tính": **chỉ desktop** (Windows 10/11, macOS 13+, Linux, ChromeOS trên Chromebook Plus — chưa có Android/iOS), cần ít nhất **22 GB trống** trên ổ chứa profile Chrome, GPU **trên 4 GB VRAM** hoặc CPU với **16 GB RAM và 4 nhân** trở lên, và mạng không giới hạn dung lượng cho lần tải đầu. Nói cách khác: **luôn luôn phải có fallback.** Chi tiết có thể thay đổi theo phiên bản, hãy kiểm tra lại docs trước khi ship.

### Prompt API

```js
async function createChatSession() {
  if (!('LanguageModel' in self)) return null;

  const options = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  };

  // 'unavailable' | 'downloadable' | 'downloading' | 'available'
  const status = await LanguageModel.availability(options);
  if (status === 'unavailable') return null;

  // create() cần user activation (ví dụ gọi trong click handler) nếu phải tải model
  return LanguageModel.create({
    ...options,
    initialPrompts: [{ role: 'system', content: 'You tag support tickets.' }],
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        progressBar.value = e.loaded; // 0 → 1
      });
    },
  });
}

button.addEventListener('click', async () => {
  const session = await createChatSession();
  if (!session) return fallbackToServer();

  // Ép output theo JSON Schema
  const schema = {
    type: 'object',
    properties: {
      category: { enum: ['billing', 'bug', 'feature-request', 'other'] },
      urgent: { type: 'boolean' },
    },
    required: ['category', 'urgent'],
  };
  const raw = await session.prompt(ticketText, { responseConstraint: schema });
  const { category, urgent } = JSON.parse(raw);

  // Hoặc stream:
  for await (const piece of session.promptStreaming('Suggest a polite reply.')) {
    replyEl.textContent += piece;
  }
});
```

Mẹo: truyền **cùng một bộ options** cho `availability()` và `create()`/`prompt()` — model có thể hỗ trợ ngôn ngữ/modality này nhưng không hỗ trợ cái khác. Kiểm tra danh sách ngôn ngữ được hỗ trợ trong docs trước khi dùng cho tiếng Việt.

### Summarizer API

```js
if ('Summarizer' in self && (await Summarizer.availability()) !== 'unavailable') {
  const summarizer = await Summarizer.create({
    type: 'key-points', // 'tldr' | 'teaser' | 'headline' | 'key-points'
    format: 'markdown',
    length: 'short',
  });

  const summary = await summarizer.summarize(articleEl.innerText, {
    context: 'Bài viết kỹ thuật dành cho lập trình viên frontend.',
  });
  summaryEl.innerHTML = renderMarkdown(summary);
}
```

Cài thêm `@types/dom-chromium-ai` nếu bạn dùng TypeScript.

---

## 6. Kiến trúc để UI không bị đơ

### 6.1. Đưa model vào Web Worker

Suy luận là việc nặng. Chạy nó trên main thread = trang giật, input không phản hồi. Hãy đẩy vào worker và giao tiếp bằng message.

**`ai.worker.js`** (Transformers.js):

```js
import { pipeline } from '@huggingface/transformers';

let extractorPromise = null;

function getExtractor(device) {
  // Singleton: chỉ load model một lần dù có nhiều message
  extractorPromise ??= pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    device,
    progress_callback: (p) => self.postMessage({ type: 'progress', payload: p }),
  });
  return extractorPromise;
}

self.addEventListener('message', async ({ data }) => {
  const { id, texts, device } = data;
  try {
    const extractor = await getExtractor(device);
    const out = await extractor(texts, { pooling: 'mean', normalize: true });
    self.postMessage({ type: 'result', id, payload: out.tolist() });
  } catch (err) {
    self.postMessage({ type: 'error', id, payload: String(err) });
  }
});
```

**Main thread:**

```js
const worker = new Worker(new URL('./ai.worker.js', import.meta.url), { type: 'module' });
const pending = new Map();
let nextId = 0;

worker.addEventListener('message', ({ data }) => {
  if (data.type === 'progress') return updateProgress(data.payload);
  const job = pending.get(data.id);
  if (!job) return;
  pending.delete(data.id);
  data.type === 'result' ? job.resolve(data.payload) : job.reject(new Error(data.payload));
});

export function embedTexts(texts, device = 'wasm') {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, texts, device });
  });
}
```

WebLLM có sẵn cặp helper cho việc này, API phía main thread giữ nguyên:

```js
// llm.worker.js
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
```

```js
// main.js
import { CreateWebWorkerMLCEngine } from '@mlc-ai/web-llm';

const engine = await CreateWebWorkerMLCEngine(
  new Worker(new URL('./llm.worker.js', import.meta.url), { type: 'module' }),
  'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  { initProgressCallback: ({ progress }) => (progressBar.value = progress) },
);
// engine.chat.completions.create(...) dùng y như trước
```

### 6.2. Cache model

- **Transformers.js** mặc định cache file model bằng **Cache API** của trình duyệt (`env.useBrowserCache`), nên lần mở sau không tải lại. v4 có thêm `ModelRegistry` để kiểm tra trước dung lượng tải (`get_pipeline_files` + `get_file_metadata`), xem model đã cache chưa (`is_pipeline_cached`) và xóa cache (`clear_pipeline_cache`).
- **WebLLM** cũng cache bằng Cache API mặc định, có thể chuyển sang IndexedDB qua `appConfig`.
- Gọi `navigator.storage.persist()` để giảm khả năng trình duyệt tự dọn cache khi thiếu dung lượng, và dùng `navigator.storage.estimate()` để kiểm tra còn đủ chỗ trước khi tải model lớn.
- Tự host model trên CDN của bạn (thay vì tải từ Hugging Face) nếu cần kiểm soát phiên bản và băng thông — Transformers.js cho phép đổi `env.remoteHost` / `env.localModelPath`.

### 6.3. Progress UI đàng hoàng

Người dùng chấp nhận chờ nếu họ **biết** mình đang chờ cái gì:

```js
const files = new Map();

function updateProgress(p) {
  // Transformers.js gửi các status: 'initiate' | 'download' | 'progress' | 'done' | 'ready'
  if (p.status === 'progress') files.set(p.file, { loaded: p.loaded, total: p.total });
  if (p.status === 'ready') return (statusEl.textContent = 'Sẵn sàng ✅');

  const loaded = [...files.values()].reduce((s, f) => s + f.loaded, 0);
  const total = [...files.values()].reduce((s, f) => s + f.total, 0);
  if (total) {
    progressBar.value = loaded / total;
    statusEl.textContent = `Đang tải model: ${(loaded / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`;
  }
}
```

Thêm vào đó:

- **Hỏi trước khi tải model lớn**, nhất là trên mạng di động (hiện nút "Bật AI offline (~X MB)").
- **Khởi tạo lười (lazy)**: chỉ load khi người dùng thật sự dùng tính năng, hoặc preload khi trình duyệt rảnh (`requestIdleCallback`).

### 6.4. Feature detection + fallback về server

Gom tất cả vào một lớp "chọn backend" để phần UI không cần quan tâm model chạy ở đâu:

```js
export async function pickSummarizerBackend() {
  // 1. Model sẵn trong trình duyệt: không tốn băng thông của bạn
  if ('Summarizer' in self) {
    const s = await Summarizer.availability();
    if (s === 'available' || s === 'downloadable') return 'chrome-builtin';
  }

  // 2. Có WebGPU và máy đủ khỏe → tự chạy model
  const memoryGB = navigator.deviceMemory ?? 4; // chỉ có trên Chromium, giá trị bị làm tròn/giới hạn
  if ((await detectWebGPU()) && memoryGB >= 8) return 'webllm';

  // 3. Còn lại: gọi API server
  return 'server';
}
```

Luôn bọc bước load model trong `try/catch` — mất context GPU, hết bộ nhớ, hay tải file bị gián đoạn đều có thể xảy ra, và khi đó hãy rơi về server thay vì hiện màn hình trắng.

---

## 7. So sánh nhanh các lựa chọn

| | Transformers.js | WebLLM | Chrome Built-in AI | API server |
| --- | --- | --- | --- | --- |
| **Phù hợp nhất** | Tác vụ ML "cổ điển": phân loại, embeddings, ASR, vision | Chat/LLM tự chọn model | Tóm tắt, dịch, prompt nhẹ mà không phải tải model riêng | Model lớn, chất lượng cao nhất |
| **Backend** | WASM hoặc WebGPU | WebGPU (bắt buộc) | Do Chrome quản lý (GPU/CPU) | Server |
| **Ai tải model** | Website của bạn | Website của bạn | Chrome (dùng chung mọi site) | Không ai |
| **Trình duyệt** | Hầu hết trình duyệt hiện đại | Trình duyệt có WebGPU | Chỉ Chrome desktop đủ cấu hình | Mọi nơi |
| **Chọn model** | Hàng nghìn model ONNX trên Hub | Danh sách model đã biên dịch cho MLC | Không chọn được (Gemini Nano) | Tùy ý |
| **Offline** | Có (sau khi cache) | Có (sau khi cache) | Có (sau khi tải model) | Không |
| **Chi phí phía bạn** | Băng thông tải model | Băng thông tải model | ~0 | Tiền theo request/token |

---

## 8. Mẹo thực chiến

1. **Bắt đầu từ bài toán nhỏ.** Embeddings cho tìm kiếm, phân loại nội dung, speech-to-text ngắn — đây là những nơi client-side AI tỏa sáng.
2. **Chọn dtype có chủ đích.** Thử `q8`/`q4` trước để giảm dung lượng, so sánh chất lượng với `fp16`/`fp32` trên dữ liệu thật của bạn.
3. **Đo trên máy yếu nhất bạn hỗ trợ**, không phải trên MacBook của dev. Dùng Performance panel để xem main thread có bị chặn không.
4. **Luôn chạy trong Worker**, luôn có progress UI, luôn có nút hủy.
5. **Không giả định model sẵn sàng.** Mọi API (đặc biệt Chrome built-in) có thể trả về `unavailable` vì cấu hình, dung lượng ổ đĩa hay chính sách doanh nghiệp.
6. **Thiết kế progressive enhancement**: tính năng hoạt động bằng server trước, client-side AI là "lớp tăng tốc + riêng tư" khi có điều kiện.
7. **Bật cross-origin isolation** (header `COOP: same-origin` + `COEP: require-corp`) nếu muốn WASM chạy đa luồng.
8. **Minh bạch với người dùng**: nói rõ dữ liệu được xử lý ngay trên máy họ — đó là một điểm bán hàng, hãy tận dụng.

---

## Tổng kết

Chạy AI trong trình duyệt không còn là demo cho vui. Với **Transformers.js** cho các tác vụ ML quen thuộc, **WebLLM** cho LLM tự chọn, và **Chrome Built-in AI** cho những tác vụ phổ biến mà không phải tải gì, frontend dev giờ có thể xây những tính năng AI riêng tư, rẻ và chạy được offline.

Nhưng "chạy được" khác với "trải nghiệm tốt". Phần việc thật sự của chúng ta là những thứ quen thuộc: Web Worker, cache, progress UI, feature detection và fallback. Làm tốt mấy thứ đó, người dùng sẽ chỉ thấy một điều: tính năng nhanh và dữ liệu của họ không đi đâu cả. 🚀
