import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireClient } from '../auth';
import {
  CashError,
  addEntry,
  allDebts,
  cancelPayment,
  confirmPayment,
  masterDebt,
  dayView,
  deleteEntry,
  dutyRange,
  finishShift,
  fillDutyRotation,
  setDuty,
  staffMasterViews,
  staffRole,
  updateStaffMaster,
  type StaffRole,
} from '../cashbook';
import { salonToday } from '../time';

/**
 * Касса для сотрудников в мини-приложении MAX. Вход тот же, что у клиента;
 * сотрудником делает телефон — администраторский или из карточки мастера.
 */
export const staffRouter = Router();

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: StaffRole;
    }
  }
}

staffRouter.use(requireClient);

staffRouter.use((req, res, next) => {
  const role = staffRole(req.user);
  if (!role) {
    res.status(403).json({ error: 'Касса доступна только сотрудникам' });
    return;
  }
  req.staff = role;
  next();
});

function requireStaffAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.staff?.isAdmin) {
    res.status(403).json({ error: 'Это может только администратор' });
    return;
  }
  next();
}

/** Ошибки кассы — понятным текстом, остальное — в общий обработчик. */
function handle(fn: (req: Request, res: Response) => Promise<void> | void) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof CashError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      next(error);
    }
  };
}

staffRouter.get(
  '/me',
  handle((req, res) => {
    res.json({ role: req.staff, today: salonToday() });
  }),
);

staffRouter.get(
  '/day',
  handle((req, res) => {
    const date = String(req.query.date ?? salonToday());
    // Прошлые дни целиком видит только администратор, мастер — свои.
    res.json({ day: dayView(req.staff!, date) });
  }),
);

staffRouter.post(
  '/entries',
  handle((req, res) => {
    const date = String(req.body?.date ?? salonToday());
    addEntry(req.staff!, req.user!.id, {
      date,
      masterId: String(req.body?.masterId ?? ''),
      service: String(req.body?.service ?? ''),
      price: Number(req.body?.price),
    });
    res.json({ day: dayView(req.staff!, date) });
  }),
);

staffRouter.delete(
  '/entries/:id',
  handle((req, res) => {
    deleteEntry(req.staff!, req.user!.id, Number(req.params.id));
    res.json({ day: dayView(req.staff!, String(req.query.date ?? salonToday())) });
  }),
);

staffRouter.post(
  '/day/:date/finish',
  handle(async (req, res) => {
    await finishShift(req.staff!, req.user!.id, req.params.date);
    res.json({ day: dayView(req.staff!, req.params.date) });
  }),
);

staffRouter.get(
  '/duty',
  handle((req, res) => {
    const from = String(req.query.from ?? salonToday());
    const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 62);
    res.json({ duty: dutyRange(from, days) });
  }),
);

staffRouter.put(
  '/duty/:date',
  requireStaffAdmin,
  handle(async (req, res) => {
    const masterId = req.body?.masterId ? String(req.body.masterId) : null;
    await setDuty(req.params.date, masterId, req.user!.id);
    res.json({ duty: dutyRange(String(req.query.from ?? salonToday()), 14) });
  }),
);

staffRouter.post(
  '/duty/rotation',
  requireStaffAdmin,
  handle(async (req, res) => {
    const from = String(req.body?.from ?? salonToday());
    const days = Math.min(Math.max(Number(req.body?.days) || 14, 1), 62);
    await fillDutyRotation(from, days, req.user!.id);
    res.json({ duty: dutyRange(from, 14) });
  }),
);

staffRouter.get(
  '/masters',
  handle((req, res) => {
    const masters = staffMasterViews();
    // Проценты и телефоны коллег мастеру знать незачем.
    res.json({
      masters: req.staff!.isAdmin
        ? masters
        : masters.map((master) => ({ ...master, percent: null, phone: null, linked: null, candidates: [] })),
    });
  }),
);

staffRouter.patch(
  '/masters/:id',
  requireStaffAdmin,
  handle((req, res) => {
    updateStaffMaster(req.params.id, {
      percent: req.body?.percent,
      phone: req.body?.phone,
      userId: req.body?.userId,
    });
    res.json({ masters: staffMasterViews() });
  }),
);

/** Долги: администратор видит всех, мастер — только свой. */
staffRouter.get(
  '/debts',
  handle((req, res) => {
    const role = req.staff!;
    res.json({ debts: role.isAdmin ? allDebts() : role.masterId ? [masterDebt(role.masterId)] : [] });
  }),
);

staffRouter.post(
  '/debts/:masterId/payments',
  requireStaffAdmin,
  handle(async (req, res) => {
    await confirmPayment(req.params.masterId, req.body?.amount, req.user!.id);
    res.json({ debts: allDebts() });
  }),
);

staffRouter.delete(
  '/payments/:id',
  requireStaffAdmin,
  handle((req, res) => {
    cancelPayment(Number(req.params.id));
    res.json({ debts: allDebts() });
  }),
);
