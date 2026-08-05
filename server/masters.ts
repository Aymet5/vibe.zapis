import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MASTERS, findMaster, type Master } from '../shared/catalog';
import type { PublicMaster } from '../shared/types';
import { db, type MasterProfileRow } from './db';
import { env } from './env';

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

/** Мастера для сайта: состав из каталога плюс фотография, если её загрузили. */
export function publicMasters(): PublicMaster[] {
  const saved = profiles();
  return MASTERS.map((master) => ({
    ...master,
    photo: saved.get(master.id)?.photo ?? null,
  }));
}

/** Мастера для админки — с id ВКонтакте. Наружу его отдавать незачем. */
export function adminMasters(): (PublicMaster & { vkId: string | null })[] {
  const saved = profiles();
  return MASTERS.map((master) => ({
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
  return row ? findMaster(row.master_id) : undefined;
}

/** Поля, которых нет в patch, остаются как были. */
function upsert(masterId: string, patch: { vk_id?: string | null; photo?: string | null }): void {
  if (!findMaster(masterId)) throw new MasterError('Такого мастера нет', 404);

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
      throw new MasterError(`Этот id ВКонтакте уже закреплён за мастером ${findMaster(taken.master_id)?.name ?? taken.master_id}`);
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
  if (!findMaster(masterId)) throw new MasterError('Такого мастера нет', 404);

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
