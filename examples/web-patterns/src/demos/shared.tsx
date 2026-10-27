import { useCallback, useState, type ReactNode } from 'react';

export interface LogLine {
  id: number;
  text: string;
  tone?: 'ok' | 'warn' | 'err' | 'muted';
}

let nextLogId = 0;

/** Log nhỏ cho demo, dòng mới nhất ở trên cùng. */
export function useLog(limit = 50) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const add = useCallback(
    (text: string, tone?: LogLine['tone']) => {
      const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
      setLines((prev) => [{ id: nextLogId++, text: `${time}  ${text}`, tone }, ...prev].slice(0, limit));
    },
    [limit],
  );
  const clear = useCallback(() => setLines([]), []);
  return { lines, add, clear };
}

export function Log({ lines }: { lines: LogLine[] }) {
  return (
    <div className='log' aria-live='polite'>
      {lines.map((line) => (
        <div key={line.id} className={line.tone}>
          {line.text}
        </div>
      ))}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className='stat'>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
