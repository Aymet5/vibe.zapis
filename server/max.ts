import crypto from 'node:crypto';
import { getSetting, setSetting } from './db';
import { env } from './env';
import { findRecipient, forgetRecipient, rememberRecipient } from './recipients';

/**
 * Бот мессенджера MAX. Шлёт сотрудникам уведомления о записях в общий чат
 * или в личку. События забираем long polling'ом: вебхук потребовал бы
 * регистрации адреса, а так бот работает, как только в админке указан токен.
 */

const TOKEN_KEY = 'max_bot_token';
const MARKER_KEY = 'max_updates_marker';

export class MaxError extends Error {}

export function maxToken(): string | undefined {
  return getSetting(TOKEN_KEY) ?? env.max.botToken;
}

async function maxRequest(
  method: 'GET' | 'POST',
  path: string,
  options: { body?: unknown; token?: string; timeoutMs?: number } = {},
): Promise<any> {
  const token = options.token ?? maxToken();
  if (!token) throw new MaxError('Токен бота MAX не задан');

  const response = await fetch(`${env.max.apiUrl}${path}`, {
    method,
    // Токен в адресе MAX больше не принимает — только заголовком.
    headers: {
      Authorization: token,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new MaxError(json?.message ?? `MAX ответил ${response.status}`);
  }
  return json;
}

export interface MaxBotInfo {
  name: string;
  username: string | null;
  userId: string | null;
}

export async function botInfo(token?: string): Promise<MaxBotInfo> {
  const me = await maxRequest('GET', '/me', { token });
  return {
    name: me.name ?? me.first_name ?? 'Бот',
    username: me.username ?? null,
    userId: me.user_id != null ? String(me.user_id) : null,
  };
}

let cachedBot: { token: string; info: MaxBotInfo } | null = null;

/**
 * Ссылка, открывающая мини-приложение бота прямо в MAX. payload — латиница,
 * цифры, «_» и «-», до 512 символов; приходит в приложение как start_param.
 */
export async function miniAppLink(payload: string): Promise<string | null> {
  const token = maxToken();
  if (!token) return null;
  try {
    if (cachedBot?.token !== token) cachedBot = { token, info: await botInfo(token) };
  } catch {
    return null;
  }
  const username = cachedBot.info.username;
  return username ? `https://max.ru/${username}?startapp=${payload}` : null;
}

/** Проверяет токен и сохраняет его. Пустой токен отключает бота. */
export async function saveMaxToken(rawToken: string): Promise<MaxBotInfo | null> {
  const token = rawToken.trim();
  if (!token) {
    setSetting(TOKEN_KEY, null);
    setSetting(MARKER_KEY, null);
    return null;
  }
  const info = await botInfo(token);
  setSetting(TOKEN_KEY, token);
  cachedBot = { token, info };
  // Позиция в ленте событий принадлежит прежнему боту.
  setSetting(MARKER_KEY, null);
  return info;
}

/**
 * Админ ли бот в чате. Без прав администратора MAX не присылает боту
 * сообщения группы — писать он может, а слышать нет. null — не удалось узнать.
 */
export async function botIsChatAdmin(chatId: string): Promise<boolean | null> {
  try {
    const me = await maxRequest('GET', `/chats/${encodeURIComponent(chatId)}/members/me`);
    return Boolean(me?.is_admin || me?.is_owner);
  } catch {
    return null;
  }
}

/** «Печатает…» в чате, пока готовится ответ. Не критично, если не сработает. */
export async function showTyping(chatId: string): Promise<void> {
  try {
    await maxRequest('POST', `/chats/${encodeURIComponent(chatId)}/actions`, { body: { action: 'typing_on' } });
  } catch {
    // Индикатор — украшение, без него ответ всё равно придёт.
  }
}

export interface MaxLinkButton {
  label: string;
  link: string;
}

/** Личное сообщение клиенту по id пользователя MAX, с кнопками-ссылками. */
export async function sendToMaxUser(userId: string, text: string, buttons: MaxLinkButton[] = []): Promise<boolean> {
  try {
    await maxRequest('POST', `/messages?user_id=${encodeURIComponent(userId)}`, {
      body: {
        text: text.slice(0, 4000),
        attachments: buttons.length
          ? [
              {
                type: 'inline_keyboard',
                payload: { buttons: buttons.map((button) => [{ type: 'link', text: button.label, url: button.link }]) },
              },
            ]
          : undefined,
      },
    });
    return true;
  } catch (error) {
    console.warn(`[max] не удалось написать клиенту ${userId}:`, (error as Error).message);
    return false;
  }
}

export interface MaxWebAppUser {
  maxId: string;
  firstName: string;
  lastName: string;
  photo: string | null;
}

/** Сколько живут данные запуска мини-приложения. */
const INIT_DATA_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Проверка данных запуска мини-приложения: подпись HMAC-SHA256 ключом
 * HMAC-SHA256('WebAppData', токен бота) по отсортированным парам key=value.
 * Мост MAX кладёт строку в адрес ещё раз закодированной, поэтому пробуем
 * и её, и раскодированную — подпись сойдётся только у настоящей.
 */
export function verifyInitData(initData: string): MaxWebAppUser {
  const token = maxToken();
  if (!token) throw new MaxError('Бот MAX не подключён');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const variants = [initData];
  try {
    const decoded = decodeURIComponent(initData);
    if (decoded !== initData) variants.push(decoded);
  } catch {
    // Строка без процентного кодирования — проверяем как есть.
  }

  for (const raw of variants) {
    const params = new URLSearchParams(raw);
    const hash = params.get('hash');
    if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) continue;

    const checkString = [...params.entries()]
      .filter(([key]) => key !== 'hash')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const expected = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash.toLowerCase()))) continue;

    // auth_date бывает и в секундах, и в миллисекундах.
    const authDate = Number(params.get('auth_date'));
    const authMs = authDate > 1e12 ? authDate : authDate * 1000;
    if (!authDate || Date.now() - authMs > INIT_DATA_TTL_MS) {
      throw new MaxError('Данные входа устарели — откройте приложение заново');
    }

    const user = JSON.parse(params.get('user') ?? 'null');
    if (!user?.id) throw new MaxError('MAX не передал пользователя');
    return {
      maxId: String(user.id),
      firstName: String(user.first_name ?? ''),
      lastName: String(user.last_name ?? ''),
      photo: user.photo_url ? String(user.photo_url) : null,
    };
  }

  console.warn(
    '[max] подпись данных мини-приложения не сошлась, поля:',
    [...new URLSearchParams(initData).keys()].join(','),
  );
  throw new MaxError('Не удалось проверить вход из MAX');
}

/** Сообщение в чат или диалог. Ошибки не роняют запись клиента. */
export async function sendToMaxChat(
  chatId: string,
  html: string,
  options: { replyTo?: string } = {},
): Promise<boolean> {
  try {
    await maxRequest('POST', `/messages?chat_id=${encodeURIComponent(chatId)}`, {
      body: {
        text: html.slice(0, 4000),
        format: 'html',
        // Ответ «цитатой» на конкретное сообщение в чате.
        ...(options.replyTo ? { link: { type: 'reply', mid: options.replyTo } } : {}),
      },
    });
    return true;
  } catch (error) {
    console.warn(`[max] не удалось написать в чат ${chatId}:`, (error as Error).message);
    return false;
  }
}

function personName(user: any): string {
  const full = [user?.first_name, user?.last_name].filter(Boolean).join(' ');
  return full || user?.name || (user?.username ? `@${user.username}` : 'Без имени');
}

async function chatTitle(chatId: string): Promise<string> {
  try {
    const chat = await maxRequest('GET', `/chats/${encodeURIComponent(chatId)}`);
    if (chat?.title) return String(chat.title);
  } catch {
    // Название не обязательно — администратор узнает чат и по номеру.
  }
  return `Чат ${chatId}`;
}

const WAITING_TEXT =
  'Уведомления о записях появятся здесь, когда администратор включит этот чат в панели управления сайта.';

async function registerChat(chatId: string, greet: boolean): Promise<void> {
  const known = findRecipient('max', chatId);
  if (known && !greet) return;
  rememberRecipient({ channel: 'max', target: chatId, kind: 'chat', title: await chatTitle(chatId) });
  if (greet) await sendToMaxChat(chatId, `Бот парикмахерской ВАЙБ подключён. ${WAITING_TEXT}`);
}

async function registerPerson(chatId: string, user: any, reply: boolean): Promise<void> {
  const row = rememberRecipient({ channel: 'max', target: chatId, kind: 'person', title: personName(user) });
  if (!reply) return;
  await sendToMaxChat(
    chatId,
    row.enabled
      ? `Здравствуйте, ${personName(user)}! Уведомления о новых записях включены.`
      : `Здравствуйте, ${personName(user)}! ${WAITING_TEXT}`,
  );
}

type GroupMessageHandler = (chatId: string, message: any) => Promise<void>;
let groupMessageHandler: GroupMessageHandler | null = null;

/** Кто разговаривает в групповых чатах — подключается при запуске (см. chatbot.ts). */
export function onMaxGroupMessage(handler: GroupMessageHandler): void {
  groupMessageHandler = handler;
}

async function greetClient(chatId: string, user: any): Promise<void> {
  const link = await miniAppLink('book');
  const name = user?.first_name ? `, ${user.first_name}` : '';
  await sendToMaxChat(
    chatId,
    link
      ? `Здравствуйте${name}! Это бот парикмахерской ВАЙБ. Записаться: ${link}`
      : `Здравствуйте${name}! Это бот парикмахерской ВАЙБ. Записаться: ${env.appUrl}`,
  );
}

async function handleUpdate(update: any): Promise<void> {
  const chatId = update.chat_id != null ? String(update.chat_id) : undefined;

  switch (update.update_type) {
    case 'bot_added':
      if (chatId) await registerChat(chatId, true);
      break;

    case 'bot_removed':
      if (chatId) forgetRecipient('max', chatId);
      break;

    // «Начать» жмут в основном клиенты — им отвечаем ссылкой на запись,
    // в список получателей уведомлений они не попадают.
    case 'bot_started':
      if (chatId) await greetClient(chatId, update.user);
      break;

    case 'message_created': {
      // Бота могли добавить в чат, пока сервер лежал, — узнаём чат по первому сообщению.
      const message = update.message ?? {};
      const target = message.recipient?.chat_id != null ? String(message.recipient.chat_id) : undefined;
      if (!target || message.sender?.is_bot) break;
      if (message.recipient.chat_type === 'dialog') {
        // Мастер, которому нужны записи в личку, пишет боту «сотрудник».
        if (/сотрудник|\/staff/i.test(String(message.body?.text ?? ''))) {
          await registerPerson(target, message.sender, true);
        } else {
          await greetClient(target, message.sender);
        }
      } else {
        await registerChat(target, false);
        if (groupMessageHandler) {
          await groupMessageHandler(target, message).catch((error) =>
            console.warn('[max] бот не ответил в чате:', (error as Error).message),
          );
        }
      }
      break;
    }

    default:
      break;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function startMaxPolling(): void {
  const loop = async () => {
    for (;;) {
      const token = maxToken();
      if (!token) {
        await sleep(30_000);
        continue;
      }

      try {
        const params = new URLSearchParams({
          timeout: '30',
          limit: '100',
          types: 'bot_added,bot_removed,bot_started,message_created',
        });
        const marker = getSetting(MARKER_KEY);
        if (marker) params.set('marker', marker);

        const data = await maxRequest('GET', `/updates?${params}`, { token, timeoutMs: 45_000 });
        for (const update of data?.updates ?? []) {
          try {
            await handleUpdate(update);
          } catch (error) {
            console.error('[max] ошибка обработки события:', error);
          }
        }
        // Токен могли сменить, пока шёл запрос, — тогда позицию не сохраняем.
        if (data?.marker != null && maxToken() === token) setSetting(MARKER_KEY, String(data.marker));
      } catch (error) {
        console.warn('[max] не удалось получить события:', (error as Error).message);
        await sleep(15_000);
      }
    }
  };

  void loop();
}
