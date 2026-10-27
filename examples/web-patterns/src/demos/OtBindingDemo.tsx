import { useEffect, useRef, useState } from 'react';
import {
  createOTClient,
  diffToOps,
  OTServer,
  TextModel,
  transformIndex,
  type OTClient,
  type ServerMessage,
} from '../lib/otBinding';
import { Log, sleep, useLog } from './shared';
import './OtBindingDemo.css';

const INITIAL = 'Xin chào';
type Id = 'A' | 'B';
const NAMES: Record<Id, string> = { A: 'Alice', B: 'Bob' };

/** Mạng giả: mỗi kênh là một hàng FIFO có độ trễ riêng. */
function createNetwork(onChange: () => void) {
  const lastAt: Record<string, number> = {};
  let inFlight = 0;
  let paused = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  return {
    get inFlight() {
      return inFlight;
    },
    send(channel: string, latency: number, deliver: () => void) {
      if (paused) return;
      const at = Math.max(Date.now() + latency, (lastAt[channel] ?? 0) + 1);
      lastAt[channel] = at;
      inFlight++;
      onChange();
      const timer = setTimeout(() => {
        timers.delete(timer);
        inFlight--;
        if (!paused) deliver();
        onChange();
      }, at - Date.now());
      timers.add(timer);
    },
    stop() {
      paused = true;
      timers.forEach(clearTimeout);
      timers.clear();
      inFlight = 0;
    },
  };
}

interface World {
  server: OTServer;
  models: Record<Id, TextModel>;
  clients: Record<Id, OTClient>;
  net: ReturnType<typeof createNetwork>;
}

export default function OtBindingDemo() {
  const { lines, add, clear } = useLog(40);
  const [latency, setLatency] = useState<Record<Id, number>>({ A: 600, B: 600 });
  const [transformHistory, setTransformHistory] = useState(true);
  const [ignoreEcho, setIgnoreEcho] = useState(true);
  const [botTyping, setBotTyping] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [, setTick] = useState(0);
  const latencyRef = useRef(latency);
  latencyRef.current = latency;
  const ignoreEchoRef = useRef(ignoreEcho);
  ignoreEchoRef.current = ignoreEcho;
  const world = useRef<World | null>(null);

  const build = (initial = false) => {
    world.current?.net.stop();
    const net = createNetwork(() => setTick((t) => t + 1));
    const server = new OTServer(INITIAL);
    const models = { A: new TextModel(INITIAL), B: new TextModel(INITIAL) };
    const clients = {} as Record<Id, OTClient>;
    const broadcast = (message: ServerMessage) => {
      (['A', 'B'] as Id[]).forEach((id) => net.send(`down-${id}`, latencyRef.current[id], () => clients[id].receive(message)));
    };
    (['A', 'B'] as Id[]).forEach((id) => {
      clients[id] = createOTClient({
        clientId: id,
        model: models[id],
        transformHistory,
        ignoreRemoteChanges: ignoreEcho,
        send: (revision, ops) =>
          net.send(`up-${id}`, latencyRef.current[id], () => {
            const message = server.receive(id, revision, ops);
            if (server.doc.length > 400) {
              net.stop();
              add('Văn bản trên server vượt 400 ký tự: dừng mạng (echo đang nhân bản chữ)', 'err');
              return;
            }
            broadcast(message);
          }),
      });
    });
    (['A', 'B'] as Id[]).forEach((id) =>
      models[id].onChange((ops, origin) => {
        if (origin === 'remote' && !ignoreEchoRef.current) {
          add(`${NAMES[id]} nhận op của người kia rồi gửi ngược lên server (echo): "${ops.map((o) => o.text).join('')}"`, 'err');
        }
      }),
    );
    world.current = { server, models, clients, net };
    if (!initial) setGeneration((g) => g + 1);
  };

  if (!world.current) build(true);

  // Đổi tuỳ chọn → áp ngay cho client đang chạy
  useEffect(() => {
    const w = world.current!;
    (['A', 'B'] as Id[]).forEach((id) => {
      w.clients[id].transformHistory = transformHistory;
      w.clients[id].ignoreRemoteChanges = ignoreEcho;
    });
  }, [transformHistory, ignoreEcho, generation]);

  useEffect(() => () => world.current?.net.stop(), []);

  // Bob tự gõ: chèn một từ vào đầu văn bản mỗi 1,2 giây
  useEffect(() => {
    if (!botTyping) return;
    const words = ['ồ', 'à', 'này', 'nhé', 'ừm'];
    let i = 0;
    const timer = setInterval(() => {
      const model = world.current!.models.B;
      model.apply([{ type: 'insert', position: 0, text: words[i++ % words.length] + ' ' }], 'input');
    }, 1200);
    return () => clearInterval(timer);
  }, [botTyping, generation]);

  const w = world.current!;
  const converged =
    w.net.inFlight === 0 &&
    w.clients.A.pending === 0 &&
    w.clients.B.pending === 0 &&
    w.models.A.value === w.server.doc &&
    w.models.B.value === w.server.doc;

  const reset = () => {
    setBotTyping(false);
    build();
    clear();
  };

  const waitIdle = async () => {
    for (let i = 0; i < 100 && world.current!.net.inFlight > 0; i++) await sleep(100);
  };

  const scenario = async () => {
    reset();
    await sleep(50);
    const { models, clients } = world.current!;
    add('Alice gõ " các bạn" vào cuối', 'muted');
    for (const ch of ' các bạn') {
      models.A.apply([{ type: 'insert', position: models.A.value.length, text: ch }], 'input');
      await sleep(40);
    }
    await waitIdle();
    add('Bob chèn "Ồ, " vào đầu', 'muted');
    models.B.apply([{ type: 'insert', position: 0, text: 'Ồ, ' }], 'input');
    await waitIdle();
    add('Alice bấm Ctrl+Z cho tới khi hết bước undo', 'muted');
    while (clients.A.undoDepth > 0) {
      clients.A.undo();
      await sleep(120);
    }
    await waitIdle();
    const ok = models.A.value === 'Ồ, Xin chào';
    add(`Kết quả: "${models.A.value}" ${ok ? '(đúng)' : '(sai: mong đợi "Ồ, Xin chào")'}`, ok ? 'ok' : 'err');
  };

  return (
    <div className='page ot-demo'>
      <h1>Nối OT với editor: undo và chặn echo</h1>
      <p className='hint'>
        Hai người sửa cùng một văn bản qua một server giả có độ trễ. Gõ thử ở cả hai ô, bấm Ctrl+Z trong ô của
        Alice. Chạy "Kịch bản" để xem undo sau khi Bob chèn chữ phía trước, rồi tắt "Transform undo stack" và
        chạy lại.
      </p>

      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={transformHistory} onChange={(e) => setTransformHistory(e.target.checked)} />{' '}
          Transform undo stack (Glitch)
        </label>
        <label className='switch'>
          <input type='checkbox' checked={ignoreEcho} onChange={(e) => setIgnoreEcho(e.target.checked)} /> Chặn echo
          (ignoreNextChanges)
        </label>
        <label className='switch'>
          <input type='checkbox' checked={botTyping} onChange={(e) => setBotTyping(e.target.checked)} /> Bob tự gõ
        </label>
      </div>
      <div className='toolbar'>
        <button className='primary' onClick={scenario}>
          Kịch bản: Ctrl+Z sau khi Bob chèn
        </button>
        <button onClick={reset}>Làm lại từ đầu</button>
      </div>

      <div className='stats'>
        <div className='stat'>
          <b>{w.server.revision}</b>
          <span>revision trên server</span>
        </div>
        <div className='stat'>
          <b>{w.net.inFlight}</b>
          <span>tin đang trên mạng</span>
        </div>
        <div className='stat'>
          <b className={converged ? 'ok' : 'warn'}>{converged ? 'đã hội tụ' : 'đang đồng bộ…'}</b>
          <span>Alice = Bob = server</span>
        </div>
      </div>

      <div className='ot-editors'>
        {(['A', 'B'] as Id[]).map((id) => (
          <Editor
            key={`${id}-${generation}`}
            name={NAMES[id]}
            model={w.models[id]}
            client={w.clients[id]}
            latency={latency[id]}
            onLatency={(v) => setLatency((l) => ({ ...l, [id]: v }))}
          />
        ))}
      </div>

      <div className='ot-server'>
        <span className='muted'>Server:</span> <code>{w.server.doc}</code>
      </div>

      <Log lines={lines} />
    </div>
  );
}

function Editor(props: {
  name: string;
  model: TextModel;
  client: OTClient;
  latency: number;
  onLatency: (v: number) => void;
}) {
  const { model, client } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const el = ref.current!;
    el.value = model.value;
    // Thay đổi không đến từ chính textarea (op của người khác, undo/redo, bot): ghi vào + dời con trỏ
    return model.onChange((ops) => {
      if (el.value !== model.value) {
        const focused = document.activeElement === el;
        const start = transformIndex(el.selectionStart, ops);
        const end = transformIndex(el.selectionEnd, ops);
        el.value = model.value;
        if (focused) el.setSelectionRange(start, end);
      }
      setTick((t) => t + 1);
    });
  }, [model]);

  return (
    <section className='ot-editor'>
      <header>
        <b>{props.name}</b>
        <label>
          trễ {props.latency}ms
          <input type='range' min={0} max={2000} step={100} value={props.latency} onChange={(e) => props.onLatency(+e.target.value)} />
        </label>
      </header>
      <textarea
        ref={ref}
        aria-label={`Văn bản của ${props.name}`}
        spellCheck={false}
        onInput={(e) => model.apply(diffToOps(model.value, e.currentTarget.value), 'input')}
        onKeyDown={(e) => {
          const key = e.key.toLowerCase();
          if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
            // Undo của trình duyệt không biết người khác đã sửa gì: dùng stack của mình
            e.preventDefault();
            if (key === 'y' || e.shiftKey) client.redo();
            else client.undo();
          }
        }}
      />
      <footer className='muted'>
        undo {client.undoDepth} · redo {client.redoDepth} · chờ gửi {client.pending} op · rev {client.revision}
      </footer>
      <div className='ot-buttons'>
        <button onClick={() => client.undo()} disabled={client.undoDepth === 0}>
          ↶ Undo
        </button>
        <button onClick={() => client.redo()} disabled={client.redoDepth === 0}>
          ↷ Redo
        </button>
      </div>
    </section>
  );
}
