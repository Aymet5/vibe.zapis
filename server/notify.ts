import { CATEGORIES, minutesToTime } from '../shared/catalog';
import { db, type BookingRow, type UserRow } from './db';
import { env } from './env';
import { masterName as masterNameById } from './masters';
import { maxToken, miniAppLink, sendToMaxChat, sendToMaxUser } from './max';
import { enabledRecipients } from './recipients';
import { formatDateHuman } from './time';
import * as vk from './vk';

/** Имя и телефон вводит клиент — в HTML-уведомлениях их надо экранировать. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function masterName(booking: BookingRow): string {
  return masterNameById(booking.master_id);
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

interface ClientLinks {
  move: string;
  profile: string;
  book: string;
}

/**
 * Ссылки в сообщениях клиенту ведут туда, откуда он пришёл: вошедшему
 * из MAX — в мини-приложение (там он уже авторизован), остальным — на сайт.
 */
async function clientLinks(user: UserRow, booking: BookingRow): Promise<ClientLinks> {
  if (!user.vk_id && user.max_id) {
    const [move, profile, book] = await Promise.all([
      miniAppLink(`move-${booking.id}`),
      miniAppLink('profile'),
      miniAppLink('book'),
    ]);
    if (move && profile && book) return { move, profile, book };
  }
  return {
    move: `${env.appUrl}/profile?move=${booking.id}`,
    profile: `${env.appUrl}/profile`,
    book: env.appUrl,
  };
}

/**
 * Кнопки под сообщением клиенту в ВК. «Перенести» — всегда ссылка на кабинет.
 * «Отменить» срабатывает прямо в ВК только через Callback API; без него
 * это тоже ссылка в кабинет.
 */
function vkButtons(booking: BookingRow, links: ClientLinks): vk.VkKeyboardButton[] {
  return [
    { label: 'Перенести', link: links.move },
    vk.callbackButtonsReady()
      ? { label: 'Отменить', payload: { action: 'cancel', booking: booking.id }, color: 'negative' }
      : { label: 'Отменить', link: links.profile },
  ];
}

/**
 * Личное сообщение клиенту — во ВКонтакте или в MAX, смотря откуда он вошёл.
 * Возвращает false, если написать некуда или мессенджер не принял сообщение.
 */
async function sendToClient(
  booking: BookingRow,
  buildText: (links: ClientLinks) => string,
  options: { buttons: boolean },
): Promise<boolean> {
  const user = bookingUser(booking);
  if (!user) return false;
  const links = await clientLinks(user, booking);
  const text = buildText(links);

  if (user.vk_id) {
    return vk.sendMessage(user.vk_id, text, options.buttons ? vkButtons(booking, links) : undefined);
  }
  if (user.max_id && maxToken()) {
    return sendToMaxUser(
      user.max_id,
      text,
      options.buttons
        ? [
            { label: 'Перенести', link: links.move },
            { label: 'Отменить', link: links.profile },
          ]
        : [],
    );
  }
  return false;
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

/** Новая запись: сотрудникам — в Telegram, ВК и MAX, клиенту — в личку ВК или MAX. */
export async function notifyNewBooking(booking: BookingRow): Promise<void> {
  const user = bookingUser(booking);

  const adminText = [
    `🔥 <b>Новая запись — мастер ${masterName(booking)}</b>`,
    '',
    `👤 <b>Клиент:</b> ${escapeHtml(booking.client_name)}${
      user?.vk_id ? ` (vk.com/id${user.vk_id})` : user?.max_id ? ' (MAX)' : ' (гость)'
    }`,
    `📞 <b>Телефон:</b> ${escapeHtml(booking.client_phone)}`,
    `📅 <b>Когда:</b> ${slotLine(booking)}`,
    `✂️ <b>Услуга:</b> ${categoryLabel(booking)} — ${booking.service}`,
    `💰 <b>${priceLine(booking)}</b>`,
  ].join('\n');

  const clientText = (links: ClientLinks) =>
    [
      `${hello(booking)} Вы записаны в ВАЙБ ✅`,
      '',
      `Когда: ${slotLine(booking)}`,
      `Услуга: ${booking.service}`,
      `Мастер: ${masterName(booking)}`,
      priceLine(booking),
      '',
      'Мы напомним о визите заранее. Если планы изменятся — нажмите «Перенести» или «Отменить».',
      `Перенести: ${links.move}`,
    ].join('\n');

  const tasks: Promise<unknown>[] = [notifyStaff(adminText), sendToClient(booking, clientText, { buttons: true })];

  await Promise.all(tasks);
}

export async function notifyBookingConfirmed(booking: BookingRow): Promise<void> {
  await sendToClient(
    booking,
    () =>
      [
        `✅ ${clientFirstName(booking) ? `${clientFirstName(booking)}, запись` : 'Запись'} подтверждена!`,
        '',
        `Ждём вас ${slotLine(booking)}`,
        `Мастер: ${masterName(booking)}`,
        'Адрес: ТД «5 Звёзд», 1 этаж, г. Кызыл',
      ].join('\n'),
    { buttons: false },
  );
}

export async function notifyBookingCancelled(booking: BookingRow, byClient: boolean): Promise<void> {
  if (!byClient) {
    await sendToClient(
      booking,
      (links) =>
        [
          `${hello(booking)} К сожалению, запись отменена.`,
          '',
          `${slotLine(booking)} — ${booking.service}`,
          booking.discount_percent > 0
            ? `Зарезервированные ${booking.discount_percent}% скидки вернулись на счёт.`
            : '',
          '',
          `Записаться заново: ${links.book}`,
        ]
          .filter(Boolean)
          .join('\n'),
      { buttons: false },
    );
  }

  const adminText = [
    `❌ <b>Запись отменена — мастер ${masterName(booking)}</b>`,
    '',
    `👤 ${escapeHtml(booking.client_name)} — ${escapeHtml(booking.client_phone)}`,
    `📅 ${slotLine(booking)}`,
    `✂️ ${booking.service}`,
    byClient ? '<i>Отменил клиент</i>' : '<i>Отменил администратор</i>',
  ].join('\n');

  await notifyStaff(adminText);
}

/** Клиент перенёс запись: сотрудникам — было/стало, клиенту — подтверждение. */
export async function notifyBookingRescheduled(
  booking: BookingRow,
  previous: Pick<BookingRow, 'date' | 'start_minutes' | 'duration_minutes'>,
): Promise<void> {
  const adminText = [
    `🔁 <b>Перенос записи — мастер ${masterName(booking)}</b>`,
    '',
    `👤 <b>Клиент:</b> ${escapeHtml(booking.client_name)} — ${escapeHtml(booking.client_phone)}`,
    `Было: <s>${slotLine(previous)}</s>`,
    `📅 <b>Стало:</b> ${slotLine(booking)}`,
    `✂️ ${booking.service}`,
  ].join('\n');

  await Promise.all([
    notifyStaff(adminText),
    sendToClient(
      booking,
      () =>
        [
          `${hello(booking)} Запись перенесена 🔁`,
          '',
          `Новое время: ${slotLine(booking)}`,
          `Услуга: ${booking.service}`,
          `Мастер: ${masterName(booking)}`,
          '',
          'Напомним о визите заранее.',
        ].join('\n'),
      { buttons: true },
    ),
  ]);
}

/** Напоминание за N часов до визита. */
export async function notifyReminder(booking: BookingRow): Promise<boolean> {
  return sendToClient(
    booking,
    (links) =>
      [
        `⏰ ${clientFirstName(booking) ? `${clientFirstName(booking)}, напоминаем` : 'Напоминаем'} о записи: ${formatDateHuman(booking.date)} в ${minutesToTime(booking.start_minutes)}`,
        '',
        `Услуга: ${booking.service}`,
        `Мастер: ${masterName(booking)}`,
        'Адрес: ТД «5 Звёзд», 1 этаж, г. Кызыл',
        '',
        'Не получается прийти? Перенесите запись на другое время или отмените — окошко займёт другой человек.',
        `Перенести: ${links.move}`,
      ].join('\n'),
    { buttons: true },
  );
}

/** После визита: сообщаем новый баланс скидки. */
export async function notifyVisitCompleted(booking: BookingRow, balance: number): Promise<void> {
  await sendToClient(
    booking,
    (links) => {
      const lines = ['Спасибо, что выбрали ВАЙБ! 🧡', ''];
      if (booking.discount_percent > 0) {
        lines.push(`Списано скидки: ${booking.discount_percent}%`);
      }
      lines.push(`Ваша накопленная скидка: ${balance}%`);
      lines.push('', `Личный кабинет: ${links.profile}`);
      return lines.join('\n');
    },
    { buttons: false },
  );
}
