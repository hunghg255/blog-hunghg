import { useRef, useState } from 'react';
import {
  checkForgottenAttachment,
  countTriggers,
  countTriggersNaive,
  runSendChecks,
  TRIGGERS,
  type SendCheck,
} from '../lib/forgottenAttachment';
import { Log, Stat, useLog } from './shared';
import './ForgottenAttachmentDemo.css';

const TRIGGER_LIST = [...TRIGGERS.vi, ...TRIGGERS.en];
const QUOTED =
  'Vào 25/10 Lan đã viết:\n> Chào anh, em gửi kèm báo giá quý 4, file đính kèm bên dưới.\n> Anh xem giúp em nhé.';

interface Draft {
  to: string;
  content: string;
  quoted: string;
  attachments: string[];
}

interface DialogState {
  title: string;
  body: string;
  okText: string;
  cancelText: string;
  checkId: string;
  resolve: (ok: boolean) => void;
}

export default function ForgottenAttachmentDemo() {
  const [to, setTo] = useState('minh@example.com');
  const [content, setContent] = useState('Anh gửi em bản hợp đồng đã ký, file đính kèm.');
  const [isReply, setIsReply] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [remind, setRemind] = useState(true);
  const remindRef = useRef(remind);
  remindRef.current = remind;
  const { lines, add } = useLog(10);

  const draft: Draft = { to, content, quoted: isReply ? QUOTED : '', attachments };
  const verdict = checkForgottenAttachment(
    { content: draft.content, quoted: draft.quoted, attachmentCount: attachments.length },
    TRIGGER_LIST,
  );
  const naiveCount = countTriggersNaive(content, TRIGGER_LIST);

  const checks: SendCheck<Draft>[] = [
    { id: 'no-recipient', validate: (d) => d.to.trim().length > 0 },
    {
      id: 'forgotten-attachment',
      validate: (d) =>
        !remindRef.current ||
        !checkForgottenAttachment({ content: d.content, quoted: d.quoted, attachmentCount: d.attachments.length }, TRIGGER_LIST).warn,
      confirm: {
        title: 'Hình như bạn quên đính kèm file?',
        body: 'Thư có nhắc tới file đính kèm nhưng chưa có file nào.',
        okText: 'Vẫn gửi',
        cancelText: 'Không gửi',
      },
    },
  ];

  const send = async () => {
    const blockedBy = await runSendChecks(draft, checks, (d, checkId) =>
      new Promise<boolean>((resolve) => setDialog({ ...d, checkId, resolve })),
    );
    if (blockedBy) add(`Không gửi (dừng ở kiểm tra "${blockedBy}")`, 'warn');
    else add(`Đã gửi tới ${to} với ${attachments.length} file`, 'ok');
  };

  const closeDialog = (ok: boolean) => {
    dialog?.resolve(ok);
    setDialog(null);
  };

  return (
    <div className='page fa'>
      <h1>Cảnh báo quên đính kèm file</h1>
      <p className='hint'>
        Gõ thư có chữ "đính kèm"/"attached" rồi bấm Gửi khi chưa có file. Bật "Đang trả lời" để thấy quy tắc của Outlook:
        chỉ cảnh báo khi phần mới gõ có nhiều từ khoá hơn thư cũ được trích dẫn.
      </p>

      <div className='fa-compose card'>
        <label>
          Tới <input value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <textarea aria-label='Nội dung thư' rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
        {isReply && <pre className='fa-quoted'>{QUOTED}</pre>}
        <div className='toolbar'>
          <button onClick={() => setAttachments((a) => [...a, `hop-dong-${a.length + 1}.pdf`])}>📎 Đính kèm file</button>
          {attachments.map((f) => (
            <span key={f} className='badge'>
              {f}
            </span>
          ))}
          {attachments.length > 0 && <button onClick={() => setAttachments([])}>Bỏ file</button>}
        </div>
        <div className='toolbar'>
          <label className='fa-check'>
            <input type='checkbox' checked={isReply} onChange={(e) => setIsReply(e.target.checked)} /> Đang trả lời thư có chữ
            "đính kèm"
          </label>
          <button className='primary' onClick={send}>
            Gửi
          </button>
        </div>
      </div>

      <div className='stats'>
        <Stat label='từ khoá trong phần mới' value={verdict.inContent} />
        <Stat label='từ khoá trong thư cũ' value={verdict.inQuoted} />
        <Stat label='regex gốc đếm được' value={naiveCount} />
        <Stat label='cảnh báo?' value={verdict.warn ? <span className='warn'>có</span> : <span className='ok'>không</span>} />
      </div>
      <p className='muted'>Lý do: {verdict.reason}</p>

      <div className='card'>
        <b>Regex gốc <code>(^|\s)từ(\s|$)</code> vs ranh giới Unicode</b>
        <table className='fa-table'>
          <tbody>
            {[
              'Xem file đính kèm.',
              'See attached, attached again',
              'Gửi kèm (bản scan) nhé',
              'Xem file đính kèm'.normalize('NFD'),
              'Không có gì để reattach',
            ].map((s) => (
              <tr key={s}>
                <td>
                  <code>{s}</code>
                  {s !== s.normalize('NFC') && <span className='muted'> (NFD)</span>}
                </td>
                <td>gốc: {countTriggersNaive(s, TRIGGER_LIST)}</td>
                <td>mới: {countTriggers(s, TRIGGER_LIST)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialog && (
        <div className='backdrop fa-backdrop' onClick={() => closeDialog(false)}>
          <div
            className='dialog'
            role='alertdialog'
            aria-modal='true'
            aria-labelledby='fa-title'
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Escape' && closeDialog(false)}
          >
            <h2 id='fa-title'>{dialog.title}</h2>
            <p>{dialog.body}</p>
            <label className='fa-check'>
              <input type='checkbox' checked={!remind} onChange={(e) => setRemind(!e.target.checked)} /> Đừng nhắc lại
            </label>
            <div className='toolbar'>
              <button autoFocus onClick={() => closeDialog(false)}>
                {dialog.cancelText}
              </button>
              <button className='primary' onClick={() => closeDialog(true)}>
                {dialog.okText}
              </button>
            </div>
          </div>
        </div>
      )}
      <Log lines={lines} />
    </div>
  );
}
