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
}

export async function botInfo(token?: string): Promise<MaxBotInfo> {
  const me = await maxRequest('GET', '/me', { token });
  return { name: me.name ?? me.first_name ?? 'Бот', username: me.username ?? null };
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
  // Позиция в ленте событий принадлежит прежнему боту.
  setSetting(MARKER_KEY, null);
  return info;
}

/** Сообщение в чат или диалог. Ошибки не роняют запись клиента. */
export async function sendToMaxChat(chatId: string, html: string): Promise<boolean> {
  try {
    await maxRequest('POST', `/messages?chat_id=${encodeURIComponent(chatId)}`, {
      body: { text: html.slice(0, 4000), format: 'html' },
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

async function handleUpdate(update: any): Promise<void> {
  const chatId = update.chat_id != null ? String(update.chat_id) : undefined;

  switch (update.update_type) {
    case 'bot_added':
      if (chatId) await registerChat(chatId, true);
      break;

    case 'bot_removed':
      if (chatId) forgetRecipient('max', chatId);
      break;

    case 'bot_started':
      if (chatId) await registerPerson(chatId, update.user, true);
      break;

    case 'message_created': {
      // Бота могли добавить в чат, пока сервер лежал, — узнаём чат по первому сообщению.
      const message = update.message ?? {};
      const target = message.recipient?.chat_id != null ? String(message.recipient.chat_id) : undefined;
      if (!target || message.sender?.is_bot) break;
      if (message.recipient.chat_type === 'dialog') {
        await registerPerson(target, message.sender, true);
      } else {
        await registerChat(target, false);
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
