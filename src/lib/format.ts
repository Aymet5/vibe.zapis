const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

function parse(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** «8 августа» */
export function formatDate(date: string): string {
  const parsed = parse(date);
  return `${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]}`;
}

/** «8 августа, суббота» */
export function formatDateFull(date: string): string {
  return `${formatDate(date)}, ${WEEKDAYS[parse(date).getUTCDay()]}`;
}

export function weekdayShort(date: string): string {
  return WEEKDAYS_SHORT[parse(date).getUTCDay()];
}

export function dayNumber(date: string): number {
  return parse(date).getUTCDate();
}

export function isWeekend(date: string): boolean {
  const day = parse(date).getUTCDay();
  return day === 0 || day === 6;
}

export function addDays(date: string, days: number): string {
  const parsed = parse(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** «1 ч 30 мин» */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} мин`;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

/** «2026-08-05 14:30» из базы -> «5 августа, 14:30» */
export function formatTimestamp(value: string): string {
  const [datePart, timePart] = value.replace('T', ' ').split(' ');
  if (!datePart) return value;
  return `${formatDate(datePart)}${timePart ? `, ${timePart.slice(0, 5)}` : ''}`;
}

export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^[78]/, '');
  let formatted = '+7';
  if (digits.length > 0) formatted += ` (${digits.substring(0, 3)}`;
  if (digits.length >= 4) formatted += `) ${digits.substring(3, 6)}`;
  if (digits.length >= 7) formatted += `-${digits.substring(6, 8)}`;
  if (digits.length >= 9) formatted += `-${digits.substring(8, 10)}`;
  return formatted;
}

/** Склонение: 1 визит, 2 визита, 5 визитов. */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
