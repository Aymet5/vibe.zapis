import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function number(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Переменная окружения ${name} должна быть числом, получено: ${raw}`);
  }
  return parsed;
}

const isProduction = (optional('NODE_ENV') ?? 'development') === 'production';

/**
 * В разработке секрет сессий генерируется на лету — это удобно, но означает,
 * что после перезапуска все входы слетают. В проде переменная обязательна.
 */
function sessionSecret(): string {
  const configured = optional('SESSION_SECRET');
  if (configured) return configured;
  if (isProduction) {
    throw new Error('SESSION_SECRET обязателен в production. Сгенерируйте: openssl rand -hex 32');
  }
  console.warn('[env] SESSION_SECRET не задан — использую временный ключ (сессии слетят при перезапуске)');
  return crypto.randomBytes(32).toString('hex');
}

const vkAppId = optional('VK_APP_ID');
const vkAppSecret = optional('VK_APP_SECRET');
const vkGroupToken = optional('VK_GROUP_TOKEN');
const vkGroupId = optional('VK_GROUP_ID');

export const env = {
  isProduction,
  port: number('PORT', 3001),
  /** Публичный адрес сайта. Нужен для redirect_uri VK и ссылок в сообщениях. */
  appUrl: (optional('APP_URL') ?? `http://localhost:${number('PORT', 3001)}`).replace(/\/+$/, ''),
  sessionSecret: sessionSecret(),
  databasePath: optional('DATABASE_PATH') ?? path.resolve(process.cwd(), 'data/vibe.sqlite'),
  /** Куда складывать фотографии мастеров. Рядом с базой, чтобы бэкап был один. */
  uploadsPath:
    optional('UPLOADS_PATH') ??
    path.resolve(path.dirname(optional('DATABASE_PATH') ?? path.resolve(process.cwd(), 'data/vibe.sqlite')), 'uploads'),

  /** Пароль в панель администратора. Без него панель недоступна. */
  adminPassword: optional('ADMIN_PASSWORD'),

  vk: {
    appId: vkAppId,
    appSecret: vkAppSecret,
    groupToken: vkGroupToken,
    groupId: vkGroupId,
    /** Секретный ключ Callback API — сервер отклоняет запросы без него. */
    callbackSecret: optional('VK_CALLBACK_SECRET'),
    /** Строка, которую ВК ждёт в ответ при подтверждении адреса сервера. */
    callbackConfirmation: optional('VK_CALLBACK_CONFIRMATION'),
    /**
     * Беседы сотрудников, куда бот пишет о новых записях и отменах.
     * peer_id беседы = 2000000000 + её номер (он же виден в адресе: vk.com/im?sel=c5 → 2000000005).
     * Сообщество должно быть добавлено в беседу.
     */
    adminPeerIds: (optional('VK_ADMIN_PEER_IDS') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
    apiVersion: optional('VK_API_VERSION') ?? '5.199',
    /** Вход через ВК доступен только когда заполнены оба ключа приложения. */
    get loginEnabled() {
      return Boolean(vkAppId && vkAppSecret);
    },
    /** Бот пишет клиентам только когда есть токен сообщества. */
    get botEnabled() {
      return Boolean(vkGroupToken && vkGroupId);
    },
  },

  telegram: {
    botToken: optional('TELEGRAM_BOT_TOKEN'),
    chatIds: (optional('TELEGRAM_CHAT_IDS') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  },

  /** За сколько часов до визита бот присылает напоминание. */
  reminderHoursBefore: number('REMINDER_HOURS_BEFORE', 3),
  /** Часовой пояс салона в минутах от UTC. Кызыл — UTC+7. */
  salonUtcOffsetMinutes: number('SALON_UTC_OFFSET_MINUTES', 7 * 60),
};

export type Env = typeof env;
