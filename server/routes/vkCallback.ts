import { Router } from 'express';
import { minutesToTime } from '../../shared/catalog';
import { BookingError, cancelBooking, confirmBooking, getBooking } from '../bookings';
import { db, type BookingRow, type UserRow } from '../db';
import { env } from '../env';
import { notifyBookingCancelled } from '../notify';
import { formatDateHuman, salonToday } from '../time';
import { answerCallback, sendMessage } from '../vk';

export const vkCallbackRouter = Router();

function userByVkId(vkId: string | number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE vk_id = ?').get(String(vkId)) as UserRow | undefined;
}

function upcomingBookings(userId: number): BookingRow[] {
  return db
    .prepare(
      `SELECT * FROM bookings
       WHERE user_id = ? AND status IN ('pending', 'confirmed') AND date >= ?
       ORDER BY date, start_minutes`,
    )
    .all(userId, salonToday()) as BookingRow[];
}

function describe(booking: BookingRow): string {
  const start = minutesToTime(booking.start_minutes);
  return `${formatDateHuman(booking.date)} в ${start} — ${booking.service}`;
}

/** Текстовое меню бота: баланс, ближайшая запись, ссылка на сайт. */
async function replyToMessage(vkId: string, text: string): Promise<void> {
  const user = userByVkId(vkId);

  if (!user) {
    await sendMessage(
      vkId,
      [
        'Здравствуйте! Это бот парикмахерской ВАЙБ.',
        '',
        `Чтобы копить скидку и видеть свои записи, войдите на сайте через ВКонтакте: ${env.appUrl}`,
      ].join('\n'),
    );
    return;
  }

  const normalized = text.trim().toLowerCase();
  const upcoming = upcomingBookings(user.id);

  if (normalized.includes('скид') || normalized.includes('бонус') || normalized.includes('баланс')) {
    await sendMessage(
      vkId,
      [
        `Ваша накопленная скидка: ${user.bonus_percent}%`,
        '',
        'За каждый визит начисляем 1%. Накопить можно до 100% и потратить на одну стрижку — целиком или частями.',
      ].join('\n'),
    );
    return;
  }

  const lines = [`Здравствуйте, ${user.first_name}!`, '', `Накопленная скидка: ${user.bonus_percent}%`];
  lines.push(
    upcoming.length ? `Ближайшая запись: ${describe(upcoming[0])}` : 'Активных записей нет.',
    '',
    `Записаться или посмотреть кабинет: ${env.appUrl}/profile`,
  );

  await sendMessage(vkId, lines.join('\n'));
}

/** Кнопки «Всё верно» / «Отменить» под сообщением о записи. */
async function handleCallbackButton(object: any): Promise<string> {
  const payload = typeof object.payload === 'string' ? JSON.parse(object.payload) : (object.payload ?? {});
  const booking = getBooking(Number(payload.booking));
  const user = userByVkId(object.user_id);

  if (!booking || !user || booking.user_id !== user.id) {
    return 'Запись не найдена';
  }

  try {
    if (payload.action === 'confirm') {
      if (booking.status !== 'pending') return 'Запись уже обработана';
      confirmBooking(booking.id);
      return 'Спасибо, ждём вас!';
    }

    if (payload.action === 'cancel') {
      const cancelled = cancelBooking(booking.id, 'Возврат скидки: клиент отменил запись через бота');
      void notifyBookingCancelled(cancelled, true).catch((error) =>
        console.error('[notify] уведомление об отмене не отправлено:', error),
      );
      return 'Запись отменена';
    }
  } catch (error) {
    if (error instanceof BookingError) return error.message;
    throw error;
  }

  return 'Неизвестная команда';
}

vkCallbackRouter.post('/callback', async (req, res) => {
  const body = req.body ?? {};

  // Подтверждение адреса сервера при настройке Callback API.
  if (body.type === 'confirmation') {
    if (!env.vk.callbackConfirmation) {
      res.status(503).send('VK_CALLBACK_CONFIRMATION не задан');
      return;
    }
    res.send(env.vk.callbackConfirmation);
    return;
  }

  if (env.vk.callbackSecret && body.secret !== env.vk.callbackSecret) {
    res.status(403).send('forbidden');
    return;
  }

  // ВК ждёт «ok» в течение нескольких секунд, иначе повторяет доставку.
  res.send('ok');

  try {
    const object = body.object ?? {};

    switch (body.type) {
      case 'message_new': {
        const message = object.message ?? object;
        if (message?.from_id > 0) {
          await replyToMessage(String(message.from_id), String(message.text ?? ''));
        }
        break;
      }

      case 'message_event': {
        const answer = await handleCallbackButton(object);
        await answerCallback(String(object.event_id), String(object.user_id), String(object.peer_id), answer);
        break;
      }

      // Клиент включил или выключил сообщения от сообщества.
      case 'message_allow':
      case 'message_deny': {
        const allowed = body.type === 'message_allow' ? 1 : 0;
        db.prepare('UPDATE users SET vk_messages_allowed = ? WHERE vk_id = ?').run(allowed, String(object.user_id));
        break;
      }

      default:
        break;
    }
  } catch (error) {
    console.error('[vk] ошибка обработки события Callback API:', error);
  }
});
