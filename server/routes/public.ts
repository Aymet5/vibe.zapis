import { Router } from 'express';
import { MASTERS, SCHEDULE, findService, isCategoryId } from '../../shared/catalog';
import { BookingError, createBooking, getAvailability, toBookingView } from '../bookings';
import { env } from '../env';
import { publicMasters } from '../masters';
import { notifyNewBooking } from '../notify';
import { isValidDate, salonToday } from '../time';
import { communityChatUrl } from '../vk';
import { toPublicUser } from '../views';

export const publicRouter = Router();

/** Что умеет этот сервер — фронт по этому прячет неготовые кнопки. */
publicRouter.get('/config', (req, res) => {
  res.json({
    vkLoginEnabled: env.vk.loginEnabled,
    vkBotEnabled: env.vk.botEnabled,
    communityChatUrl: communityChatUrl(),
    adminEnabled: Boolean(env.adminPassword),
    today: salonToday(),
    horizonDays: SCHEDULE.bookingHorizonDays,
    masters: publicMasters(),
    user: req.user ? toPublicUser(req.user) : null,
  });
});

/** Длительность визита определяется услугой; без услуги показываем сетку под обычную стрижку. */
function resolveDuration(category: unknown, service: unknown): number {
  if (typeof category === 'string' && typeof service === 'string' && isCategoryId(category)) {
    const found = findService(category, service);
    if (found) return found.duration;
  }
  return SCHEDULE.stepMinutes;
}

/** Окошки одного мастера. */
publicRouter.get('/availability', (req, res) => {
  const date = String(req.query.date ?? '');
  const masterId = String(req.query.master ?? '');

  if (!isValidDate(date)) {
    res.status(400).json({ error: 'Некорректная дата' });
    return;
  }
  if (!MASTERS.some((m) => m.id === masterId)) {
    res.status(400).json({ error: 'Такого мастера нет' });
    return;
  }

  res.json(getAvailability(date, masterId, resolveDuration(req.query.category, req.query.service)));
});

/** Расписание всех мастеров на день — открытая витрина свободных окошек. */
publicRouter.get('/schedule', (req, res) => {
  const date = String(req.query.date ?? salonToday());
  if (!isValidDate(date)) {
    res.status(400).json({ error: 'Некорректная дата' });
    return;
  }

  const duration = resolveDuration(req.query.category, req.query.service);
  const category = typeof req.query.category === 'string' ? req.query.category : null;

  const masters = publicMasters()
    .filter((master) => !category || !isCategoryId(category) || master.categories.includes(category))
    .map((master) => ({
      master,
      ...getAvailability(date, master.id, duration),
    }));

  res.json({ date, durationMinutes: duration, masters });
});

publicRouter.post('/bookings', async (req, res) => {
  const body = req.body ?? {};

  try {
    const booking = createBooking({
      category: String(body.category ?? ''),
      service: String(body.service ?? ''),
      masterId: String(body.masterId ?? ''),
      date: String(body.date ?? ''),
      time: String(body.time ?? ''),
      clientName: String(body.clientName ?? ''),
      clientPhone: String(body.clientPhone ?? ''),
      discountPercent: Number(body.discountPercent ?? 0),
      user: req.user,
    });

    // Клиент не должен ждать сеть ВК и Telegram — отвечаем сразу.
    void notifyNewBooking(booking).catch((error) => {
      console.error('[notify] не удалось разослать уведомления о записи:', error);
    });

    res.status(201).json({ booking: toBookingView(booking) });
  } catch (error) {
    if (error instanceof BookingError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('[bookings] непредвиденная ошибка при создании записи:', error);
    res.status(500).json({ error: 'Не удалось создать запись, попробуйте ещё раз' });
  }
});
