/**
 * Kiểm tra nhanh một file .ics theo vài luật hay bị quên của RFC 5545.
 * Không thay được validator đầy đủ (icalendar.org/validator), chỉ bắt lỗi phổ biến.
 */
export interface IcsIssue {
  rule: string;
  detail: string;
}

const encoder = new TextEncoder();

export function checkIcs(text: string): IcsIssue[] {
  const issues: IcsIssue[] = [];
  const bareLf = text.replace(/\r\n/g, '').includes('\n');
  if (bareLf) issues.push({ rule: 'CRLF', detail: 'Dòng kết thúc bằng LF thay vì CRLF (§3.1)' });

  // gỡ gấp dòng trước khi xét nội dung
  const physical = text.split(/\r?\n/);
  const tooLong = physical.filter((l) => encoder.encode(l).length > 75);
  if (tooLong.length) {
    issues.push({ rule: '75 octet', detail: `${tooLong.length} dòng dài hơn 75 octet chưa được gấp (§3.1)` });
  }
  const logical = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const body = logical.slice(0, logical[logical.length - 1] === '' ? -1 : undefined);

  const empty = body.filter((l) => l.trim() === '').length;
  if (empty) issues.push({ rule: 'Dòng trống', detail: `${empty} dòng trống giữa các thuộc tính` });

  // VTIMEZONE phải có ít nhất 1 STANDARD hoặc DAYLIGHT
  const tzStart = body.indexOf('BEGIN:VTIMEZONE');
  if (tzStart >= 0) {
    const tzEnd = body.indexOf('END:VTIMEZONE', tzStart);
    const inner = body.slice(tzStart, tzEnd);
    if (!inner.some((l) => l === 'BEGIN:STANDARD' || l === 'BEGIN:DAYLIGHT')) {
      issues.push({ rule: 'VTIMEZONE rỗng', detail: 'VTIMEZONE không có STANDARD/DAYLIGHT (§3.6.5)' });
    }
  }

  // TEXT chưa escape: dấu phẩy/chấm phẩy trần trong SUMMARY/DESCRIPTION
  for (const l of body) {
    const m = /^(SUMMARY|DESCRIPTION|LOCATION)(;[^:]*)?:(.*)$/.exec(l);
    if (m && /(^|[^\\])[,;]/.test(m[3])) {
      issues.push({ rule: 'Escape', detail: `${m[1]} có , hoặc ; chưa escape (§3.3.11)` });
    }
  }

  // DTSTART có TZID thì UNTIL phải là UTC (kết thúc bằng Z)
  const hasTzid = body.some((l) => l.startsWith('DTSTART;TZID='));
  const until = /UNTIL=([0-9T]+Z?)/.exec(body.find((l) => l.startsWith('RRULE:')) ?? '');
  if (hasTzid && until && !until[1].endsWith('Z')) {
    issues.push({ rule: 'UNTIL', detail: 'DTSTART có TZID nhưng UNTIL không phải UTC (§3.3.10)' });
  }
  return issues;
}
