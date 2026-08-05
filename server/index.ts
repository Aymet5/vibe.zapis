import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { attachSession } from './auth';
import { env } from './env';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { clientRouter } from './routes/client';
import { publicRouter } from './routes/public';
import { vkCallbackRouter } from './routes/vkCallback';
import { startScheduler } from './scheduler';

const app = express();

// За nginx нужен настоящий IP клиента — иначе лимит попыток пароля общий на всех.
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(attachSession);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/vk', vkCallbackRouter);
app.use('/api/admin', adminRouter);
app.use('/api/me', clientRouter);
app.use('/api', publicRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Метод не найден' });
});

// Фотографии мастеров лежат рядом с базой, а не в dist — их не сносит пересборка.
app.use('/uploads', express.static(env.uploadsPath, { maxAge: '7d', fallthrough: false }));

// Собранный фронтенд. В разработке фронт крутится на Vite и ходит сюда через прокси.
const distDir = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('*', (_req, res) => {
    res.status(503).send('Фронтенд не собран. Выполните: npm run build');
  });
}

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] необработанная ошибка:', error);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(env.port, () => {
  console.log(`[server] ВАЙБ запущен на порту ${env.port}`);
  console.log(`[server] публичный адрес: ${env.appUrl}`);
  console.log(`[server] вход через ВК: ${env.vk.loginEnabled ? 'включён' : 'не настроен'}`);
  console.log(`[server] бот ВК: ${env.vk.botEnabled ? 'включён' : 'не настроен'}`);
  console.log(`[server] панель администратора: ${env.adminPassword ? 'доступна на /admin' : 'пароль не задан'}`);
  startScheduler();
});
