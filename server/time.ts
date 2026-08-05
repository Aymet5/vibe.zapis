import { env } from './env';

const MS_PER_MINUTE = 60_000;

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/**
 * Салон живёт в своём часовом поясе, а сервер может стоять где угодно.
 * Поэтому «сегодня» и «через 3 часа» считаем от смещения из конфигурации,
 * а не от локального времени процесса.
 */
function salonClock(at: Date = new Date()): Date {
  return new Date(at.getTime() + env.salonUtcOffsetMinutes * MS_PER_MINUTE);
}

/** Текущая дата салона в формате YYYY-MM-DD. */
export function salonToday(at: Date = new Date()): string {
  return salonClock(at).toISOString().slice(0, 10);
}

/** Сколько минут прошло с полуночи по времени салона. */
export function salonMinutesOfDay(at: Date = new Date()): number {
  const clock = salonClock(at);
  return clock.getUTCHours() * 60 + clock.getUTCMinutes();
}

/** Момент начала визита в абсолютном времени. */
export function bookingStartInstant(date: string, startMinutes: number): Date {
  const [year, month, day] = date.split('-').map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);
  return new Date(utcMidnight + (startMinutes - env.salonUtcOffsetMinutes) * MS_PER_MINUTE);
}

/** Прибавляет дни к дате YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/** «5 августа, вторник» — для сообщений клиенту. */
export function formatDateHuman(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return `${day} ${MONTHS[month - 1]}, ${WEEKDAYS[parsed.getUTCDay()]}`;
}
