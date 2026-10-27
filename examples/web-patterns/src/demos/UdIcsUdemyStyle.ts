/**
 * MÔ PHỎNG cách Udemy dựng file .ics (ics-calendar-button.mobx-store.ts + vtimezone.ts) để so sánh
 * trong demo. Không phải mã gốc: viết lại giữ nguyên hành vi đáng chú ý
 * (chỉ năm hiện tại, LF, không escape, dòng trống, tên file chỉ giữ a-z).
 */
import { findTransitions, formatLocal, formatOffset, wallParts, type IcsReminder } from '../lib/udIcs';

export function buildIcsUdemyStyle(r: IcsReminder, now = Date.now()) {
  const year = new Date(now).getUTCFullYear();
  let tzBody = '';
  for (const t of findTransitions(r.timeZone, year)) {
    const kind = t.to > t.from ? 'DAYLIGHT' : 'STANDARD';
    const w = wallParts('UTC', t.at + t.from * 60000);
    tzBody += `BEGIN:${kind}\nDTSTART:${formatLocal(w)}\nTZOFFSETFROM:${formatOffset(t.from)}\nTZOFFSETTO:${formatOffset(
      t.to,
    )}\nEND:${kind}\n`;
  }
  const rrule = r.repeat
    ? `RRULE:FREQ=${r.repeat.freq};${r.repeat.byDay?.length ? `BYDAY=${r.repeat.byDay.join(',')};` : ''}`
    : '';
  const alarm = r.alarmMinutesBefore
    ? `BEGIN:VALARM\nTRIGGER:-PT${r.alarmMinutesBefore}M\nACTION:DISPLAY\nDESCRIPTION:${r.title}\nEND:VALARM`
    : '';
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//udemy.com//Udemy
METHOD:${r.sequence === 0 ? 'PUBLISH' : 'REQUEST'}
BEGIN:VTIMEZONE\nTZID:${r.timeZone}\n${tzBody}END:VTIMEZONE
BEGIN:VEVENT
SUMMARY:${r.title}
SEQUENCE:${r.sequence}
DTSTART;TZID=${r.timeZone}:${formatLocal(r.start)}
UID:${r.uid}
${rrule}
DESCRIPTION:${r.description ?? ''} (${r.url ?? ''})
${r.cancelled ? 'STATUS:CANCELLED' : ''}
${alarm}
END:VEVENT
END:VCALENDAR`;
}

export function fileNameUdemyStyle(title: string) {
  return `${title.replace(/[^a-zA-Z ]+/g, '').replace(/\s+/g, '-').toLowerCase()}.ics`;
}
