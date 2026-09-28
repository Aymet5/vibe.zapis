import { db, type NotifyChannel, type NotifyRecipientRow } from './db';

/** peer_id бесед ВК начинаются с 2000000000, всё что меньше — личка человека. */
const VK_CHAT_PEER_OFFSET = 2_000_000_000;

export class RecipientError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function listRecipients(): NotifyRecipientRow[] {
  return db
    .prepare('SELECT * FROM notify_recipients ORDER BY channel, enabled DESC, created_at')
    .all() as NotifyRecipientRow[];
}

export function enabledRecipients(channel: NotifyChannel): NotifyRecipientRow[] {
  return db
    .prepare('SELECT * FROM notify_recipients WHERE channel = ? AND enabled = 1')
    .all(channel) as NotifyRecipientRow[];
}

export function findRecipient(channel: NotifyChannel, target: string): NotifyRecipientRow | undefined {
  return db
    .prepare('SELECT * FROM notify_recipients WHERE channel = ? AND target = ?')
    .get(channel, target) as NotifyRecipientRow | undefined;
}

/**
 * Запоминает чат или человека. Уже известного получателя не трогаем, кроме
 * названия: включён он или нет — решает только администратор.
 */
export function rememberRecipient(input: {
  channel: NotifyChannel;
  target: string;
  kind: 'person' | 'chat';
  title: string;
  enabled?: boolean;
}): NotifyRecipientRow {
  db.prepare(
    `INSERT INTO notify_recipients (channel, target, kind, title, enabled)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(channel, target) DO UPDATE SET
       title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE notify_recipients.title END`,
  ).run(input.channel, input.target, input.kind, input.title, input.enabled ? 1 : 0);
  return findRecipient(input.channel, input.target)!;
}

/** Получатель ВК, которого администратор добавил вручную, сразу включён. */
export function addVkRecipient(rawTarget: string, title: string): NotifyRecipientRow {
  const target = rawTarget.trim().replace(/^https?:\/\/(m\.)?vk\.com\/id/i, '');
  if (!/^\d{1,12}$/.test(target)) {
    throw new RecipientError('Укажите числовой id ВКонтакте или peer_id беседы');
  }
  const kind = Number(target) >= VK_CHAT_PEER_OFFSET ? 'chat' : 'person';
  const fallback = kind === 'chat' ? `Беседа ${Number(target) - VK_CHAT_PEER_OFFSET}` : `vk.com/id${target}`;
  const row = rememberRecipient({ channel: 'vk', target, kind, title: title.trim() || fallback, enabled: true });
  if (!row.enabled) setRecipientEnabled(row.id, true);
  return findRecipient('vk', target)!;
}

export function setRecipientEnabled(id: number, enabled: boolean): void {
  const result = db.prepare('UPDATE notify_recipients SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  if (result.changes === 0) throw new RecipientError('Получатель не найден', 404);
}

export function removeRecipient(id: number): void {
  db.prepare('DELETE FROM notify_recipients WHERE id = ?').run(id);
}

export function forgetRecipient(channel: NotifyChannel, target: string): void {
  db.prepare('DELETE FROM notify_recipients WHERE channel = ? AND target = ?').run(channel, target);
}
