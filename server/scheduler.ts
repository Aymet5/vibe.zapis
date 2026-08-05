import { cleanupExpired, db, type BookingRow } from './db';
import { env } from './env';
import { notifyReminder } from './notify';
import { bookingStartInstant, salonToday } from './time';

const TICK_MS = 5 * 60 * 1000;

/**
 * Напоминания рассылаются пачкой раз в несколько минут, а не по таймеру на каждую
 * запись: перезапуск сервера не должен терять уже запланированные напоминания.
 */
async function sendDueReminders(): Promise<void> {
  const now = Date.now();
  const horizon = now + env.reminderHoursBefore * 60 * 60 * 1000;

  // Берём с запасом на пару дней вперёд и фильтруем по точному времени в коде,
  // потому что дата и время в базе хранятся в часовом поясе салона.
  const candidates = db
    .prepare(
      `SELECT * FROM bookings
       WHERE reminder_sent_at IS NULL
         AND status IN ('pending', 'confirmed')
         AND user_id IS NOT NULL
         AND date >= ?
       ORDER BY date, start_minutes`,
    )
    .all(salonToday(new Date(now - 24 * 60 * 60 * 1000))) as BookingRow[];

  for (const booking of candidates) {
    const startsAt = bookingStartInstant(booking.date, booking.start_minutes).getTime();
    if (startsAt <= now || startsAt > horizon) continue;

    const delivered = await notifyReminder(booking);
    // Помечаем в любом случае: если клиент закрыл личные сообщения,
    // повторные попытки каждые пять минут ничего не изменят.
    db.prepare(`UPDATE bookings SET reminder_sent_at = datetime('now') WHERE id = ?`).run(booking.id);

    if (!delivered) {
      console.info(`[reminder] запись #${booking.id}: сообщение в ВК не доставлено`);
    }
  }
}

export function startScheduler(): void {
  const tick = async () => {
    try {
      await sendDueReminders();
      cleanupExpired();
    } catch (error) {
      console.error('[scheduler] ошибка в цикле напоминаний:', error);
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
}
