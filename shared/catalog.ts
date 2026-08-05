/**
 * Общий каталог: используется и фронтендом, и сервером.
 * Сервер считает по нему цену, длительность и занятость слотов,
 * поэтому менять услуги нужно только здесь.
 */

export type CategoryId = 'mens' | 'womens' | 'coloring';

export interface Service {
  /** Название, оно же идентификатор внутри категории. */
  name: string;
  /** Цена в рублях. null — цена обсуждается на месте. */
  price: number | null;
  /** true, если цена указана как «от». */
  from?: boolean;
  /** Длительность визита в минутах. */
  duration: number;
}

export interface Master {
  id: string;
  name: string;
  role: string;
  categories: CategoryId[];
}

export const MASTERS: Master[] = [
  { id: 'aydis', name: 'Айдыс', role: 'Топ-мастер', categories: ['mens', 'womens', 'coloring'] },
  { id: 'kezhik', name: 'Сайын', role: 'Барбер', categories: ['mens'] },
  { id: 'aydemir', name: 'Айдемир', role: 'Барбер', categories: ['mens'] },
  { id: 'mengi', name: 'Менги', role: 'Барбер', categories: ['mens'] },
  { id: 'taymira', name: 'Сайзана', role: 'Мастер-универсал', categories: ['mens', 'womens'] },
];

export const SERVICES: Record<CategoryId, Service[]> = {
  mens: [
    { name: 'Модельная', price: 600, duration: 30 },
    { name: 'Спортивная', price: 500, duration: 30 },
    { name: 'Фейд', price: 600, duration: 40 },
    { name: 'Кроп', price: 600, duration: 30 },
    { name: 'Борода', price: 400, duration: 20 },
    { name: 'Камуфляж', price: 600, duration: 30 },
    { name: 'Детская', price: 500, duration: 30 },
    { name: 'Я скажу потом', price: null, duration: 30 },
  ],
  womens: [
    { name: 'Модельная', price: 700, duration: 40 },
    { name: 'Каре', price: 1000, duration: 60 },
    { name: 'Каскад', price: 1500, duration: 60 },
    { name: 'Подравнивание', price: 500, duration: 30 },
    { name: 'Лесенка', price: 1500, duration: 60 },
    { name: 'Челка', price: 200, from: true, duration: 20 },
    { name: 'Я скажу потом', price: null, duration: 40 },
  ],
  coloring: [
    { name: 'Тонирование', price: 2000, from: true, duration: 120 },
    { name: 'Мелирование', price: 4000, from: true, duration: 180 },
    { name: 'С техникой', price: 5000, from: true, duration: 180 },
    { name: 'Блондирование', price: 4000, from: true, duration: 180 },
    { name: 'С вашей краской', price: 1500, from: true, duration: 120 },
    { name: 'Я скажу потом', price: null, duration: 120 },
  ],
};

export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: 'mens', label: 'Мужские' },
  { id: 'womens', label: 'Женские' },
  { id: 'coloring', label: 'Окрашивание' },
];

/** Режим работы салона и шаг сетки окошек. */
export const SCHEDULE = {
  /** Начало рабочего дня, минут от полуночи. 09:00 */
  openMinutes: 9 * 60,
  /** Конец рабочего дня, минут от полуночи. 19:00 */
  closeMinutes: 19 * 60,
  /** Шаг сетки окошек в минутах — под обычную стрижку. */
  stepMinutes: 30,
  /** За сколько дней вперёд можно записаться. */
  bookingHorizonDays: 30,
};

/** Потолок накопленной скидки. Больше на счёт не начислится. */
export const MAX_BONUS_PERCENT = 20;
/** Сколько процентов даёт один состоявшийся визит. */
export const BONUS_PER_VISIT = 5;

export function findMaster(id: string): Master | undefined {
  return MASTERS.find((m) => m.id === id);
}

export function findService(category: CategoryId, name: string): Service | undefined {
  return SERVICES[category]?.find((s) => s.name === name);
}

export function isCategoryId(value: string): value is CategoryId {
  return value === 'mens' || value === 'womens' || value === 'coloring';
}

/** «600р», «от 2000р», «—» — единый формат подписи цены. */
export function formatPrice(service: Pick<Service, 'price' | 'from'>): string {
  if (service.price === null) return '—';
  return `${service.from ? 'от ' : ''}${service.price}р`;
}

/** 570 -> «09:30» */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** «09:30» -> 570. Возвращает NaN на некорректной строке. */
export function timeToMinutes(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return NaN;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return NaN;
  return h * 60 + m;
}

/**
 * Все окошки рабочего дня. Записаться можно только на такое время,
 * чтобы услуга успела закончиться до закрытия.
 */
export function generateSlots(durationMinutes: number): string[] {
  const slots: string[] = [];
  const { openMinutes, closeMinutes, stepMinutes } = SCHEDULE;
  for (let start = openMinutes; start + durationMinutes <= closeMinutes; start += stepMinutes) {
    slots.push(minutesToTime(start));
  }
  return slots;
}

/** Пересекаются ли два интервала [startA, endA) и [startB, endB). */
export function intervalsOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

/** Цена со скидкой: процент отбрасывает копейки в пользу клиента. */
export function applyDiscount(price: number, percent: number): number {
  const safePercent = Math.max(0, Math.min(MAX_BONUS_PERCENT, percent));
  return Math.round(price * (1 - safePercent / 100));
}
