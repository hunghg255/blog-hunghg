import { useEffect, useMemo, useState } from 'react';
import {
  CLEARKEY,
  CLEARKEY_CONFIG,
  DASH_CONFIG,
  FAIRPLAY,
  HLS_CONFIG,
  PLAYREADY,
  WIDEVINE,
  buildPlayerDrmConfig,
  bytesToBase64,
  chooseKeySystem,
  createKeySystemProber,
  fairPlayContentId,
  fairPlayRequest,
  fairPlayResponse,
  playReadyRequest,
  shortName,
  widevineRequest,
  type KeySystem,
  type ProbeResult,
} from '../lib/udDrm';
import './UdDrmDemo.css';

const PROBES: Array<[KeySystem, MediaKeySystemConfiguration]> = [
  [WIDEVINE, DASH_CONFIG],
  [FAIRPLAY, HLS_CONFIG],
  [PLAYREADY, DASH_CONFIG],
  [CLEARKEY, CLEARKEY_CONFIG],
];

const probe = createKeySystemProber();

/** SPC giả: vài byte cố định sao cho base64 chắc chắn có dấu "+" và "/". */
const FAKE_SPC = new Uint8Array([0xfb, 0xef, 0xbe, 0x10, 0x20, 0xff, 0xfe, 0x3e, 0x00, 0x7f, 0xf8, 0x3f]);
const CONTENT_ID = '9e5037892023e3ccab2815a6adf7d05b';

/** Key message PlayReady mẫu (CDM thật trả về XML này dưới dạng UTF-16LE). */
function samplePlayReadyMessage() {
  const challenge = btoa('<soap:Envelope>...challenge...</soap:Envelope>');
  const xml =
    '<PlayReadyKeyMessage type="LicenseAcquisition"><LicenseAcquisition Version="1">' +
    `<Challenge encoding="base64encoded">${challenge}</Challenge>` +
    '<HttpHeaders>' +
    '<HttpHeader><name>Content-Type</name><value>text/xml; charset=utf-8</value></HttpHeader>' +
    '<HttpHeader><name>SOAPAction</name><value>"http://schemas.microsoft.com/DRM/2007/03/protocols/AcquireLicense"</value></HttpHeader>' +
    '</HttpHeaders></LicenseAcquisition></PlayReadyKeyMessage>';
  const bytes = new Uint8Array(xml.length * 2);
  for (let i = 0; i < xml.length; i++) {
    bytes[i * 2] = xml.charCodeAt(i) & 0xff;
    bytes[i * 2 + 1] = xml.charCodeAt(i) >> 8;
  }
  return bytes;
}

/** Init data FairPlay mẫu: chuỗi skd://… mã hoá UTF-16LE như Safari đưa ra. */
function sampleFairPlayInitData() {
  const text = `skd://${CONTENT_ID}`;
  const bytes = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) bytes[i * 2] = text.charCodeAt(i);
  return bytes;
}

function hex(bytes: Uint8Array, max = 12) {
  return Array.from(bytes.subarray(0, max), (b) => b.toString(16).padStart(2, '0')).join(' ') + (bytes.length > max ? ' …' : '');
}

export default function UdDrmDemo() {
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [running, setRunning] = useState(false);
  const [encode, setEncode] = useState(false);
  const [serverDecodes, setServerDecodes] = useState(true);

  async function runProbe() {
    setRunning(true);
    const out: ProbeResult[] = [];
    for (const [keySystem, config] of PROBES) out.push(await probe(keySystem, config));
    setResults(out);
    setRunning(false);
  }

  useEffect(() => {
    void runProbe();
  }, []);

  const choice = useMemo(() => chooseKeySystem(results), [results]);
  const udemyChoice = choice.keySystem ?? WIDEVINE;

  const fairPlay = fairPlayRequest(FAKE_SPC, CONTENT_ID, encode);
  const spcSent = bytesToBase64(FAKE_SPC);
  // Server đọc body theo chuẩn form (URLSearchParams) hay đọc chuỗi thô?
  const spcReceived = serverDecodes
    ? new URLSearchParams(fairPlay.body as string).get('spc') ?? ''
    : /spc=([^&]*)/.exec(fairPlay.body as string)?.[1] ?? '';
  const spcIntact = spcReceived === spcSent;

  const playReady = useMemo(() => playReadyRequest(samplePlayReadyMessage()), []);
  const widevine = widevineRequest(new Uint8Array([0x08, 0x04, 0x12, 0x9a, 0x01]));
  const licenseBytes = fairPlayResponse(`${bytesToBase64(new Uint8Array([1, 2, 3, 250]))}\n`);

  const initData = sampleFairPlayInitData();
  const byteByByte = String.fromCharCode(...initData);
  const udemyStyle = String.fromCharCode.apply(null, initData.buffer as unknown as number[]);

  const udemyConfig = {
    drm: {
      servers: { [WIDEVINE]: 'https://license.example/widevine' },
      advanced: { WIDEVINE_KEY_SYSTEM: { videoRobustness: 'SW_SECURE_CRYPTO' } },
    },
  };
  const fixedConfig = buildPlayerDrmConfig(WIDEVINE, 'https://license.example/widevine');

  return (
    <div className='page ud-drm'>
      <h1>DRM đa hệ: Widevine, PlayReady, FairPlay</h1>
      <p className='hint'>
        Phần 1 dò thật trên trình duyệt bạn đang dùng bằng <code>requestMediaKeySystemAccess</code>. Phần 2 và 3 chỉ mô phỏng
        định dạng license request: không có license server thật.
      </p>

      <section className='card'>
        <h2>1. Trình duyệt này hỗ trợ hệ nào?</h2>
        <div className='toolbar'>
          <button className='primary' onClick={runProbe} disabled={running}>
            {running ? 'Đang dò…' : 'Dò lại'}
          </button>
          <span className='muted'>Lần dò thứ hai lấy từ cache, gần như 0ms.</span>
        </div>
        <table className='ud-drm-table' data-testid='probe-table'>
          <thead>
            <tr>
              <th>Hệ</th>
              <th>Kết quả</th>
              <th>Thời gian</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.keySystem} data-testid={`probe-${shortName(r.keySystem)}`}>
                <td>
                  {shortName(r.keySystem)}
                  <div className='muted small'>{r.keySystem}</div>
                </td>
                <td className={r.supported ? 'ok' : 'muted'}>{r.supported ? '✔ hỗ trợ' : `✘ ${r.error ?? 'không'}`}</td>
                <td>
                  {r.ms.toFixed(1)}ms {r.cached && <span className='badge'>cache</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className='split ud-drm-choice'>
          <div>
            <b>Bản viết lại chọn:</b>{' '}
            <span data-testid='choice'>{choice.keySystem ? `${shortName(choice.keySystem)} + ${choice.manifest?.toUpperCase()}` : 'không có'}</span>
            <div className='muted small'>{choice.reason}</div>
          </div>
          <div>
            <b>Kiểu Udemy chọn:</b> <span data-testid='udemy-choice'>{shortName(udemyChoice)}</span>
            <div className='muted small'>
              {choice.keySystem ? 'giống bản viết lại' : 'không dò được hệ nào vẫn "thử nốt" Widevine, lỗi sẽ đến muộn ở bước giải mã'}
            </div>
          </div>
        </div>
      </section>

      <section className='card'>
        <h2>2. Mỗi hệ một kiểu license request</h2>
        <div className='ud-drm-grid'>
          <div>
            <h3>Widevine</h3>
            <p className='muted small'>Gửi nguyên bytes CDM đưa ra, nhận bytes license.</p>
            <pre>{`Content-Type: ${widevine.headers['Content-Type']}\nbody: ${hex(widevine.body as Uint8Array)}`}</pre>
          </div>
          <div>
            <h3>PlayReady</h3>
            <p className='muted small'>CDM đưa XML UTF-16LE: lấy &lt;Challenge&gt; base64 ra gửi, kèm header CDM yêu cầu.</p>
            <pre data-testid='playready'>{Object.entries(playReady.headers)
              .map(([k, v]) => `${k}: ${v}`)
              .join('\n')}{`\nbody: ${new TextDecoder().decode(playReady.body as Uint8Array)}`}</pre>
          </div>
          <div>
            <h3>FairPlay</h3>
            <p className='muted small'>Form <code>spc=&lt;base64&gt;&amp;assetId=&lt;id&gt;</code>, response là base64 text.</p>
            <pre data-testid='fairplay-body'>{fairPlay.body as string}</pre>
            <div className='muted small'>
              Response <code>"AQID+g==\n"</code> → trim + decode → <span data-testid='fp-license'>[{Array.from(licenseBytes).join(', ')}]</span>
            </div>
          </div>
        </div>

        <h3>Dấu "+" trong base64 và form-urlencoded</h3>
        <div className='toolbar'>
          <label>
            <input type='checkbox' checked={encode} onChange={(e) => setEncode(e.target.checked)} /> Mã hoá tham số (
            <code>URLSearchParams</code>)
          </label>
          <label>
            <input type='checkbox' checked={serverDecodes} onChange={(e) => setServerDecodes(e.target.checked)} /> Server
            đọc body theo chuẩn form
          </label>
        </div>
        <div className='stats'>
          <div className='stat'>
            <b>{spcSent}</b>
            <span>SPC gửi đi</span>
          </div>
          <div className='stat'>
            <b data-testid='spc-received'>{spcReceived}</b>
            <span>SPC server nhận</span>
          </div>
          <div className='stat'>
            <b data-testid='spc-intact' className={spcIntact ? 'ok' : 'err'}>
              {spcIntact ? 'nguyên vẹn' : 'hỏng'}
            </b>
            <span>kết quả</span>
          </div>
        </div>
        <p className='hint'>
          Không mã hoá + server đọc theo chuẩn form: mọi "+" thành dấu cách, license server không giải được SPC. Udemy không
          mã hoá vì server của họ đọc chuỗi thô; nếu đổi sang server đọc chuẩn form thì phải bật mã hoá.
        </p>
      </section>

      <section className='card'>
        <h2>3. Hai chỗ dễ sai trong bản gốc</h2>
        <div className='ud-drm-grid two'>
          <div>
            <h3>Key của <code>advanced</code></h3>
            <pre>{`// Udemy\n${JSON.stringify(udemyConfig.drm.advanced, null, 1)}\n\n// Đúng\n${JSON.stringify(fixedConfig.drm.advanced, null, 1)}`}</pre>
            <p className='muted small'>
              Viết <code>{'{ WIDEVINE_KEY_SYSTEM: … }'}</code> tạo key là chữ "WIDEVINE_KEY_SYSTEM", player tìm{' '}
              <code>com.widevine.alpha</code> nên bỏ qua robustness.
            </p>
          </div>
          <div>
            <h3>Content id của FairPlay</h3>
            <pre data-testid='content-id'>{`đọc đúng (Uint16):  ${fairPlayContentId(initData)}\nđọc từng byte:      ${JSON.stringify(
              byteByByte.slice(0, 16),
            )}…\napply(ArrayBuffer): ${JSON.stringify(udemyStyle)}`}</pre>
            <p className='muted small'>
              <code>String.fromCharCode.apply(null, initData.buffer)</code> nhận một ArrayBuffer, không có{' '}
              <code>length</code>, nên ra chuỗi rỗng và regex không bao giờ khớp.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
