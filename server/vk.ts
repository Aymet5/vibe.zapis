import crypto from 'node:crypto';
import { db } from './db';
import { env } from './env';

const ID_BASE = 'https://id.vk.com';
const API_BASE = 'https://api.vk.com/method';

export interface VkProfile {
  vkId: string;
  firstName: string;
  lastName: string;
  photo: string | null;
  phone: string | null;
}

export class VkError extends Error {}

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function redirectUri(): string {
  return `${env.appUrl}/api/auth/vk/callback`;
}

/**
 * Создаёт ссылку на VK ID с PKCE. Пара state/code_verifier кладётся в базу,
 * потому что колбэк может прийти в другой процесс или после перезапуска.
 */
export function buildAuthorizeUrl(): string {
  if (!env.vk.appId) throw new VkError('VK_APP_ID не задан');

  const state = base64url(crypto.randomBytes(24));
  const codeVerifier = base64url(crypto.randomBytes(48));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

  db.prepare('INSERT INTO oauth_states (state, code_verifier) VALUES (?, ?)').run(state, codeVerifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.vk.appId,
    redirect_uri: redirectUri(),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 's256',
    scope: 'vkid.personal_info phone',
  });

  return `${ID_BASE}/authorize?${params.toString()}`;
}

function takeCodeVerifier(state: string): string {
  const row = db.prepare('SELECT code_verifier FROM oauth_states WHERE state = ?').get(state) as
    | { code_verifier: string }
    | undefined;
  if (!row) throw new VkError('Ссылка для входа устарела, попробуйте войти заново');
  db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
  return row.code_verifier;
}

async function postForm(url: string, body: Record<string, string>): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const json = await response.json().catch(() => null);
  if (!json) throw new VkError(`ВК вернул неожиданный ответ (${response.status})`);
  if (json.error) {
    throw new VkError(json.error_description || json.error_msg || String(json.error));
  }
  return json;
}

/** Обмен кода на токен и получение профиля. */
export async function exchangeCode(code: string, state: string, deviceId: string): Promise<VkProfile> {
  if (!env.vk.appId || !env.vk.appSecret) throw new VkError('Вход через ВК не настроен');

  const codeVerifier = takeCodeVerifier(state);

  const token = await postForm(`${ID_BASE}/oauth2/auth`, {
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    client_id: env.vk.appId,
    client_secret: env.vk.appSecret,
    device_id: deviceId,
    redirect_uri: redirectUri(),
    state,
  });

  const info = await postForm(`${ID_BASE}/oauth2/user_info`, {
    client_id: env.vk.appId,
    access_token: token.access_token,
  });

  const user = info.user ?? {};
  if (!user.user_id) throw new VkError('ВК не вернул идентификатор пользователя');

  return {
    vkId: String(user.user_id),
    firstName: user.first_name ?? '',
    lastName: user.last_name ?? '',
    photo: user.avatar ?? null,
    phone: user.phone ? `+${String(user.phone).replace(/\D/g, '')}` : null,
  };
}

async function callApi(method: string, params: Record<string, string>): Promise<any> {
  if (!env.vk.groupToken) throw new VkError('VK_GROUP_TOKEN не задан');
  const json = await postForm(`${API_BASE}/${method}`, {
    ...params,
    access_token: env.vk.groupToken,
    v: env.vk.apiVersion,
  });
  return json.response;
}

export interface VkKeyboardButton {
  label: string;
  payload: Record<string, unknown>;
  color?: 'primary' | 'secondary' | 'negative' | 'positive';
}

function inlineKeyboard(buttons: VkKeyboardButton[]): string {
  return JSON.stringify({
    inline: true,
    buttons: buttons.map((button) => [
      {
        action: { type: 'callback', label: button.label, payload: JSON.stringify(button.payload) },
        color: button.color ?? 'secondary',
      },
    ]),
  });
}

/**
 * Пишет клиенту в личные сообщения от имени сообщества.
 * Возвращает false, если клиент не разрешил переписку, — это не ошибка приложения.
 */
export async function sendMessage(
  vkId: string,
  message: string,
  buttons?: VkKeyboardButton[],
): Promise<boolean> {
  if (!env.vk.botEnabled) return false;
  const params: Record<string, string> = {
    user_id: vkId,
    message,
    random_id: String(crypto.randomInt(1, 2 ** 31 - 1)),
    dont_parse_links: '0',
  };
  if (buttons?.length) params.keyboard = inlineKeyboard(buttons);

  try {
    await callApi('messages.send', params);
    return true;
  } catch (error) {
    // 901 — пользователь запретил сообщения от сообщества.
    console.warn(`[vk] не удалось отправить сообщение ${vkId}:`, (error as Error).message);
    return false;
  }
}

/** Разрешил ли клиент сообщения от сообщества. */
export async function isMessagingAllowed(vkId: string): Promise<boolean> {
  if (!env.vk.botEnabled || !env.vk.groupId) return false;
  try {
    const response = await callApi('messages.isMessagesFromGroupAllowed', {
      group_id: env.vk.groupId,
      user_id: vkId,
    });
    return response?.is_allowed === 1;
  } catch (error) {
    console.warn('[vk] проверка разрешения на сообщения не удалась:', (error as Error).message);
    return false;
  }
}

/** Ответ на нажатие inline-кнопки — всплывашка в диалоге. */
export async function answerCallback(eventId: string, userId: string, peerId: string, text: string): Promise<void> {
  try {
    await callApi('messages.sendMessageEventAnswer', {
      event_id: eventId,
      user_id: userId,
      peer_id: peerId,
      event_data: JSON.stringify({ type: 'show_snackbar', text: text.slice(0, 90) }),
    });
  } catch (error) {
    console.warn('[vk] ответ на callback не отправлен:', (error as Error).message);
  }
}

/** Ссылка на диалог с сообществом — по ней клиент включает уведомления. */
export function communityChatUrl(): string | null {
  if (!env.vk.groupId) return null;
  return `https://vk.com/im?sel=-${env.vk.groupId}`;
}
