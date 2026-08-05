import { CATEGORIES, findMaster, minutesToTime } from '../shared/catalog';
import { db, type BookingRow, type UserRow } from './db';
import { env } from './env';
import { formatDateHuman } from './time';
import * as vk from './vk';

function masterName(booking: BookingRow): string {
  return findMaster(booking.master_id)?.name ?? booking.master_id;
}

function categoryLabel(booking: BookingRow): string {
  return CATEGORIES.find((c) => c.id === booking.category)?.label ?? booking.category;
}

function priceLine(booking: BookingRow): string {
  if (booking.base_price === null) return 'Стоимость: уточним на месте';
  if (booking.discount_percent > 0 && booking.final_price !== null) {
    return `Стоимость: ${booking.final_price}р (скидка ${booking.discount_percent}% вместо ${booking.base_price}р)`;
  }
  return `Стоимость: ${booking.base_price}р`;
}

function slotLine(booking: BookingRow): string {
  const start = minutesToTime(booking.start_minutes);
  const end = minutesToTime(booking.start_minutes + booking.duration_minutes);
  return `${formatDateHuman(booking.date)}, ${start}–${end}`;
}

function bookingUser(booking: BookingRow): UserRow | undefined {
  if (!booking.user_id) return undefined;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(booking.user_id) as UserRow | undefined;
}

/** Уведомление администраторам в Telegram. Ошибки не роняют запись клиента. */
async function notifyTelegram(text: string): Promise<void> {
  const { botToken, chatIds } = env.telegram;
  if (!botToken || chatIds.length === 0) return;

  await Promise.all(
    chatIds.map(async (chatId) => {
      try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        });
        if (!response.ok) {
          console.warn(`[telegram] чат ${chatId}: ответ ${response.status}`);
        }
      } catch (error) {
        console.warn(`[telegram] чат ${chatId}:`, (error as Error).message);
      }
    }),
  );
}

/** Новая запись: админам — в Telegram, клиенту — в ВК. */
export async function notifyNewBooking(booking: BookingRow): Promise<void> {
  const user = bookingUser(booking);

  const adminText = [
    '🔥 <b>Новая запись</b>',
    '',
    `👤 <b>Клиент:</b> ${booking.client_name}${user?.vk_id ? ` (vk.com/id${user.vk_id})` : ' (гость)'}`,
    `📞 <b>Телефон:</b> ${booking.client_phone}`,
    `📅 <b>Когда:</b> ${slotLine(booking)}`,
    `✂️ <b>Услуга:</b> ${categoryLabel(booking)} — ${booking.service}`,
    `💈 <b>Мастер:</b> ${masterName(booking)}`,
    `💰 <b>${priceLine(booking)}</b>`,
    '',
    `Подтвердить: ${env.appUrl}/admin`,
  ].join('\n');

  const clientText = [
    'Здравствуйте! Ваша запись в ВАЙБ принята ✂️',
    '',
    `Когда: ${slotLine(booking)}`,
    `Услуга: ${booking.service}`,
    `Мастер: ${masterName(booking)}`,
    priceLine(booking),
    '',
    'Мы напомним о визите заранее. Если планы изменятся — нажмите «Отменить».',
  ].join('\n');

  const tasks: Promise<unknown>[] = [notifyTelegram(adminText)];

  if (user?.vk_id) {
    tasks.push(
      vk.sendMessage(user.vk_id, clientText, [
        { label: 'Всё верно', payload: { action: 'confirm', booking: booking.id }, color: 'positive' },
        { label: 'Отменить', payload: { action: 'cancel', booking: booking.id }, color: 'negative' },
      ]),
    );
  }

  await Promise.all(tasks);
}

export async function notifyBookingConfirmed(booking: BookingRow): Promise<void> {
  const user = bookingUser(booking);
  if (!user?.vk_id) return;
  await vk.sendMessage(
    user.vk_id,
    [
      '✅ Запись подтверждена!',
      '',
      `Ждём вас ${slotLine(booking)}`,
      `Мастер: ${masterName(booking)}`,
      'Адрес: ТД «5 Звёзд», 1 этаж, г. Кызыл',
    ].join('\n'),
  );
}

export async function notifyBookingCancelled(booking: BookingRow, byClient: boolean): Promise<void> {
  const user = bookingUser(booking);

  if (user?.vk_id && !byClient) {
    await vk.sendMessage(
      user.vk_id,
      [
        'К сожалению, запись отменена.',
        '',
        `${slotLine(booking)} — ${booking.service}`,
        booking.discount_percent > 0 ? `Зарезервированные ${booking.discount_percent}% скидки вернулись на счёт.` : '',
        '',
        `Записаться заново: ${env.appUrl}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  await notifyTelegram(
    [
      '❌ <b>Запись отменена</b>',
      '',
      `👤 ${booking.client_name} — ${booking.client_phone}`,
      `📅 ${slotLine(booking)}`,
      `✂️ ${booking.service} у ${masterName(booking)}`,
      byClient ? '<i>Отменил клиент</i>' : '<i>Отменил администратор</i>',
    ].join('\n'),
  );
}

/** Напоминание за N часов до визита. */
export async function notifyReminder(booking: BookingRow): Promise<boolean> {
  const user = bookingUser(booking);
  if (!user?.vk_id) return false;

  return vk.sendMessage(
    user.vk_id,
    [
      `⏰ Напоминаем о записи: сегодня в ${minutesToTime(booking.start_minutes)}`,
      '',
      `Услуга: ${booking.service}`,
      `Мастер: ${masterName(booking)}`,
      'Адрес: ТД «5 Звёзд», 1 этаж, г. Кызыл',
      '',
      'Если не получается прийти — сообщите нам, окошко займёт другой человек.',
    ].join('\n'),
    [{ label: 'Не смогу прийти', payload: { action: 'cancel', booking: booking.id }, color: 'negative' }],
  );
}

/** После визита: сообщаем новый баланс скидки. */
export async function notifyVisitCompleted(booking: BookingRow, balance: number): Promise<void> {
  const user = bookingUser(booking);
  if (!user?.vk_id) return;

  const lines = ['Спасибо, что выбрали ВАЙБ! 🧡', ''];
  if (booking.discount_percent > 0) {
    lines.push(`Списано скидки: ${booking.discount_percent}%`);
  }
  lines.push(`Ваша накопленная скидка: ${balance}%`);
  lines.push('', `Личный кабинет: ${env.appUrl}/profile`);

  await vk.sendMessage(user.vk_id, lines.join('\n'));
}
