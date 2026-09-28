import { CATEGORIES, findMaster, minutesToTime } from '../shared/catalog';
import { db, type BookingRow, type UserRow } from './db';
import { env } from './env';
import { maxToken, sendToMaxChat } from './max';
import { enabledRecipients } from './recipients';
import { formatDateHuman } from './time';
import * as vk from './vk';

/** Имя и телефон вводит клиент — в HTML-уведомлениях их надо экранировать. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

function slotLine(booking: Pick<BookingRow, 'date' | 'start_minutes' | 'duration_minutes'>): string {
  const start = minutesToTime(booking.start_minutes);
  const end = minutesToTime(booking.start_minutes + booking.duration_minutes);
  return `${formatDateHuman(booking.date)}, ${start}–${end}`;
}

/** Обращение к клиенту: имя из записи, а не из профиля ВК — так он сам себя назвал. */
function clientFirstName(booking: BookingRow): string {
  return booking.client_name.trim().split(/\s+/)[0] ?? '';
}

function hello(booking: BookingRow): string {
  const name = clientFirstName(booking);
  return name ? `${name}, здравствуйте!` : 'Здравствуйте!';
}

function moveLink(booking: BookingRow): string {
  return `${env.appUrl}/profile?move=${booking.id}`;
}

/**
 * Кнопки под сообщением клиенту. «Перенести» — всегда ссылка на кабинет.
 * «Отменить» срабатывает прямо в ВК только через Callback API; без него
 * это тоже ссылка в кабинет.
 */
function clientButtons(booking: BookingRow): vk.VkKeyboardButton[] {
  const buttons: vk.VkKeyboardButton[] = [];
  const callbacks = vk.callbackButtonsReady();

  buttons.push({ label: 'Перенести', link: moveLink(booking) });
  buttons.push(
    callbacks
      ? { label: 'Отменить', payload: { action: 'cancel', booking: booking.id }, color: 'negative' }
      : { label: 'Отменить', link: `${env.appUrl}/profile` },
  );
  return buttons;
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

/** ВК не понимает HTML-разметку Telegram — для беседы отдаём чистый текст. */
function stripHtml(text: string): string {
  return text.replace(/<\/?[a-z]+>/gi, '');
}

/** Уведомление в рабочие беседы ВКонтакте. Ошибки не роняют запись клиента. */
async function notifyVkChats(htmlText: string): Promise<void> {
  const peerIds = vkStaffPeers();
  if (peerIds.length === 0) return;

  const text = stripHtml(htmlText);
  await Promise.all(peerIds.map((peerId) => vk.sendToPeer(peerId, text)));
}

/** Получатели в ВК: из админки плюс старые из VK_ADMIN_PEER_IDS. */
function vkStaffPeers(): string[] {
  const fromAdmin = enabledRecipients('vk').map((row) => row.target);
  return [...new Set([...env.vk.adminPeerIds, ...fromAdmin])];
}

/** Чаты и люди в MAX, которых администратор включил в панели. */
async function notifyMax(htmlText: string): Promise<void> {
  if (!maxToken()) return;
  await Promise.all(enabledRecipients('max').map((row) => sendToMaxChat(row.target, htmlText)));
}

/** Всем сотрудникам сразу: Telegram, ВК, MAX. */
async function notifyStaff(htmlText: string): Promise<void> {
  await Promise.all([notifyTelegram(htmlText), notifyVkChats(htmlText), notifyMax(htmlText)]);
}

export interface StaffDelivery {
  channel: 'vk' | 'max';
  target: string;
  title: string;
  ok: boolean;
}

/** Проверка из админки: пишет каждому включённому получателю и сообщает, кому дошло. */
export async function sendStaffTest(): Promise<StaffDelivery[]> {
  const text = '✅ Проверка: сюда будут приходить новые записи, переносы и отмены.';
  const vkRows = enabledRecipients('vk');
  const maxRows = maxToken() ? enabledRecipients('max') : [];

  return Promise.all([
    ...vkRows.map(async (row) => ({
      channel: 'vk' as const,
      target: row.target,
      title: row.title,
      ok: await vk.sendToPeer(row.target, text),
    })),
    ...maxRows.map(async (row) => ({
      channel: 'max' as const,
      target: row.target,
      title: row.title,
      ok: await sendToMaxChat(row.target, text),
    })),
  ]);
}

/** Новая запись: админам — в Telegram и рабочую беседу ВК, клиенту — в личку. */
export async function notifyNewBooking(booking: BookingRow): Promise<void> {
  const user = bookingUser(booking);

  const adminText = [
    '🔥 <b>Новая запись</b>',
    '',
    `👤 <b>Клиент:</b> ${escapeHtml(booking.client_name)}${user?.vk_id ? ` (vk.com/id${user.vk_id})` : ' (гость)'}`,
    `📞 <b>Телефон:</b> ${escapeHtml(booking.client_phone)}`,
    `📅 <b>Когда:</b> ${slotLine(booking)}`,
    `✂️ <b>Услуга:</b> ${categoryLabel(booking)} — ${booking.service}`,
    `💈 <b>Мастер:</b> ${masterName(booking)}`,
    `💰 <b>${priceLine(booking)}</b>`,
  ].join('\n');

  const clientText = [
    `${hello(booking)} Вы записаны в ВАЙБ ✅`,
    '',
    `Когда: ${slotLine(booking)}`,
    `Услуга: ${booking.service}`,
    `Мастер: ${masterName(booking)}`,
    priceLine(booking),
    '',
    'Мы напомним о визите заранее. Если планы изменятся — нажмите «Перенести» или «Отменить».',
    `Перенести: ${moveLink(booking)}`,
  ].join('\n');

  const tasks: Promise<unknown>[] = [notifyStaff(adminText)];

  if (user?.vk_id) {
    tasks.push(vk.sendMessage(user.vk_id, clientText, clientButtons(booking)));
  }

  await Promise.all(tasks);
}

export async function notifyBookingConfirmed(booking: BookingRow): Promise<void> {
  const user = bookingUser(booking);
  if (!user?.vk_id) return;
  await vk.sendMessage(
    user.vk_id,
    [
      `✅ ${clientFirstName(booking) ? `${clientFirstName(booking)}, запись` : 'Запись'} подтверждена!`,
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
        `${hello(booking)} К сожалению, запись отменена.`,
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

  const adminText = [
    '❌ <b>Запись отменена</b>',
    '',
    `👤 ${escapeHtml(booking.client_name)} — ${escapeHtml(booking.client_phone)}`,
    `📅 ${slotLine(booking)}`,
    `✂️ ${booking.service} у ${masterName(booking)}`,
    byClient ? '<i>Отменил клиент</i>' : '<i>Отменил администратор</i>',
  ].join('\n');

  await notifyStaff(adminText);
}

/** Клиент перенёс запись: сотрудникам — было/стало, клиенту — подтверждение. */
export async function notifyBookingRescheduled(
  booking: BookingRow,
  previous: Pick<BookingRow, 'date' | 'start_minutes' | 'duration_minutes'>,
): Promise<void> {
  const user = bookingUser(booking);

  const adminText = [
    '🔁 <b>Перенос записи</b>',
    '',
    `👤 <b>Клиент:</b> ${escapeHtml(booking.client_name)} — ${escapeHtml(booking.client_phone)}`,
    `Было: <s>${slotLine(previous)}</s>`,
    `📅 <b>Стало:</b> ${slotLine(booking)}`,
    `✂️ ${booking.service} у ${masterName(booking)}`,
  ].join('\n');

  const tasks: Promise<unknown>[] = [notifyStaff(adminText)];

  if (user?.vk_id) {
    tasks.push(
      vk.sendMessage(
        user.vk_id,
        [
          `${hello(booking)} Запись перенесена 🔁`,
          '',
          `Новое время: ${slotLine(booking)}`,
          `Услуга: ${booking.service}`,
          `Мастер: ${masterName(booking)}`,
          '',
          'Напомним о визите заранее.',
        ].join('\n'),
        clientButtons(booking),
      ),
    );
  }

  await Promise.all(tasks);
}

/** Напоминание за N часов до визита. */
export async function notifyReminder(booking: BookingRow): Promise<boolean> {
  const user = bookingUser(booking);
  if (!user?.vk_id) return false;

  return vk.sendMessage(
    user.vk_id,
    [
      `⏰ ${clientFirstName(booking) ? `${clientFirstName(booking)}, напоминаем` : 'Напоминаем'} о записи: ${formatDateHuman(booking.date)} в ${minutesToTime(booking.start_minutes)}`,
      '',
      `Услуга: ${booking.service}`,
      `Мастер: ${masterName(booking)}`,
      'Адрес: ТД «5 Звёзд», 1 этаж, г. Кызыл',
      '',
      'Не получается прийти? Перенесите запись на другое время или отмените — окошко займёт другой человек.',
      `Перенести: ${moveLink(booking)}`,
    ].join('\n'),
    clientButtons(booking),
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
