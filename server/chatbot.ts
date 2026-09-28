import { findMaster, minutesToTime } from '../shared/catalog';
import { db, getSetting, setSetting } from './db';
import { GigaChatError, gigachatComplete, gigachatKey, type ChatMessage } from './gigachat';
import { botInfo, maxToken, sendToMaxChat, showTyping } from './max';
import { enabledRecipients } from './recipients';
import { formatDateHuman, salonMinutesOfDay, salonToday } from './time';

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
} as const;

export interface ChatbotConfig {
  enabled: boolean;
  morning: boolean;
  /** Вероятность, что бот сам ответит на обычное сообщение. */
  chance: number;
}

export function chatbotConfig(): ChatbotConfig {
  const chance = Number(getSetting(CHATBOT_SETTINGS.chance));
  return {
    enabled: getSetting(CHATBOT_SETTINGS.enabled) === '1',
    morning: getSetting(CHATBOT_SETTINGS.morning) !== '0',
    chance: Number.isFinite(chance) && chance >= 0 && chance <= 1 ? chance : 0.15,
  };
}

export function saveChatbotConfig(config: Partial<ChatbotConfig>): void {
  if (config.enabled !== undefined) setSetting(CHATBOT_SETTINGS.enabled, config.enabled ? '1' : '0');
  if (config.morning !== undefined) setSetting(CHATBOT_SETTINGS.morning, config.morning ? '1' : '0');
  if (config.chance !== undefined) {
    setSetting(CHATBOT_SETTINGS.chance, String(Math.max(0, Math.min(1, config.chance))));
  }
}

/**
 * Тувинские фразы — только проверенные и только из этого списка. GigaChat
 * тувинского не знает и, если разрешить, сочиняет несуществующие слова,
 * поэтому модель пишет по-русски, а фразу мы подставляем сами.
 */
const TUVAN_PHRASES: { text: string; ru: string; at: 'start' | 'end' }[] = [
  { text: 'Экии!', ru: 'привет', at: 'start' },
  { text: 'Экии, эштер!', ru: 'привет, друзья', at: 'start' },
  { text: 'Амыр-менди!', ru: 'здравствуйте', at: 'start' },
  { text: 'Эки!', ru: 'хорошо', at: 'end' },
  { text: 'Кайгамчык!', ru: 'чудесно', at: 'end' },
  { text: 'Четтирдим!', ru: 'спасибо', at: 'end' },
];

/** Примерно каждое третье сообщение — с тувинской фразой. */
const TUVAN_SHARE = 0.3;

/** Буквы тувинского алфавита, которых нет в русском. */
const TUVAN_LETTERS = /[үөңҮӨҢ]/;

/**
 * Страховка: предложения с тувинскими буквами от модели выбрасываем,
 * затем с вероятностью TUVAN_SHARE добавляем фразу из списка.
 */
function finishText(raw: string, options: { greetingsOnly?: boolean } = {}): string {
  const sentences = raw.match(/[^.!?…]+[.!?…]*\s*/g) ?? [raw];
  const russian = sentences.filter((sentence) => !TUVAN_LETTERS.test(sentence)).join('').trim() || raw.trim();
  if (Math.random() >= TUVAN_SHARE) return russian;

  const pool = options.greetingsOnly ? TUVAN_PHRASES.filter((item) => item.at === 'start') : TUVAN_PHRASES;
  const phrase = pool[Math.floor(Math.random() * pool.length)];
  // Перевод не пишем — фраза звучит как живая речь, а не как разговорник.
  return phrase.at === 'start' ? `${phrase.text} ${russian}` : `${russian} ${phrase.text}`;
}

const PERSONA = [
  'Ты — «Вайб Салон», бот парикмахерской ВАЙБ в Кызыле (Тыва). Ты сидишь в рабочем чате мастеров.',
  'Характер: тёплый, весёлый, вдохновляющий, по-доброму шутишь про стрижки, клиентов и рабочий день.',
  'Пиши коротко: 1–3 предложения, живым разговорным языком, можно 1–2 эмодзи. Без markdown, списков и хэштегов.',
  'Не выдумывай факты о записях, клиентах и ценах. Не давай медицинских и финансовых советов.',
  'Не спорь и не критикуй мастеров, не обсуждай политику и религию.',
  'Пиши только по-русски.',
].join(' ');

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
  }

  const task = addressed
    ? 'К тебе обратились в чате — ответь на последнее сообщение по существу и по-дружески.'
    : 'Тебя не звали, но ты решил поддержать разговор: коротко и по-доброму отреагируй на последнее сообщение — подбодри, похвали или пошути.';

  // Пока GigaChat думает, в чате видно «печатает…» — ответ ощущается мгновенным.
  if (addressed) void showTyping(chatId);

  const reply = finishText(
    await gigachatComplete([
      { role: 'system', content: PERSONA },
      ...(history.get(chatId) ?? []),
      { role: 'user', content: task },
    ]),
  );

  remember(chatId, { role: 'assistant', content: reply });
  await sendToMaxChat(chatId, escapeHtml(reply), { replyTo: message.body?.mid });
}

/** Сводка дня для утреннего сообщения — только настоящие цифры из базы. */
function todaySummary(): string {
  const rows = db
    .prepare(
      `SELECT master_id, COUNT(*) AS count FROM bookings
       WHERE date = ? AND status IN ('confirmed', 'completed')
       GROUP BY master_id`,
    )
    .all(salonToday()) as { master_id: string; count: number }[];

  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) return 'Записей на сегодня пока нет — день свободный, клиенты ещё запишутся.';
  const perMaster = rows.map((row) => `${findMaster(row.master_id)?.name ?? row.master_id} — ${row.count}`).join(', ');
  return `Записей на сегодня: ${total} (${perMaster}).`;
}

/**
 * Вдохновляющее сообщение во все рабочие чаты: по расписанию утром или по
 * кнопке из админки в любое время. Возвращает текст, который отправили.
 */
export async function postMorningMessage(): Promise<string> {
  const text = finishText(
    await gigachatComplete([
      { role: 'system', content: PERSONA },
      {
        role: 'user',
        content: [
          `Сегодня ${formatDateHuman(salonToday())}, сейчас ${minutesToTime(salonMinutesOfDay())} по времени Кызыла. ${todaySummary()}`,
          'Напиши мастерам вдохновляющее сообщение, уместное для этого времени суток: утром — пожелай хорошего дня, днём — подбодри, вечером — поблагодари за день.',
          'Если есть записи — упомяни их число, как написано выше, ничего не добавляя.',
        ].join(' '),
      },
    ]),
    // Утром уместно только поздороваться.
    { greetingsOnly: true },
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
