import { BONUS_PER_VISIT, MAX_BONUS_PERCENT, minutesToTime } from '../shared/catalog';
import { db, getSetting, setSetting } from './db';
import { GigaChatError, gigachatComplete, gigachatKey, type ChatMessage } from './gigachat';
import { activeMasters, masterName } from './masters';
import { botInfo, maxToken, sendToMaxChat, showTyping } from './max';
import { enabledRecipients } from './recipients';
import { addDays, formatDateHuman, salonMinutesOfDay, salonToday } from './time';

/**
 * «Вайб Салон» в рабочем чате мастеров: отвечает, когда к нему обращаются,
 * изредка сам подхватывает разговор и по утрам желает хорошего дня.
 * Тексты пишет GigaChat. Бот говорит только в групповых чатах MAX,
 * которые администратор включил для уведомлений.
 */

export const CHATBOT_SETTINGS = {
  enabled: 'chatbot_enabled',
  morning: 'chatbot_morning',
  chance: 'chatbot_chance',
  lastMorning: 'chatbot_last_morning',
  tuvanChance: 'chatbot_tuvan_chance',
  tuvanPhrases: 'chatbot_tuvan_phrases',
} as const;

export interface ChatbotConfig {
  enabled: boolean;
  morning: boolean;
  /** Вероятность, что бот сам ответит на обычное сообщение. */
  chance: number;
  /** Как часто бот вставляет тувинскую фразу или переходит на тувинский, 0..1. */
  tuvanChance: number;
  /** Тувинские фразы и шутки — пишут люди в админке, по одной в строке. */
  tuvanPhrases: string[];
}

export function chatbotConfig(): ChatbotConfig {
  const chance = Number(getSetting(CHATBOT_SETTINGS.chance));
  const tuvanChance = Number(getSetting(CHATBOT_SETTINGS.tuvanChance));
  const phrases = getSetting(CHATBOT_SETTINGS.tuvanPhrases);
  return {
    enabled: getSetting(CHATBOT_SETTINGS.enabled) === '1',
    morning: getSetting(CHATBOT_SETTINGS.morning) !== '0',
    chance: Number.isFinite(chance) && chance >= 0 && chance <= 1 ? chance : 0.15,
    tuvanChance: Number.isFinite(tuvanChance) && tuvanChance >= 0 && tuvanChance <= 1 ? tuvanChance : 0.2,
    tuvanPhrases: phrases === undefined ? DEFAULT_TUVAN_PHRASES : splitPhrases(phrases),
  };
}

export function saveChatbotConfig(config: Partial<ChatbotConfig>): void {
  if (config.enabled !== undefined) setSetting(CHATBOT_SETTINGS.enabled, config.enabled ? '1' : '0');
  if (config.morning !== undefined) setSetting(CHATBOT_SETTINGS.morning, config.morning ? '1' : '0');
  if (config.chance !== undefined) {
    setSetting(CHATBOT_SETTINGS.chance, String(Math.max(0, Math.min(1, config.chance))));
  }
  if (config.tuvanChance !== undefined) {
    setSetting(CHATBOT_SETTINGS.tuvanChance, String(Math.max(0, Math.min(1, config.tuvanChance))));
  }
  if (config.tuvanPhrases !== undefined) {
    // Пустой список храним явно — иначе вернулись бы фразы по умолчанию.
    setSetting(CHATBOT_SETTINGS.tuvanPhrases, config.tuvanPhrases.join('\n') || ' ');
  }
}

function splitPhrases(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 200)
    .map((line) => line.slice(0, 300));
}

/**
 * Тувинский бот берёт только из списка, который пишут люди в админке.
 * GigaChat тувинского не знает и сочиняет несуществующие слова, поэтому
 * модель пишет по-русски, а тувинское подставляем мы.
 */
export const DEFAULT_TUVAN_PHRASES = ['Экии, эштер!', 'Амыр-менди!', 'Эки!', 'Кайгамчык!', 'Четтирдим!'];

/** Буквы тувинского алфавита, которых нет в русском. */
const TUVAN_LETTERS = /[үөңҮӨҢ]/;

/** Страховка: предложения с тувинскими буквами от модели выбрасываем. */
function russianOnly(raw: string): string {
  const sentences = raw.match(/[^.!?…]+[.!?…]*\s*/g) ?? [raw];
  return sentences.filter((sentence) => !TUVAN_LETTERS.test(sentence)).join('').trim() || raw.trim();
}

function randomTuvan(config: ChatbotConfig): string | null {
  if (config.tuvanPhrases.length === 0) return null;
  return config.tuvanPhrases[Math.floor(Math.random() * config.tuvanPhrases.length)];
}

/** Иногда дописываем к русскому ответу тувинскую фразу из списка. */
function maybeWithTuvan(russian: string, config: ChatbotConfig): string {
  if (Math.random() >= config.tuvanChance) return russian;
  const phrase = randomTuvan(config);
  return phrase ? `${russian} ${phrase}` : russian;
}

const PERSONA = [
  'Ты — «Вайб Салон», бот в рабочем чате мастеров парикмахерской ВАЙБ в Кызыле.',
  'Отвечай по делу и по контексту переписки, как толковый коллега: коротко, конкретно, 1–3 предложения.',
  'Без сюсюканья, комплиментов, пафоса и обращений вроде «красавчики», «волшебники», «команда мечты».',
  'Юмор — сухой и к месту, не в каждом сообщении. Эмодзи — максимум один и только если уместно.',
  'Факты о салоне бери только из блока «Факты». Если нужных данных там нет — прямо скажи, что не знаешь.',
  'Не выдумывай записи, клиентов и цены. Не обсуждай политику и религию. Без markdown и списков.',
  'Пиши только по-русски.',
].join(' ');

function daySummary(date: string): string {
  const rows = db
    .prepare(
      `SELECT master_id, COUNT(*) AS count FROM bookings
       WHERE date = ? AND status IN ('confirmed', 'completed')
       GROUP BY master_id`,
    )
    .all(date) as { master_id: string; count: number }[];
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) return 'записей нет';
  return `${total} (${rows.map((row) => `${masterName(row.master_id)} — ${row.count}`).join(', ')})`;
}

/** Настоящие данные салона — чтобы на вопросы по делу бот отвечал цифрами, а не общими словами. */
function salonFacts(): string {
  const today = salonToday();
  const tomorrow = addDays(today, 1);
  const masters = activeMasters()
    .map((master) => (master.role ? `${master.name} (${master.role})` : master.name))
    .join(', ');
  return [
    `Факты. Сейчас ${formatDateHuman(today)}, ${minutesToTime(salonMinutesOfDay())} по времени Кызыла.`,
    `Записей сегодня: ${daySummary(today)}. Завтра: ${daySummary(tomorrow)}.`,
    `Мастера: ${masters}.`,
    'Салон работает ежедневно 09:00–19:00, ТД «5 Звёзд», 1 этаж. Онлайн-запись: vibe-cut.ru и мини-приложение в MAX.',
    `Скидка клиентам: ${BONUS_PER_VISIT}% за визит, до ${MAX_BONUS_PERCENT}%.`,
  ].join(' ');
}

/** Короткая память разговора в каждом чате — чтобы бот отвечал в тему. */
const HISTORY_LIMIT = 12;
const history = new Map<string, ChatMessage[]>();

function remember(chatId: string, message: ChatMessage): void {
  const list = history.get(chatId) ?? [];
  list.push(message);
  history.set(chatId, list.slice(-HISTORY_LIMIT));
}

/** Сам, без обращения, бот вступает не чаще раза в 20 минут в одном чате. */
const RANDOM_COOLDOWN_MS = 20 * 60 * 1000;
const lastRandomReply = new Map<string, number>();

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function senderName(sender: any): string {
  return [sender?.first_name, sender?.last_name].filter(Boolean).join(' ') || sender?.name || 'Мастер';
}

function isStaffChat(chatId: string): boolean {
  return enabledRecipients('max').some((row) => row.kind === 'chat' && row.target === chatId);
}

interface BotIdentity {
  userId: string | null;
  username: string | null;
  name: string | null;
}

let botIdentity: (BotIdentity & { token: string }) | null = null;

async function identity(): Promise<BotIdentity> {
  const token = maxToken();
  if (!token) return { userId: null, username: null, name: null };
  if (botIdentity?.token !== token) {
    const info = await botInfo(token);
    botIdentity = { token, userId: info.userId, username: info.username, name: info.name };
  }
  return botIdentity;
}

/**
 * Обратились ли к боту. Упоминание через @ MAX присылает разметкой
 * (markup: user_mention с user_id), а в тексте остаётся имя «Вайб Салон».
 */
function isAddressed(message: any, text: string, me: BotIdentity): boolean {
  const lower = text.toLowerCase();

  const repliedToBot =
    message.link?.type === 'reply' && me.userId !== null && String(message.link?.sender?.user_id) === me.userId;
  const markupMention = (Array.isArray(message.body?.markup) ? message.body.markup : []).some(
    (item: any) =>
      item?.type === 'user_mention' &&
      ((me.userId !== null && String(item.user_id) === me.userId) ||
        (me.username !== null && String(item.user_link ?? '').toLowerCase() === `@${me.username.toLowerCase()}`)),
  );
  const usernameMention = me.username !== null && lower.includes(`@${me.username.toLowerCase()}`);
  const nameMention = me.name !== null && lower.includes(me.name.toLowerCase());
  const botWord = /(^|[^а-яё])бот([^а-яё]|$)/i.test(text);

  return repliedToBot || markupMention || usernameMention || nameMention || botWord;
}

/** Сообщение из группового чата MAX. Ошибки не мешают остальной работе бота. */
export async function onGroupMessage(chatId: string, message: any): Promise<void> {
  const config = chatbotConfig();
  if (!config.enabled || !gigachatKey() || !isStaffChat(chatId)) return;

  const text = String(message.body?.text ?? '').trim();
  if (!text) return;

  const me = await identity();
  remember(chatId, { role: 'user', content: `${senderName(message.sender)}: ${text}` });

  const addressed = isAddressed(message, text, me);
  console.info(`[chatbot] сообщение в чате ${chatId}: ${addressed ? 'обращаются к боту' : 'обычное'}`);

  if (!addressed) {
    const last = lastRandomReply.get(chatId) ?? 0;
    if (Date.now() - last < RANDOM_COOLDOWN_MS || Math.random() >= config.chance) return;
    lastRandomReply.set(chatId, Date.now());

    // Иногда вместо реплики бот «переходит на тувинский» — шутка из списка, чтобы поднять настроение.
    const tuvan = Math.random() < config.tuvanChance ? randomTuvan(config) : null;
    if (tuvan) {
      remember(chatId, { role: 'assistant', content: tuvan });
      await sendToMaxChat(chatId, escapeHtml(tuvan), { replyTo: message.body?.mid });
      return;
    }
  }

  const task = addressed
    ? 'К тебе обратились. Ответь на последнее обращённое к тебе сообщение по существу, с учётом переписки и фактов.'
    : 'Тебя не звали. Вставь одну короткую уместную реплику по теме последнего сообщения — дельную или с лёгкой шуткой, без похвалы и пожеланий.';

  // Пока GigaChat думает, в чате видно «печатает…» — ответ ощущается мгновенным.
  if (addressed) void showTyping(chatId);

  const reply = maybeWithTuvan(
    russianOnly(
      await gigachatComplete([
        { role: 'system', content: `${PERSONA}\n${salonFacts()}` },
        ...(history.get(chatId) ?? []),
        { role: 'user', content: task },
      ]),
    ),
    config,
  );

  remember(chatId, { role: 'assistant', content: reply });
  await sendToMaxChat(chatId, escapeHtml(reply), { replyTo: message.body?.mid });
}

/**
 * Вдохновляющее сообщение во все рабочие чаты: по расписанию утром или по
 * кнопке из админки в любое время. Возвращает текст, который отправили.
 */
export async function postMorningMessage(): Promise<string> {
  const text = maybeWithTuvan(
    russianOnly(
      await gigachatComplete([
        { role: 'system', content: `${PERSONA}\n${salonFacts()}` },
        {
          role: 'user',
          content:
            'Напиши в чат короткое сообщение, уместное для этого времени суток: сколько записей сегодня (по фактам, по мастерам) и одна бодрая фраза на день. Без пафоса.',
        },
      ]),
    ),
    chatbotConfig(),
  );

  const chats = enabledRecipients('max').filter((row) => row.kind === 'chat');
  await Promise.all(chats.map((row) => sendToMaxChat(row.target, escapeHtml(text))));
  chats.forEach((row) => remember(row.target, { role: 'assistant', content: text }));
  return text;
}

/** Окно утреннего сообщения: с 8:30 до 9:30 по времени салона, раз в день. */
const MORNING_FROM = 8 * 60 + 30;
const MORNING_TO = 9 * 60 + 30;

export async function maybePostMorning(): Promise<void> {
  const config = chatbotConfig();
  if (!config.enabled || !config.morning || !gigachatKey() || !maxToken()) return;

  const minutes = salonMinutesOfDay();
  const today = salonToday();
  if (minutes < MORNING_FROM || minutes > MORNING_TO) return;
  if (getSetting(CHATBOT_SETTINGS.lastMorning) === today) return;

  // Отмечаем заранее: если GigaChat упадёт, лучше пропустить утро, чем слать сообщение каждые 5 минут.
  setSetting(CHATBOT_SETTINGS.lastMorning, today);
  try {
    await postMorningMessage();
  } catch (error) {
    console.warn('[chatbot] утреннее сообщение не отправлено:', (error as Error).message);
  }
}

export { GigaChatError };
