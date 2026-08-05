import { Router } from 'express';
import type { BonusTransactionView } from '../../shared/types';
import { requireClient } from '../auth';
import { BookingError, cancelBooking, getBooking, toBookingView } from '../bookings';
import { db, type BonusTransactionRow, type BookingRow } from '../db';
import { masterByVkId } from '../masters';
import { notifyBookingCancelled } from '../notify';
import { isValidDate, salonToday } from '../time';
import { toPublicUser } from '../views';

export const clientRouter = Router();

clientRouter.use(requireClient);

clientRouter.get('/', (req, res) => {
  res.json({ user: toPublicUser(req.user!) });
});

/** Телефон из ВК приходит не всегда, поэтому клиент может указать его сам. */
clientRouter.patch('/', (req, res) => {
  const phone = String(req.body?.phone ?? '').trim();
  if (phone.replace(/\D/g, '').length !== 11) {
    res.status(400).json({ error: 'Укажите телефон полностью' });
    return;
  }
  db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, req.user!.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as typeof req.user;
  res.json({ user: toPublicUser(updated!) });
});

clientRouter.get('/bookings', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY date DESC, start_minutes DESC')
    .all(req.user!.id) as BookingRow[];
  res.json({ bookings: rows.map(toBookingView) });
});

clientRouter.get('/bonuses', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM bonus_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 100')
    .all(req.user!.id) as BonusTransactionRow[];

  const history: BonusTransactionView[] = rows.map((row) => ({
    id: row.id,
    delta: row.delta,
    reason: row.reason,
    balanceAfter: row.balance_after,
    bookingId: row.booking_id,
    createdAt: row.created_at,
  }));

  res.json({ balance: req.user!.bonus_percent, history });
});

/**
 * Записи к самому мастеру. Доступно только тому аккаунту ВК, который
 * администратор закрепил за мастером в панели.
 */
clientRouter.get('/master/bookings', (req, res) => {
  const master = masterByVkId(req.user!.vk_id);
  if (!master) {
    res.status(403).json({ error: 'Этот аккаунт не закреплён за мастером' });
    return;
  }

  const scope = String(req.query.scope ?? 'day');
  const date = String(req.query.date ?? salonToday());
  if (!isValidDate(date)) {
    res.status(400).json({ error: 'Некорректная дата' });
    return;
  }

  const rows =
    scope === 'upcoming'
      ? (db
          .prepare(
            `SELECT * FROM bookings
             WHERE master_id = ? AND date >= ? AND status IN ('pending', 'confirmed')
             ORDER BY date, start_minutes`,
          )
          .all(master.id, salonToday()) as BookingRow[])
      : (db
          .prepare('SELECT * FROM bookings WHERE master_id = ? AND date = ? ORDER BY start_minutes')
          .all(master.id, date) as BookingRow[]);

  res.json({ master, date, bookings: rows.map(toBookingView) });
});

clientRouter.post('/bookings/:id/cancel', async (req, res) => {
  const id = Number(req.params.id);
  const booking = getBooking(id);

  if (!booking || booking.user_id !== req.user!.id) {
    res.status(404).json({ error: 'Запись не найдена' });
    return;
  }

  try {
    const cancelled = cancelBooking(id, 'Возврат скидки: клиент отменил запись');
    void notifyBookingCancelled(cancelled, true).catch((error) => {
      console.error('[notify] уведомление об отмене не отправлено:', error);
    });
    res.json({ booking: toBookingView(cancelled) });
  } catch (error) {
    if (error instanceof BookingError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});
