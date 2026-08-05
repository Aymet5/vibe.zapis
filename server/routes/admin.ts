import { Router, type Response } from 'express';
import { MAX_BONUS_PERCENT } from '../../shared/catalog';
import type { BonusTransactionView } from '../../shared/types';
import { checkAdminPassword, loginAdmin, logoutAdmin, requireAdmin } from '../auth';
import {
  BookingError,
  cancelBooking,
  completeBooking,
  confirmBooking,
  getBooking,
  markNoShow,
  recordBonus,
  toAdminBookingView,
} from '../bookings';
import { db, type BonusTransactionRow, type BookingRow, type UserRow } from '../db';
import { env } from '../env';
import { notifyBookingCancelled, notifyBookingConfirmed, notifyVisitCompleted } from '../notify';
import { isValidDate, salonToday } from '../time';

export const adminRouter = Router();

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; firstAt: number }>();

/** Простое ограничение перебора пароля по IP. */
function tooManyAttempts(ip: string): boolean {
  const entry = attempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
    attempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function registerAttempt(ip: string): void {
  const entry = attempts.get(ip);
  if (!entry || Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
    attempts.set(ip, { count: 1, firstAt: Date.now() });
    return;
  }
  entry.count += 1;
}

adminRouter.get('/session', (req, res) => {
  res.json({ authenticated: Boolean(req.isAdmin), enabled: Boolean(env.adminPassword) });
});

adminRouter.post('/login', (req, res) => {
  if (!env.adminPassword) {
    res.status(503).json({ error: 'Пароль администратора не задан на сервере' });
    return;
  }

  const ip = req.ip ?? 'unknown';
  if (tooManyAttempts(ip)) {
    res.status(429).json({ error: 'Слишком много попыток. Подождите 15 минут' });
    return;
  }

  const password = String(req.body?.password ?? '');
  if (!checkAdminPassword(password)) {
    registerAttempt(ip);
    res.status(401).json({ error: 'Неверный пароль' });
    return;
  }

  attempts.delete(ip);
  loginAdmin(res);
  res.json({ ok: true });
});

adminRouter.post('/logout', (req, res) => {
  logoutAdmin(req, res);
  res.json({ ok: true });
});

adminRouter.use(requireAdmin);

type AdminBookingRow = BookingRow & { vk_id: string | null; user_bonus: number | null };

const BOOKINGS_QUERY = `
  SELECT b.*, u.vk_id AS vk_id, u.bonus_percent AS user_bonus
  FROM bookings b
  LEFT JOIN users u ON u.id = b.user_id
`;

/** Записи на день (по умолчанию — сегодня) либо все активные. */
adminRouter.get('/bookings', (req, res) => {
  const scope = String(req.query.scope ?? 'day');

  let rows: AdminBookingRow[];
  if (scope === 'upcoming') {
    rows = db
      .prepare(
        `${BOOKINGS_QUERY}
         WHERE b.date >= ? AND b.status IN ('pending', 'confirmed')
         ORDER BY b.date, b.start_minutes`,
      )
      .all(salonToday()) as AdminBookingRow[];
  } else if (scope === 'pending') {
    rows = db
      .prepare(`${BOOKINGS_QUERY} WHERE b.status = 'pending' ORDER BY b.date, b.start_minutes`)
      .all() as AdminBookingRow[];
  } else {
    const date = String(req.query.date ?? salonToday());
    if (!isValidDate(date)) {
      res.status(400).json({ error: 'Некорректная дата' });
      return;
    }
    rows = db
      .prepare(`${BOOKINGS_QUERY} WHERE b.date = ? ORDER BY b.start_minutes`)
      .all(date) as AdminBookingRow[];
  }

  res.json({ bookings: rows.map(toAdminBookingView) });
});

function handleBookingAction(
  res: Response,
  action: () => BookingRow,
  onSuccess?: (booking: BookingRow) => void,
): void {
  try {
    const booking = action();
    onSuccess?.(booking);
    const withUser = db.prepare(`${BOOKINGS_QUERY} WHERE b.id = ?`).get(booking.id) as AdminBookingRow;
    res.json({ booking: toAdminBookingView(withUser) });
  } catch (error) {
    if (error instanceof BookingError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('[admin] ошибка при изменении записи:', error);
    res.status(500).json({ error: 'Не удалось выполнить действие' });
  }
}

adminRouter.post('/bookings/:id/confirm', (req, res) => {
  handleBookingAction(
    res,
    () => confirmBooking(Number(req.params.id)),
    (booking) => {
      void notifyBookingConfirmed(booking).catch((error) =>
        console.error('[notify] подтверждение не отправлено:', error),
      );
    },
  );
});

adminRouter.post('/bookings/:id/cancel', (req, res) => {
  handleBookingAction(
    res,
    () => cancelBooking(Number(req.params.id), 'Возврат скидки: запись отменена администратором'),
    (booking) => {
      void notifyBookingCancelled(booking, false).catch((error) =>
        console.error('[notify] уведомление об отмене не отправлено:', error),
      );
    },
  );
});

adminRouter.post('/bookings/:id/no-show', (req, res) => {
  handleBookingAction(res, () => markNoShow(Number(req.params.id)));
});

/** Завершение визита: здесь администратор и списывает накопленные проценты. */
adminRouter.post('/bookings/:id/complete', (req, res) => {
  const rawPrice = req.body?.finalPrice;
  const finalPrice =
    rawPrice === null || rawPrice === undefined || rawPrice === '' ? null : Number(rawPrice);

  if (finalPrice !== null && !Number.isFinite(finalPrice)) {
    res.status(400).json({ error: 'Некорректная сумма' });
    return;
  }

  handleBookingAction(
    res,
    () =>
      completeBooking(Number(req.params.id), {
        writeOffPercent: Number(req.body?.writeOffPercent ?? 0),
        finalPrice,
      }),
    (booking) => {
      if (!booking.user_id) return;
      const user = db.prepare('SELECT bonus_percent FROM users WHERE id = ?').get(booking.user_id) as
        | { bonus_percent: number }
        | undefined;
      void notifyVisitCompleted(booking, user?.bonus_percent ?? 0).catch((error) =>
        console.error('[notify] сообщение о начислении не отправлено:', error),
      );
    },
  );
});

/** Поиск клиента по имени, телефону или id ВКонтакте. */
adminRouter.get('/clients', (req, res) => {
  const query = String(req.query.query ?? '').trim();
  const like = `%${query}%`;

  const rows = (
    query
      ? db
          .prepare(
            `SELECT * FROM users
             WHERE first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? OR vk_id LIKE ?
             ORDER BY bonus_percent DESC, id DESC LIMIT 50`,
          )
          .all(like, like, like, like)
      : db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 50').all()
  ) as UserRow[];

  res.json({
    clients: rows.map((user) => ({
      id: user.id,
      vkId: user.vk_id,
      name: `${user.first_name} ${user.last_name}`.trim(),
      phone: user.phone,
      bonusPercent: user.bonus_percent,
      vkMessagesAllowed: Boolean(user.vk_messages_allowed),
    })),
  });
});

adminRouter.get('/clients/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!user) {
    res.status(404).json({ error: 'Клиент не найден' });
    return;
  }

  const bookings = db
    .prepare(`${BOOKINGS_QUERY} WHERE b.user_id = ? ORDER BY b.date DESC, b.start_minutes DESC LIMIT 50`)
    .all(id) as AdminBookingRow[];

  const bonusRows = db
    .prepare('SELECT * FROM bonus_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .all(id) as BonusTransactionRow[];

  const history: BonusTransactionView[] = bonusRows.map((row) => ({
    id: row.id,
    delta: row.delta,
    reason: row.reason,
    balanceAfter: row.balance_after,
    bookingId: row.booking_id,
    createdAt: row.created_at,
  }));

  res.json({
    client: {
      id: user.id,
      vkId: user.vk_id,
      name: `${user.first_name} ${user.last_name}`.trim(),
      phone: user.phone,
      bonusPercent: user.bonus_percent,
      vkMessagesAllowed: Boolean(user.vk_messages_allowed),
      createdAt: user.created_at,
    },
    bookings: bookings.map(toAdminBookingView),
    bonusHistory: history,
  });
});

/** Ручная корректировка баланса — списание вне записи или компенсация. */
adminRouter.post('/clients/:id/bonus', (req, res) => {
  const id = Number(req.params.id);
  const delta = Math.trunc(Number(req.body?.delta));
  const reason = String(req.body?.reason ?? '').trim();

  if (!Number.isFinite(delta) || delta === 0) {
    res.status(400).json({ error: 'Укажите, сколько процентов начислить или списать' });
    return;
  }
  if (Math.abs(delta) > MAX_BONUS_PERCENT) {
    res.status(400).json({ error: `Не больше ${MAX_BONUS_PERCENT}% за операцию` });
    return;
  }
  if (reason.length < 3) {
    res.status(400).json({ error: 'Опишите причину — она попадёт в историю клиента' });
    return;
  }

  try {
    const balance = recordBonus(id, delta, `Администратор: ${reason}`);
    res.json({ balance });
  } catch (error) {
    if (error instanceof BookingError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});
