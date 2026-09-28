import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isCategoryId, type CategoryId, type Master } from '../shared/catalog';
import type { PublicMaster } from '../shared/types';
import { db, type MasterProfileRow, type MasterRow } from './db';
import { env } from './env';
import { salonToday } from './time';

fs.mkdirSync(env.uploadsPath, { recursive: true });

/** Какие форматы принимаем от админки и с каким расширением сохраняем. */
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export class MasterError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function profiles(): Map<string, MasterProfileRow> {
  const rows = db.prepare('SELECT * FROM master_profiles').all() as MasterProfileRow[];
  return new Map(rows.map((row) => [row.master_id, row]));
}

export interface RosterMaster extends Master {
  /** false — мастер удалён: на сайте его нет, но в истории визитов имя остаётся. */
  active: boolean;
}

function toMaster(row: MasterRow): RosterMaster {
  let categories: CategoryId[] = [];
  try {
    categories = (JSON.parse(row.categories) as string[]).filter(isCategoryId);
  } catch {
    // Испорченный список — мастер просто не попадёт ни в одну категорию.
  }
  return { id: row.id, name: row.name, role: row.role, categories, active: Boolean(row.active) };
}

/** Мастер по id — в том числе удалённый, чтобы старые записи показывали имя. */
export function getMaster(masterId: string): RosterMaster | undefined {
  const row = db.prepare('SELECT * FROM masters WHERE id = ?').get(masterId) as MasterRow | undefined;
  return row ? toMaster(row) : undefined;
}

export function masterName(masterId: string): string {
  return getMaster(masterId)?.name ?? masterId;
}

/** Работающие мастера в порядке, заданном в админке. */
export function activeMasters(): RosterMaster[] {
  return (db.prepare('SELECT * FROM masters WHERE active = 1 ORDER BY sort, created_at').all() as MasterRow[]).map(
    toMaster,
  );
}

function requireActive(masterId: string): RosterMaster {
  const master = getMaster(masterId);
  if (!master?.active) throw new MasterError('Такого мастера нет', 404);
  return master;
}

/** Мастера для сайта: состав из базы плюс фотография, если её загрузили. */
export function publicMasters(): PublicMaster[] {
  const saved = profiles();
  return activeMasters().map(({ active: _active, ...master }) => ({
    ...master,
    photo: saved.get(master.id)?.photo ?? null,
  }));
}

/** Мастера для админки — с id ВКонтакте. Наружу его отдавать незачем. */
export function adminMasters(): (PublicMaster & { vkId: string | null })[] {
  const saved = profiles();
  return activeMasters().map(({ active: _active, ...master }) => ({
    ...master,
    photo: saved.get(master.id)?.photo ?? null,
    vkId: saved.get(master.id)?.vk_id ?? null,
  }));
}

/** Мастер, за которым закреплён этот аккаунт ВК. */
export function masterByVkId(vkId: string | null): Master | undefined {
  if (!vkId) return undefined;
  const row = db.prepare('SELECT master_id FROM master_profiles WHERE vk_id = ?').get(vkId) as
    | { master_id: string }
    | undefined;
  const master = row ? getMaster(row.master_id) : undefined;
  return master?.active ? master : undefined;
}

export interface MasterInput {
  name: string;
  role: string;
  categories: string[];
}

function cleanInput(input: MasterInput): { name: string; role: string; categories: CategoryId[] } {
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  const role = String(input.role ?? '').trim().replace(/\s+/g, ' ');
  const categories = [...new Set((Array.isArray(input.categories) ? input.categories : []).filter(isCategoryId))];
  if (name.length < 2) throw new MasterError('Укажите имя мастера');
  if (name.length > 40) throw new MasterError('Имя длиннее 40 символов');
  if (role.length > 40) throw new MasterError('Должность длиннее 40 символов');
  if (categories.length === 0) throw new MasterError('Отметьте, какие услуги делает мастер');
  return { name, role, categories };
}

export function createMaster(input: MasterInput): string {
  const data = cleanInput(input);
  const id = `m-${crypto.randomBytes(4).toString('hex')}`;
  const { next } = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM masters').get() as { next: number };
  db.prepare('INSERT INTO masters (id, name, role, categories, sort) VALUES (?, ?, ?, ?, ?)').run(
    id,
    data.name,
    data.role,
    JSON.stringify(data.categories),
    next,
  );
  return id;
}

/** Имя, должность и услуги. Старые записи сразу покажутся с новым именем. */
export function updateMaster(masterId: string, input: MasterInput): void {
  requireActive(masterId);
  const data = cleanInput(input);
  db.prepare('UPDATE masters SET name = ?, role = ?, categories = ? WHERE id = ?').run(
    data.name,
    data.role,
    JSON.stringify(data.categories),
    masterId,
  );
}

/**
 * Удаление: мастер пропадает с сайта и из записи, история визитов остаётся.
 * Пока к нему есть будущие записи, удалить нельзя — клиентов надо предупредить.
 */
export function deleteMaster(masterId: string): void {
  const master = requireActive(masterId);
  const { count } = db
    .prepare(
      `SELECT COUNT(*) AS count FROM bookings
       WHERE master_id = ? AND date >= ? AND status IN ('pending', 'confirmed')`,
    )
    .get(masterId, salonToday()) as { count: number };
  if (count > 0) {
    throw new MasterError(
      `У мастера ${master.name} ещё ${count} ${count === 1 ? 'будущая запись' : 'будущих записей'}. Перенесите или отмените их, потом удаляйте.`,
      409,
    );
  }
  db.prepare('UPDATE masters SET active = 0 WHERE id = ?').run(masterId);
  // Аккаунт ВК больше не открывает кабинет мастера.
  db.prepare('UPDATE master_profiles SET vk_id = NULL WHERE master_id = ?').run(masterId);
}

/** Поля, которых нет в patch, остаются как были. */
function upsert(
  masterId: string,
  patch: { vk_id?: string | null; photo?: string | null },
): void {
  requireActive(masterId);

  const current = db.prepare('SELECT * FROM master_profiles WHERE master_id = ?').get(masterId) as
    | MasterProfileRow
    | undefined;

  db.prepare(
    `INSERT INTO master_profiles (master_id, vk_id, photo, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (master_id) DO UPDATE SET
       vk_id = excluded.vk_id, photo = excluded.photo, updated_at = excluded.updated_at`,
  ).run(
    masterId,
    patch.vk_id === undefined ? (current?.vk_id ?? null) : patch.vk_id,
    patch.photo === undefined ? (current?.photo ?? null) : patch.photo,
  );
}


/** Привязка мастера к аккаунту ВК. Пустая строка снимает привязку. */
export function setMasterVkId(masterId: string, rawVkId: string): void {
  const vkId = rawVkId.trim();

  if (vkId) {
    if (!/^\d+$/.test(vkId)) {
      throw new MasterError('id ВКонтакте — это только цифры, например 123456789');
    }
    const taken = db.prepare('SELECT master_id FROM master_profiles WHERE vk_id = ? AND master_id != ?').get(
      vkId,
      masterId,
    ) as { master_id: string } | undefined;
    if (taken) {
      throw new MasterError(`Этот id ВКонтакте уже закреплён за мастером ${masterName(taken.master_id)}`);
    }
  }

  upsert(masterId, { vk_id: vkId || null });
}

/** Сохраняет присланную картинку и возвращает путь, по которому её отдаёт сервер. */
export function saveMasterPhoto(masterId: string, contentType: string, body: Buffer): string {
  const extension = ALLOWED_TYPES[contentType.split(';')[0].trim().toLowerCase()];
  if (!extension) throw new MasterError('Подойдёт JPG, PNG или WebP');
  if (!body?.length) throw new MasterError('Файл пустой');
  if (body.length > MAX_PHOTO_BYTES) throw new MasterError('Файл больше 5 МБ');
  requireActive(masterId);

  // Случайный суффикс в имени — чтобы браузер не показал старое фото из кэша.
  const fileName = `${masterId}-${crypto.randomBytes(4).toString('hex')}.${extension}`;
  fs.writeFileSync(path.join(env.uploadsPath, fileName), body);

  const previous = db.prepare('SELECT photo FROM master_profiles WHERE master_id = ?').get(masterId) as
    | { photo: string | null }
    | undefined;

  upsert(masterId, { photo: `/uploads/${fileName}` });
  removeFile(previous?.photo ?? null);

  return `/uploads/${fileName}`;
}

export function deleteMasterPhoto(masterId: string): void {
  const row = db.prepare('SELECT photo FROM master_profiles WHERE master_id = ?').get(masterId) as
    | { photo: string | null }
    | undefined;

  upsert(masterId, { photo: null });
  removeFile(row?.photo ?? null);
}

/** Удаляет файл, не выходя за каталог загрузок. */
function removeFile(publicPath: string | null): void {
  if (!publicPath?.startsWith('/uploads/')) return;
  const fileName = path.basename(publicPath);
  try {
    fs.rmSync(path.join(env.uploadsPath, fileName), { force: true });
  } catch (error) {
    console.warn('[masters] не удалось удалить старое фото:', (error as Error).message);
  }
}
