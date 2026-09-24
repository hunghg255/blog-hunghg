import { format, isValid, parseISO } from 'date-fns';

export const formatDate = (dateString?: string) => {
  if (!dateString) return '';
  const date = parseISO(dateString);
  return isValid(date) ? format(date, 'MMM d, yyyy') : dateString;
};

export default function Date({ dateString }: { dateString?: string }) {
  if (!dateString) return null;
  return <time dateTime={dateString}>{formatDate(dateString)}</time>;
}
