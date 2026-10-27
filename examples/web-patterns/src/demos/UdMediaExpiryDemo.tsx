import { useRef, useState } from 'react';
import { ASSET_URL_TTL, LICENSE_TOKEN_TTL, createExpiringMedia, type ExpiringMedia } from '../lib/udMediaExpiry';
import { Log, Stat, sleep, useLog, type LogLine } from './shared';
import './UdMediaExpiryDemo.css';

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

interface MediaData {
  url: string;
  expiresAt: number;
  licenseToken: string;
}

/** Server giả: ký URL và cấp token license theo đồng hồ ảo. */
function createServer(clock: { now: number }, settings: { urlTtl: number }) {
  let licenseSerial = 0;
  const tokenExpiry = new Map<string, number>();
  function issueToken() {
    const token = `tok${++licenseSerial}`;
    tokenExpiry.set(token, clock.now + LICENSE_TOKEN_TTL);
    return token;
  }
  return {
    issueAll(lesson: number): MediaData {
      return { url: `/v/${lesson}.m3u8`, expiresAt: clock.now + settings.urlTtl, licenseToken: issueToken() };
    },
    issueLicense: issueToken,
    /** trả 'ok' hoặc loại lỗi player sẽ thấy */
    play(data: MediaData | undefined, token: string | undefined): 'ok' | 'source' | 'license' {
      if (!data || clock.now > data.expiresAt) return 'source';
      if (!token || clock.now > (tokenExpiry.get(token) ?? 0)) return 'license';
      return 'ok';
    },
  };
}

type Server = ReturnType<typeof createServer>;

/** Mô phỏng logic gốc của Udemy (lecture.mobx-model.js + onPlayerError), để so sánh. */
class UdemyLecture {
  dataLoadTime?: number;
  licenseTokenLoadTime?: number;
  data?: MediaData;
  token?: string;
  constructor(
    private api: { all(): Promise<MediaData>; license(): Promise<string> },
    private clock: { now: number },
  ) {}
  get isDataExpired() {
    return !this.dataLoadTime || this.clock.now - this.dataLoadTime > ASSET_URL_TTL;
  }
  get isLicenseTokenExpired() {
    return !this.licenseTokenLoadTime || this.clock.now - this.licenseTokenLoadTime > LICENSE_TOKEN_TTL;
  }
  loadData(): Promise<void> {
    if (this.isDataExpired) {
      return this.api
        .all()
        .then((d) => {
          this.data = d;
          this.token = d.licenseToken;
        })
        .finally(() => {
          // giống bản gốc: gán mốc thời gian cả khi request lỗi
          this.dataLoadTime = this.clock.now;
          this.licenseTokenLoadTime = this.dataLoadTime;
        });
    }
    if (this.isLicenseTokenExpired) {
      return this.api
        .license()
        .then((t) => {
          this.token = t;
        })
        .finally(() => {
          this.licenseTokenLoadTime = this.clock.now;
        });
    }
    return Promise.resolve();
  }
}

interface Side {
  name: string;
  requests: number;
  errors: number;
  plays: number;
  failNext: boolean;
  log: (text: string, tone?: LogLine['tone']) => void;
  open(lesson: number): Promise<void>;
  play(lesson: number): Promise<void>;
  preload(lesson: number): Promise<void>;
}

export default function UdMediaExpiryDemo() {
  const clock = useRef({ now: 8 * HOUR }).current;
  const settings = useRef({ urlTtl: ASSET_URL_TTL }).current;
  const server = useRef<Server>(createServer(clock, settings)).current;
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const [lesson, setLesson] = useState(1);
  const [shortUrl, setShortUrl] = useState(false);
  const udLog = useLog(30);
  const newLog = useLog(30);

  const sides = useRef<{ udemy: Side; rewrite: Side } | null>(null);
  if (!sides.current) {
    const makeApi = (side: () => Side, lessonId: number) => ({
      async all() {
        const s = side();
        s.requests++;
        await sleep(120);
        if (s.failNext) {
          s.failNext = false;
          s.log(`  GET bài ${lessonId} (URL + token) → lỗi mạng`, 'err');
          throw new Error('network');
        }
        const data = server.issueAll(lessonId);
        s.log(`  GET bài ${lessonId} (URL + token) → URL hạn ${fmt(data.expiresAt)}`);
        return data;
      },
      async license() {
        const s = side();
        s.requests++;
        await sleep(80);
        if (s.failNext) {
          s.failNext = false;
          s.log(`  GET token bài ${lessonId} → lỗi mạng`, 'err');
          throw new Error('network');
        }
        s.log(`  GET token license bài ${lessonId}`);
        return server.issueLicense();
      },
    });

    // ---- kiểu Udemy ----
    const udLectures = new Map<number, UdemyLecture>();
    const udLectureOf = (id: number) => {
      if (!udLectures.has(id)) udLectures.set(id, new UdemyLecture(makeApi(() => udemy, id), clock));
      return udLectures.get(id)!;
    };
    const udemy: Side = {
      name: 'Kiểu Udemy',
      requests: 0,
      errors: 0,
      plays: 0,
      failNext: false,
      log: udLog.add,
      async open(id) {
        await udLectureOf(id).loadData().catch(() => {});
      },
      async play(id) {
        const lec = udLectureOf(id);
        await lec.loadData().catch(() => {});
        let result = server.play(lec.data, lec.token);
        if (result !== 'ok') {
          const expired = result === 'source' ? lec.isDataExpired : lec.isLicenseTokenExpired;
          udemy.log(`  player lỗi ${result}; client nghĩ ${expired ? 'đã' : 'CHƯA'} hết hạn`, expired ? 'warn' : 'err');
          if (expired) {
            await lec.loadData().catch(() => {});
            result = server.play(lec.data, lec.token);
          }
        }
        if (result === 'ok') {
          udemy.plays++;
          udemy.log(`▶ bài ${id} phát được`, 'ok');
        } else {
          udemy.errors++;
          udemy.log(`✘ bài ${id}: người xem thấy màn hình lỗi`, 'err');
        }
      },
      async preload(id) {
        await udLectureOf(id).loadData().catch(() => {});
      },
    };

    // ---- bản viết lại ----
    const newLectures = new Map<number, ExpiringMedia<MediaData>>();
    const lectureOf = (id: number) => {
      if (!newLectures.has(id)) {
        const api = makeApi(() => rewrite, id);
        newLectures.set(
          id,
          createExpiringMedia<MediaData>({
            fetchAll: api.all,
            fetchLicense: api.license,
            now: () => clock.now,
            errorRefreshCooldown: 0,
          }),
        );
      }
      return newLectures.get(id)!;
    };
    const rewrite: Side = {
      name: 'Bản viết lại',
      requests: 0,
      errors: 0,
      plays: 0,
      failNext: false,
      log: newLog.add,
      async open(id) {
        await lectureOf(id).ensureFresh().catch(() => {});
      },
      async play(id) {
        const lec = lectureOf(id);
        await lec.ensureFresh().catch(() => {});
        let result = server.play(lec.data, lec.licenseToken);
        if (result !== 'ok') {
          rewrite.log(`  player lỗi ${result} → ép làm mới phần đó`, 'warn');
          if ((await lec.handlePlayerError(result)) === 'retry') result = server.play(lec.data, lec.licenseToken);
        }
        if (result === 'ok') {
          rewrite.plays++;
          rewrite.log(`▶ bài ${id} phát được`, 'ok');
        } else {
          rewrite.errors++;
          rewrite.log(`✘ bài ${id}: người xem thấy màn hình lỗi`, 'err');
        }
      },
      async preload(id) {
        await lectureOf(id).ensureFresh().catch(() => {});
      },
    };
    sides.current = { udemy, rewrite };
  }
  const { udemy, rewrite } = sides.current;
  const both = [udemy, rewrite];

  async function act(label: string, fn: (s: Side) => Promise<void>) {
    for (const s of both) s.log(label, 'muted');
    await Promise.all(both.map(fn));
    rerender();
  }

  function advance(ms: number) {
    clock.now += ms;
    for (const s of both) s.log(`⏩ đồng hồ +${ms >= HOUR ? `${ms / HOUR} giờ` : `${ms / MIN} phút`} → ${fmt(clock.now)}`, 'muted');
    rerender();
  }

  return (
    <div className='page ud-expiry'>
      <h1>URL ký 4 giờ, license 5 phút</h1>
      <p className='hint'>
        Đồng hồ ảo: bấm nút tua để thời gian trôi. Server giả ký URL và cấp token theo đồng hồ đó. Mỗi thao tác chạy song song
        trên hai cột: logic gốc của Udemy và bản viết lại.
      </p>

      <div className='toolbar'>
        <b>Giờ ảo: {fmt(clock.now)}</b>
        <button onClick={() => advance(4 * MIN)}>+4 phút</button>
        <button onClick={() => advance(6 * MIN)}>+6 phút</button>
        <button onClick={() => advance(HOUR)}>+1 giờ</button>
        <button onClick={() => advance(3 * HOUR)}>+3 giờ</button>
        <button onClick={() => advance(5 * HOUR)}>+5 giờ</button>
      </div>
      <div className='toolbar'>
        <label>
          Bài:{' '}
          <select value={lesson} onChange={(e) => setLesson(Number(e.target.value))}>
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                Bài {n}
              </option>
            ))}
          </select>
        </label>
        <button className='primary' data-testid='play' onClick={() => act(`— Mở và phát bài ${lesson}`, (s) => s.play(lesson))}>
          ▶ Phát bài {lesson}
        </button>
        <button
          data-testid='preload'
          onClick={() =>
            act(`— Bài ${lesson} còn <15 giây: player gọi tải trước bài ${lesson + 1} ở 3 lần progress liền nhau`, async (s) => {
              await Promise.all([s.preload(lesson + 1), s.preload(lesson + 1), s.preload(lesson + 1)]);
            })
          }
        >
          Gần hết bài → tải trước bài {lesson + 1}
        </button>
      </div>
      <div className='toolbar'>
        <button
          data-testid='fail-next'
          onClick={() => {
            for (const s of both) {
              s.failNext = true;
              s.log('⚠ request kế tiếp sẽ lỗi mạng', 'warn');
            }
            rerender();
          }}
        >
          Request kế tiếp lỗi mạng
        </button>
        <label>
          <input
            type='checkbox'
            data-testid='short-url'
            checked={shortUrl}
            onChange={(e) => {
              setShortUrl(e.target.checked);
              settings.urlTtl = e.target.checked ? 2 * HOUR : ASSET_URL_TTL;
            }}
          />{' '}
          Server ký URL chỉ 2 giờ (client vẫn tưởng 4 giờ)
        </label>
      </div>

      <div className='ud-expiry-cols'>
        {both.map((s, i) => (
          <div key={s.name} className='card'>
            <h2>{s.name}</h2>
            <div className='stats'>
              <Stat label='request API' value={<output data-testid={`${i ? 'new' : 'ud'}-requests`}>{s.requests}</output>} />
              <Stat label='lần phát được' value={<output data-testid={`${i ? 'new' : 'ud'}-plays`}>{s.plays}</output>} />
              <Stat label='màn hình lỗi' value={<output data-testid={`${i ? 'new' : 'ud'}-errors`}>{s.errors}</output>} />
            </div>
            <Log lines={i ? newLog.lines : udLog.lines} />
          </div>
        ))}
      </div>
      <p className='hint'>
        Thử: (1) bấm "Request kế tiếp lỗi mạng" rồi "Phát": kiểu Udemy vẫn ghi mốc thời gian dù request lỗi nên tin là dữ liệu
        còn hạn, lỗi kéo dài tới 4 giờ sau. (2) Bật "Server ký URL chỉ 2 giờ", phát, tua +3 giờ, phát lại. (3) "Gần hết bài":
        kiểu Udemy bắn 3 request trùng.
      </p>
    </div>
  );
}

function fmt(ms: number) {
  const totalMin = Math.floor(ms / MIN);
  return `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
}
