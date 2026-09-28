import { Router } from 'express';
import { loginClient, logoutClient } from '../auth';
import { db, type UserRow } from '../db';
import { env } from '../env';
import { MaxError, verifyInitData } from '../max';
import { toPublicUser } from '../views';
import { VkError, buildAuthorizeUrl, exchangeCode, isMessagingAllowed } from '../vk';

export const authRouter = Router();

/** Заводит или обновляет клиента по данным из ВК. */
function upsertUser(profile: {
  vkId: string;
  firstName: string;
  lastName: string;
  photo: string | null;
  phone: string | null;
}): UserRow {
  const existing = db.prepare('SELECT * FROM users WHERE vk_id = ?').get(profile.vkId) as UserRow | undefined;

  if (existing) {
    db.prepare(
      `UPDATE users
       SET first_name = ?, last_name = ?, photo = ?, phone = COALESCE(?, phone)
       WHERE id = ?`,
    ).run(profile.firstName, profile.lastName, profile.photo, profile.phone, existing.id);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id) as UserRow;
  }

  const result = db
    .prepare('INSERT INTO users (vk_id, first_name, last_name, photo, phone) VALUES (?, ?, ?, ?, ?)')
    .run(profile.vkId, profile.firstName, profile.lastName, profile.photo, profile.phone);

  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(result.lastInsertRowid)) as UserRow;
}

authRouter.get('/vk/start', (_req, res) => {
  if (!env.vk.loginEnabled) {
    res.status(503).json({ error: 'Вход через ВК ещё не настроен' });
    return;
  }
  try {
    res.redirect(buildAuthorizeUrl());
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

authRouter.get('/vk/callback', async (req, res) => {
  const { code, state, device_id: deviceId, error_description: errorDescription } = req.query;

  if (typeof errorDescription === 'string' && errorDescription) {
    res.redirect(`/?login=error&reason=${encodeURIComponent(errorDescription)}`);
    return;
  }
  if (typeof code !== 'string' || typeof state !== 'string') {
    res.redirect('/?login=error&reason=' + encodeURIComponent('ВК не передал код авторизации'));
    return;
  }

  try {
    const profile = await exchangeCode(code, state, typeof deviceId === 'string' ? deviceId : '');
    const user = upsertUser(profile);

    // Разрешение на сообщения проверяем сразу — от него зависит,
    // предлагать ли клиенту включить уведомления.
    if (env.vk.botEnabled) {
      const allowed = await isMessagingAllowed(profile.vkId);
      db.prepare('UPDATE users SET vk_messages_allowed = ? WHERE id = ?').run(allowed ? 1 : 0, user.id);
    }

    loginClient(res, user.id);
    res.redirect('/profile?login=ok');
  } catch (error) {
    const message = error instanceof VkError ? error.message : 'Не удалось войти через ВК';
    console.error('[auth] ошибка входа через ВК:', error);
    res.redirect(`/?login=error&reason=${encodeURIComponent(message)}`);
  }
});

/**
 * Вход из мини-приложения MAX: без кнопок и паролей, по подписанным данным
 * запуска. Клиент опознаётся по id MAX, телефон приложение попросит отдельно.
 */
authRouter.post('/max', (req, res) => {
  try {
    const profile = verifyInitData(String(req.body?.initData ?? ''));
    const existing = db.prepare('SELECT * FROM users WHERE max_id = ?').get(profile.maxId) as UserRow | undefined;

    let userId: number;
    if (existing) {
      db.prepare('UPDATE users SET first_name = ?, last_name = ?, photo = COALESCE(?, photo) WHERE id = ?').run(
        profile.firstName,
        profile.lastName,
        profile.photo,
        existing.id,
      );
      userId = existing.id;
    } else {
      const result = db
        .prepare('INSERT INTO users (max_id, first_name, last_name, photo) VALUES (?, ?, ?, ?)')
        .run(profile.maxId, profile.firstName, profile.lastName, profile.photo);
      userId = Number(result.lastInsertRowid);
    }

    loginClient(res, userId);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
    res.json({ user: toPublicUser(user) });
  } catch (error) {
    if (error instanceof MaxError) {
      res.status(401).json({ error: error.message });
      return;
    }
    console.error('[auth] ошибка входа из MAX:', error);
    res.status(500).json({ error: 'Не удалось войти из MAX' });
  }
});

authRouter.post('/logout', (req, res) => {
  logoutClient(req, res);
  res.json({ ok: true });
});
