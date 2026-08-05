import {
  BONUS_PER_VISIT,
  MAX_BONUS_PERCENT,
  SCHEDULE,
  applyDiscount,
  findMaster,
  findService,
  generateSlots,
  intervalsOverlap,
  isCategoryId,
  minutesToTime,
  timeToMinutes,
  type CategoryId,
} from '../shared/catalog';
import type { AdminBookingView, AvailabilityResponse, BookingStatus, BookingView } from '../shared/types';
import { db, type BookingRow, type UserRow } from './db';
import { addDays, isValidDate, salonMinutesOfDay, salonToday } from './time';

/** Записи в этих статусах занимают место в расписании мастера. */
const BLOCKING_STATUSES = ['pending', 'confirmed', 'completed'] as const;

export class BookingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function toBookingView(row: BookingRow): BookingView {
  const master = findMaster(row.master_id);
  return {
    id: row.id,
    category: row.category as CategoryId,
    service: row.service,
    masterId: row.master_id,
    masterName: master?.name ?? row.master_id,
    date: row.date,
    time: minutesToTime(row.start_minutes),
    endTime: minutesToTime(row.start_minutes + row.duration_minutes),
    durationMinutes: row.duration_minutes,
    status: row.status as BookingStatus,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    basePrice: row.base_price,
    discountPercent: row.discount_percent,
    finalPrice: row.final_price,
    createdAt: row.created_at,
  };
}

export function toAdminBookingView(row: BookingRow & { vk_id?: string | null; user_bonus?: number | null }): AdminBookingView {
  return {
    ...toBookingView(row),
    userId: row.user_id,
    userBonusPercent: row.user_bonus ?? null,
    vkId: row.vk_id ?? null,
  };
}

function blockingBookings(date: string, masterId: string): BookingRow[] {
  const placeholders = BLOCKING_STATUSES.map(() => '?').join(', ');
  return db
    .prepare(
      `SELECT * FROM bookings
       WHERE date = ? AND master_id = ? AND status IN (${placeholders})`,
    )
    .all(date, masterId, ...BLOCKING_STATUSES) as BookingRow[];
}

/**
 * Сетка окошек на день. Занятые интервалы других услуг тоже перекрывают слот —
 * окрашивание на два часа закрывает четыре подряд идущих окошка.
 */
export function getAvailability(date: string, masterId: string, durationMinutes: number): AvailabilityResponse {
  const busy = blockingBookings(date, masterId);
  const today = salonToday();
  const nowMinutes = salonMinutesOfDay();

  const slots = generateSlots(durationMinutes).map((time) => {
    const start = timeToMinutes(time);
    const end = start + durationMinutes;
    const taken = busy.some((booking) =>
      intervalsOverlap(start, end, booking.start_minutes, booking.start_minutes + booking.duration_minutes),
    );
    // Прошедшее время сегодня показываем, но записаться на него нельзя.
    const inPast = date < today || (date === today && start <= nowMinutes);
    return { time, available: !taken && !inPast };
  });

  return { date, masterId, durationMinutes, slots };
}

/** Актуальный баланс из базы — единственный источник правды по скидке. */
function currentBalance(userId: number): number {
  const row = db.prepare('SELECT bonus_percent FROM users WHERE id = ?').get(userId) as
    | { bonus_percent: number }
    | undefined;
  if (!row) throw new BookingError('Клиент не найден', 404);
  return row.bonus_percent;
}

export interface CreateBookingInput {
  category: string;
  service: string;
  masterId: string;
  date: string;
  time: string;
  clientName: string;
  clientPhone: string;
  discountPercent: number;
  user?: UserRow;
}

interface ValidatedBooking {
  category: CategoryId;
  serviceName: string;
  masterId: string;
  date: string;
  startMinutes: number;
  durationMinutes: number;
  basePrice: number | null;
  discountPercent: number;
  finalPrice: number | null;
}

function validate(input: CreateBookingInput): ValidatedBooking {
  if (!isCategoryId(input.category)) throw new BookingError('Неизвестная категория услуг');

  const service = findService(input.category, input.service);
  if (!service) throw new BookingError('Такой услуги нет в прайсе');

  const master = findMaster(input.masterId);
  if (!master) throw new BookingError('Такого мастера нет');
  if (!master.categories.includes(input.category)) {
    throw new BookingError(`${master.name} не оказывает услуги этой категории`);
  }

  if (!isValidDate(input.date)) throw new BookingError('Некорректная дата');
  const today = salonToday();
  if (input.date < today) throw new BookingError('Нельзя записаться на прошедшую дату');
  if (input.date > addDays(today, SCHEDULE.bookingHorizonDays)) {
    throw new BookingError(`Запись открыта максимум на ${SCHEDULE.bookingHorizonDays} дней вперёд`);
  }

  const startMinutes = timeToMinutes(input.time);
  if (Number.isNaN(startMinutes)) throw new BookingError('Некорректное время');
  if (startMinutes % SCHEDULE.stepMinutes !== 0 || startMinutes < SCHEDULE.openMinutes) {
    throw new BookingError('Выберите время из сетки свободных окошек');
  }
  if (startMinutes + service.duration > SCHEDULE.closeMinutes) {
    throw new BookingError('Услуга не успеет закончиться до закрытия салона');
  }
  if (input.date === today && startMinutes <= salonMinutesOfDay()) {
    throw new BookingError('Это время уже прошло, выберите другое окошко');
  }

  const clientName = input.clientName.trim();
  if (clientName.length < 2) throw new BookingError('Укажите имя');
  const digits = input.clientPhone.replace(/\D/g, '');
  if (digits.length !== 11) throw new BookingError('Укажите телефон полностью');

  // Скидка доступна только авторизованным и только в пределах накопленного.
  let discountPercent = Math.floor(input.discountPercent);
  if (!Number.isFinite(discountPercent) || discountPercent < 0) discountPercent = 0;
  if (discountPercent > 0) {
    if (!input.user) throw new BookingError('Скидка доступна только после входа через ВКонтакте');
    // Баланс читаем из базы внутри транзакции: объект из сессии мог устареть,
    // а две одновременные записи иначе заняли бы одни и те же проценты дважды.
    const balance = currentBalance(input.user.id);
    if (discountPercent > balance) {
      throw new BookingError(`У вас накоплено ${balance}%, списать больше нельзя`);
    }
    if (service.price === null) {
      throw new BookingError('Для этой услуги цена определяется на месте — скидку спишет администратор');
    }
  }

  return {
    category: input.category,
    serviceName: service.name,
    masterId: input.masterId,
    date: input.date,
    startMinutes,
    durationMinutes: service.duration,
    basePrice: service.price,
    discountPercent,
    finalPrice: service.price === null ? null : applyDiscount(service.price, discountPercent),
  };
}

/** Изменение баланса с записью в журнал. Возвращает новый баланс. */
export function recordBonus(
  userId: number,
  delta: number,
  reason: string,
  bookingId: number | null = null,
): number {
  const before = currentBalance(userId);
  const balanceAfter = Math.max(0, Math.min(MAX_BONUS_PERCENT, before + delta));
  const realDelta = balanceAfter - before;

  db.prepare('UPDATE users SET bonus_percent = ? WHERE id = ?').run(balanceAfter, userId);
  db.prepare(
    `INSERT INTO bonus_transactions (user_id, booking_id, delta, reason, balance_after)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(userId, bookingId, realDelta, reason, balanceAfter);

  return balanceAfter;
}

/**
 * Создаёт запись. Проверка занятости и вставка идут одной транзакцией,
 * иначе два клиента успевают занять одно окошко одновременно.
 */
export const createBooking = db.transaction((input: CreateBookingInput): BookingRow => {
  const data = validate(input);

  const conflict = blockingBookings(data.date, data.masterId).some((booking) =>
    intervalsOverlap(
      data.startMinutes,
      data.startMinutes + data.durationMinutes,
      booking.start_minutes,
      booking.start_minutes + booking.duration_minutes,
    ),
  );
  if (conflict) throw new BookingError('Это окошко только что заняли, выберите другое', 409);

  const result = db
    .prepare(
      `INSERT INTO bookings
         (user_id, client_name, client_phone, category, service, master_id, date,
          start_minutes, duration_minutes, base_price, discount_percent, final_price, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    )
    .run(
      input.user?.id ?? null,
      input.clientName.trim(),
      input.clientPhone.trim(),
      data.category,
      data.serviceName,
      data.masterId,
      data.date,
      data.startMinutes,
      data.durationMinutes,
      data.basePrice,
      data.discountPercent,
      data.finalPrice,
    );

  const bookingId = Number(result.lastInsertRowid);

  // Процент резервируется сразу, чтобы одну и ту же скидку нельзя было
  // заявить в двух записях. Окончательно списывает её администратор.
  if (input.user && data.discountPercent > 0) {
    recordBonus(input.user.id, -data.discountPercent, 'Резерв скидки под запись', bookingId);
  }

  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId) as BookingRow;
});

export function getBooking(id: number): BookingRow | undefined {
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) as BookingRow | undefined;
}

/** Возврат зарезервированной скидки — при отмене и при неявке. */
function releaseHold(booking: BookingRow, reason: string): void {
  if (booking.user_id && booking.discount_percent > 0) {
    recordBonus(booking.user_id, booking.discount_percent, reason, booking.id);
  }
}

export const confirmBooking = db.transaction((id: number): BookingRow => {
  const booking = getBooking(id);
  if (!booking) throw new BookingError('Запись не найдена', 404);
  if (booking.status !== 'pending') {
    throw new BookingError('Подтвердить можно только новую запись');
  }
  db.prepare(`UPDATE bookings SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?`).run(id);
  return getBooking(id)!;
});

export const cancelBooking = db.transaction((id: number, reason: string): BookingRow => {
  const booking = getBooking(id);
  if (!booking) throw new BookingError('Запись не найдена', 404);
  if (booking.status === 'completed') throw new BookingError('Состоявшийся визит отменить нельзя');
  if (booking.status === 'cancelled') return booking;

  db.prepare(`UPDATE bookings SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(id);
  releaseHold(booking, reason);
  return getBooking(id)!;
});

export const markNoShow = db.transaction((id: number): BookingRow => {
  const booking = getBooking(id);
  if (!booking) throw new BookingError('Запись не найдена', 404);
  if (booking.status === 'completed') throw new BookingError('Визит уже отмечен состоявшимся');

  db.prepare(`UPDATE bookings SET status = 'no_show', updated_at = datetime('now') WHERE id = ?`).run(id);
  releaseHold(booking, 'Возврат скидки: клиент не пришёл');
  return getBooking(id)!;
});

export interface CompleteInput {
  /** Сколько процентов администратор реально списал. */
  writeOffPercent: number;
  /** Итоговая сумма к оплате — для услуг с ценой «от» её ставит администратор. */
  finalPrice: number | null;
}

/**
 * Завершение визита: администратор фиксирует списание скидки,
 * неиспользованный резерв возвращается, и клиенту начисляется процент за визит.
 */
export const completeBooking = db.transaction((id: number, input: CompleteInput): BookingRow => {
  const booking = getBooking(id);
  if (!booking) throw new BookingError('Запись не найдена', 404);
  if (booking.status === 'completed') throw new BookingError('Визит уже завершён');
  if (booking.status === 'cancelled') throw new BookingError('Отменённую запись завершить нельзя');

  let writeOff = Math.floor(input.writeOffPercent);
  if (!Number.isFinite(writeOff) || writeOff < 0) writeOff = 0;

  if (booking.user_id) {
    // Списать можно резерв плюс всё, что осталось на балансе.
    const available = booking.discount_percent + currentBalance(booking.user_id);
    if (writeOff > available) {
      throw new BookingError(`У клиента доступно ${available}%, списать больше нельзя`);
    }
  } else if (writeOff > 0) {
    throw new BookingError('У гостевой записи нет накопленной скидки');
  }

  const diff = booking.discount_percent - writeOff;
  if (booking.user_id && diff !== 0) {
    recordBonus(
      booking.user_id,
      diff,
      diff > 0 ? 'Возврат неиспользованного резерва скидки' : 'Дополнительное списание скидки',
      booking.id,
    );
  }

  const finalPrice =
    input.finalPrice !== null && Number.isFinite(input.finalPrice)
      ? Math.max(0, Math.round(input.finalPrice))
      : booking.base_price === null
        ? null
        : applyDiscount(booking.base_price, writeOff);

  db.prepare(
    `UPDATE bookings
     SET status = 'completed', discount_percent = ?, final_price = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(writeOff, finalPrice, id);

  if (booking.user_id && !booking.bonus_awarded) {
    recordBonus(booking.user_id, BONUS_PER_VISIT, 'Начисление за визит', booking.id);
    db.prepare('UPDATE bookings SET bonus_awarded = 1 WHERE id = ?').run(id);
  }

  return getBooking(id)!;
});
