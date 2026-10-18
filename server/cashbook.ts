import { db, getSetting, type UserRow } from './db';
import { env } from './env';
import { activeMasters, getMaster, masterName } from './masters';
import { miniAppLink, sendToMaxChat, sendToMaxUser, maxToken } from './max';
import { enabledRecipients } from './recipients';
import { addDays, formatDateHuman, isValidDate, salonMinutesOfDay, salonToday } from './time';

/**
 * Касса дня вместо тетради. Дежурный мастер и администраторы вносят каждого
 * клиента: мастер, услуга, цена. Администраторы видят итог в любой момент,
 * а в конце дня бот сам присылает его:
 * администраторам — кто сколько должен, мастерам — сколько заработали и сколько отдать.
 *
 * Сотрудников узнаём по телефону, который MAX передал в мини-приложение:
 * администраторы — номера из STAFF_ADMIN_PHONES, мастер — номер в его карточке.
 */

db.exec(`
  /* Кто дежурит в какой день. Дежурный ведёт кассу этого дня. */
  CREATE TABLE IF NOT EXISTS duty_days (
    date TEXT PRIMARY KEY,
    master_id TEXT NOT NULL,
    assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    morning_sent_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  /* Каждый обслуженный клиент. Удалённая строка остаётся с deleted_at — для порядка. */
  CREATE TABLE IF NOT EXISTS cash_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    master_id TEXT NOT NULL,
    service TEXT NOT NULL,
    price INTEGER NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_cash_date ON cash_entries (date, master_id);

  /* Итог дня, который бот разослал в конце дня, — каким он ушёл в сообщениях. */
  CREATE TABLE IF NOT EXISTS cash_days (
    date TEXT PRIMARY KEY,
    closed_at TEXT,
    closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    report TEXT NOT NULL
  );
`);

// Процент, который мастер отдаёт салону, и телефон, по которому он входит в MAX.
const masterColumns = db.prepare('PRAGMA table_info(masters)').all() as { name: string }[];
if (!masterColumns.some((column) => column.name === 'percent')) {
  db.exec('ALTER TABLE masters ADD COLUMN percent INTEGER');
}
if (!masterColumns.some((column) => column.name === 'phone')) {
  db.exec('ALTER TABLE masters ADD COLUMN phone TEXT');
}

export class CashError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Последние 10 цифр: «+7 (999) 179-28-95», «89991792895» и «79991792895» — один номер. */
export function phoneKey(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function adminPhoneKeys(): string[] {
  return env.staffAdminPhones.map(phoneKey).filter((key): key is string => Boolean(key));
}

interface StaffMasterRow {
  id: string;
  name: string;
  percent: number | null;
  phone: string | null;
}

function staffMasters(): StaffMasterRow[] {
  const ids = new Set(activeMasters().map((master) => master.id));
  return (db.prepare('SELECT id, name, percent, phone FROM masters ORDER BY sort, created_at').all() as StaffMasterRow[])
    .filter((row) => ids.has(row.id));
}

export interface StaffRole {
  isAdmin: boolean;
  /** Мастер, за которым закреплён телефон пользователя. */
  masterId: string | null;
  masterName: string | null;
}

export function staffRole(user: UserRow | undefined): StaffRole | null {
  const key = phoneKey(user?.phone);
  if (!key) return null;
  const isAdmin = adminPhoneKeys().includes(key);
  const master = staffMasters().find((row) => phoneKey(row.phone) === key);
  if (!isAdmin && !master) return null;
  return { isAdmin, masterId: master?.id ?? null, masterName: master?.name ?? null };
}

/** Пользователи MAX с этим телефоном — им бот и пишет. */
function maxUsersByPhone(phone: string | null): UserRow[] {
  const key = phoneKey(phone);
  if (!key) return [];
  return (db.prepare('SELECT * FROM users WHERE max_id IS NOT NULL AND phone IS NOT NULL').all() as UserRow[]).filter(
    (user) => phoneKey(user.phone) === key,
  );
}

function adminMaxUsers(): UserRow[] {
  const keys = adminPhoneKeys();
  return (db.prepare('SELECT * FROM users WHERE max_id IS NOT NULL AND phone IS NOT NULL').all() as UserRow[]).filter(
    (user) => keys.includes(phoneKey(user.phone) ?? ''),
  );
}

async function sendToPeople(users: UserRow[], text: string): Promise<number> {
  if (!maxToken() || users.length === 0) return 0;
  const link = await miniAppLink('cash');
  const buttons = link ? [{ label: 'Открыть кассу', link }] : [];
  const results = await Promise.all(users.map((user) => sendToMaxUser(user.max_id!, text, buttons)));
  return results.filter(Boolean).length;
}

async function sendToMaster(masterId: string, text: string): Promise<number> {
  const master = staffMasters().find((row) => row.id === masterId);
  return sendToPeople(maxUsersByPhone(master?.phone ?? null), text);
}

function rub(amount: number): string {
  return `${amount.toLocaleString('ru-RU').replace(/ /g, ' ')} ₽`;
}

// ─── Дежурства ───

export interface DutyView {
  date: string;
  masterId: string | null;
  masterName: string | null;
}

export function dutyFor(date: string): DutyView {
  const row = db.prepare('SELECT master_id FROM duty_days WHERE date = ?').get(date) as
    | { master_id: string }
    | undefined;
  return { date, masterId: row?.master_id ?? null, masterName: row ? masterName(row.master_id) : null };
}

export function dutyRange(from: string, days: number): DutyView[] {
  return Array.from({ length: days }, (_, index) => dutyFor(addDays(from, index)));
}

function assertDate(date: string): void {
  if (!isValidDate(date)) throw new CashError('Некорректная дата');
}

/** Назначает дежурного. Мастер сразу получает сообщение, если день ещё не прошёл. */
export async function setDuty(date: string, masterId: string | null, byUserId: number): Promise<void> {
  assertDate(date);
  const previous = dutyFor(date).masterId;
  if (!masterId) {
    db.prepare('DELETE FROM duty_days WHERE date = ?').run(date);
    return;
  }
  if (!getMaster(masterId)?.active) throw new CashError('Такого мастера нет', 404);
  if (previous === masterId) return;

  db.prepare(
    `INSERT INTO duty_days (date, master_id, assigned_by) VALUES (?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET master_id = excluded.master_id, assigned_by = excluded.assigned_by,
       morning_sent_at = NULL, updated_at = datetime('now')`,
  ).run(date, masterId, byUserId);

  if (date >= salonToday()) {
    const when = date === salonToday() ? `сегодня, ${formatDateHuman(date)}` : formatDateHuman(date);
    void sendToMaster(
      masterId,
      `Вы дежурный ${when}. Следите за порядком и записывайте в кассу каждого клиента — мастер, стрижка, цена.`,
    ).catch((error) => console.warn('[cash] не удалось сообщить о дежурстве:', (error as Error).message));
  }
}

/**
 * Очередь: мастера по кругу в порядке из админки, начиная со следующего после
 * последнего дежурного. Уже назначенные дни не трогаем.
 */
export async function fillDutyRotation(from: string, days: number, byUserId: number): Promise<void> {
  assertDate(from);
  const order = staffMasters().map((row) => row.id);
  if (order.length === 0) throw new CashError('Нет мастеров для очереди');

  const last = db
    .prepare('SELECT master_id FROM duty_days WHERE date < ? ORDER BY date DESC LIMIT 1')
    .get(from) as { master_id: string } | undefined;
  let next = last ? (order.indexOf(last.master_id) + 1) % order.length : 0;

  for (let index = 0; index < days; index += 1) {
    const date = addDays(from, index);
    const current = dutyFor(date).masterId;
    if (current && order.includes(current)) {
      next = (order.indexOf(current) + 1) % order.length;
      continue;
    }
    await setDuty(date, order[next], byUserId);
    next = (next + 1) % order.length;
  }
}

// ─── Записи кассы ───

interface CashEntryRow {
  id: number;
  date: string;
  master_id: string;
  service: string;
  price: number;
  created_by: number | null;
  created_at: string;
}

export interface CashEntryView {
  id: number;
  masterId: string;
  masterName: string;
  service: string;
  price: number;
  /** Кто внёс — имя из MAX. */
  author: string;
  /** Время по салону, «14:05». */
  time: string;
}

export interface MasterTotal {
  masterId: string;
  masterName: string;
  clients: number;
  revenue: number;
  /** null — мастер не на процентах. */
  percent: number | null;
  /** Сколько отдать администратору. */
  owed: number;
  /** Сколько остаётся мастеру. */
  earned: number;
}

export interface DayReport {
  date: string;
  dutyMasterName: string | null;
  masters: MasterTotal[];
  clients: number;
  revenue: number;
  owed: number;
}

function salonTime(utc: string): string {
  const instant = new Date(`${utc.replace(' ', 'T')}Z`);
  const minutes = salonMinutesOfDay(instant);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function entries(date: string): CashEntryRow[] {
  return db
    .prepare('SELECT * FROM cash_entries WHERE date = ? AND deleted_at IS NULL ORDER BY id')
    .all(date) as CashEntryRow[];
}

function authorName(userId: number | null): string {
  if (!userId) return '—';
  const user = db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(userId) as
    | { first_name: string; last_name: string }
    | undefined;
  return user ? `${user.first_name} ${user.last_name}`.trim() || '—' : '—';
}

function toEntryView(row: CashEntryRow): CashEntryView {
  return {
    id: row.id,
    masterId: row.master_id,
    masterName: masterName(row.master_id),
    service: row.service,
    price: row.price,
    author: authorName(row.created_by),
    time: salonTime(row.created_at),
  };
}

/** Итог дня по текущим процентам мастеров. */
export function buildReport(date: string): DayReport {
  const percents = new Map(
    (db.prepare('SELECT id, percent FROM masters').all() as { id: string; percent: number | null }[]).map((row) => [
      row.id,
      row.percent,
    ]),
  );
  const byMaster = new Map<string, MasterTotal>();
  for (const row of entries(date)) {
    const total =
      byMaster.get(row.master_id) ??
      ({
        masterId: row.master_id,
        masterName: masterName(row.master_id),
        clients: 0,
        revenue: 0,
        percent: percents.get(row.master_id) ?? null,
        owed: 0,
        earned: 0,
      } satisfies MasterTotal);
    total.clients += 1;
    total.revenue += row.price;
    byMaster.set(row.master_id, total);
  }
  const masters = [...byMaster.values()].map((total) => {
    // Копейки округляем в пользу мастера.
    const owed = total.percent ? Math.floor((total.revenue * total.percent) / 100) : 0;
    return { ...total, owed, earned: total.revenue - owed };
  });
  masters.sort((a, b) => b.revenue - a.revenue);
  return {
    date,
    dutyMasterName: dutyFor(date).masterName,
    masters,
    clients: masters.reduce((sum, item) => sum + item.clients, 0),
    revenue: masters.reduce((sum, item) => sum + item.revenue, 0),
    owed: masters.reduce((sum, item) => sum + item.owed, 0),
  };
}

/** Когда бот разослал итог дня, null — ещё не рассылал. */
function reportSentAt(date: string): string | null {
  const row = db.prepare('SELECT closed_at FROM cash_days WHERE date = ? AND closed_at IS NOT NULL').get(date) as
    | { closed_at: string }
    | undefined;
  return row?.closed_at ?? null;
}

/** Дежурный ведёт кассу этого дня — ему видны все клиенты, а не только свои. */
function isDutyOf(role: StaffRole, date: string): boolean {
  return Boolean(role.masterId) && dutyFor(date).masterId === role.masterId;
}

/**
 * Администратор правит кассу любого дня. Дежурный — только сегодня и пока
 * итог не разослан: иначе мастера получили бы одни цифры, а в кассе были бы другие.
 */
function canWrite(role: StaffRole, date: string): boolean {
  if (role.isAdmin) return true;
  return date === salonToday() && isDutyOf(role, date) && !reportSentAt(date);
}

function writeDenied(role: StaffRole, date: string): string {
  if (isDutyOf(role, date) && reportSentAt(date)) return 'Итог дня уже отправлен — исправить может администратор';
  return 'Записывать может дежурный сегодня или администратор';
}

export interface DayView {
  date: string;
  duty: DutyView;
  /** Время по салону, когда бот разослал итог, «20:30»; null — ещё не рассылал. */
  reportSentAt: string | null;
  canWrite: boolean;
  /** Мастеру, который не дежурит, видны только его клиенты. */
  entries: CashEntryView[];
  report: DayReport;
}

export function dayView(role: StaffRole, date: string): DayView {
  assertDate(date);
  const sentAt = reportSentAt(date);
  const seesAll = role.isAdmin || isDutyOf(role, date);
  // Итог всегда по текущим записям: администратор видит его в любой момент.
  const report = buildReport(date);
  return {
    date,
    duty: dutyFor(date),
    reportSentAt: sentAt ? salonTime(sentAt) : null,
    canWrite: canWrite(role, date),
    entries: entries(date)
      .filter((row) => seesAll || row.master_id === role.masterId)
      .map(toEntryView)
      .reverse(),
    report: seesAll ? report : { ...report, masters: report.masters.filter((item) => item.masterId === role.masterId) },
  };
}

export function addEntry(
  role: StaffRole,
  userId: number,
  input: { date: string; masterId: string; service: string; price: number },
): void {
  assertDate(input.date);
  if (!canWrite(role, input.date)) throw new CashError(writeDenied(role, input.date), 403);
  if (!getMaster(input.masterId)?.active) throw new CashError('Выберите мастера');
  const service = String(input.service ?? '').trim().replace(/\s+/g, ' ');
  if (!service) throw new CashError('Укажите услугу');
  if (service.length > 60) throw new CashError('Название услуги длиннее 60 символов');
  const price = Math.round(Number(input.price));
  if (!Number.isFinite(price) || price <= 0) throw new CashError('Укажите цену');
  if (price > 100_000) throw new CashError('Слишком большая цена — проверьте');

  db.prepare('INSERT INTO cash_entries (date, master_id, service, price, created_by) VALUES (?, ?, ?, ?, ?)').run(
    input.date,
    input.masterId,
    service,
    price,
    userId,
  );
}

export function deleteEntry(role: StaffRole, userId: number, id: number): void {
  const row = db.prepare('SELECT * FROM cash_entries WHERE id = ? AND deleted_at IS NULL').get(id) as
    | CashEntryRow
    | undefined;
  if (!row) throw new CashError('Запись не найдена', 404);
  if (!canWrite(role, row.date)) throw new CashError(writeDenied(role, row.date), 403);
  db.prepare(`UPDATE cash_entries SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?`).run(userId, id);
}

// ─── Итог дня ───

function adminReportText(report: DayReport): string {
  const lines = [`Касса за ${formatDateHuman(report.date)}`];
  if (report.dutyMasterName) lines.push(`Дежурный: ${report.dutyMasterName}`);
  lines.push('');
  if (report.masters.length === 0) {
    lines.push('Клиентов не записано.');
  } else {
    for (const item of report.masters) {
      lines.push(
        item.percent
          ? `${item.masterName}: ${item.clients} кл., ${rub(item.revenue)} → должен ${rub(item.owed)} (${item.percent}%)`
          : `${item.masterName}: ${item.clients} кл., ${rub(item.revenue)} (не на процентах)`,
      );
    }
    lines.push('', `Всего: ${report.clients} кл., ${rub(report.revenue)}`, `К сдаче администратору: ${rub(report.owed)}`);
  }
  return lines.join('\n');
}

function masterReportText(report: DayReport, item: MasterTotal): string {
  const lines = [
    `Итог за ${formatDateHuman(report.date)}`,
    `Клиентов: ${item.clients}, выручка ${rub(item.revenue)}.`,
  ];
  if (item.percent) {
    lines.push(`Вы заработали ${rub(item.earned)}.`, `Вы должны администратору ${rub(item.owed)} (${item.percent}%).`);
  }
  return lines.join('\n');
}

/** Рассылает итог дня администраторам и мастерам. Один раз за день. */
export async function sendDayReport(date: string, byUserId: number | null): Promise<DayReport> {
  assertDate(date);
  if (reportSentAt(date)) throw new CashError('Итог дня уже отправлен', 409);
  const report = buildReport(date);
  db.prepare(
    `INSERT INTO cash_days (date, closed_at, closed_by, report) VALUES (?, datetime('now'), ?, ?)
     ON CONFLICT(date) DO UPDATE SET closed_at = excluded.closed_at, closed_by = excluded.closed_by, report = excluded.report`,
  ).run(
    date,
    byUserId,
    JSON.stringify(report),
  );

  await sendToPeople(adminMaxUsers(), adminReportText(report));
  for (const item of report.masters) {
    await sendToMaster(item.masterId, masterReportText(report, item));
  }
  return report;
}

// ─── Мастера: процент и телефон ───

export interface StaffMasterView {
  id: string;
  name: string;
  percent: number | null;
  phone: string | null;
  /** Мастер уже открывал приложение в MAX с этим номером — сообщения дойдут. */
  connected: boolean;
}

export function staffMasterViews(): StaffMasterView[] {
  return staffMasters().map((row) => ({
    id: row.id,
    name: row.name,
    percent: row.percent,
    phone: row.phone,
    connected: maxUsersByPhone(row.phone).length > 0,
  }));
}

export function updateStaffMaster(masterId: string, patch: { percent?: unknown; phone?: unknown }): void {
  if (!getMaster(masterId)?.active) throw new CashError('Такого мастера нет', 404);

  if (patch.percent !== undefined) {
    const raw = patch.percent === null || patch.percent === '' ? null : Number(patch.percent);
    if (raw !== null && (!Number.isInteger(raw) || raw < 0 || raw > 100)) {
      throw new CashError('Процент — целое число от 0 до 100');
    }
    db.prepare('UPDATE masters SET percent = ? WHERE id = ?').run(raw || null, masterId);
  }

  if (patch.phone !== undefined) {
    const phone = String(patch.phone ?? '').trim();
    const key = phoneKey(phone);
    if (phone && !key) throw new CashError('Укажите телефон полностью');
    if (key) {
      const taken = staffMasters().find((row) => row.id !== masterId && phoneKey(row.phone) === key);
      if (taken) throw new CashError(`Этот номер уже у мастера ${taken.name}`);
    }
    db.prepare('UPDATE masters SET phone = ? WHERE id = ?').run(key ? `+7${key}` : null, masterId);
  }
}

// ─── Расписание рассылок ───

const DUTY_MORNING_FROM = 8 * 60 + 30;
const DUTY_MORNING_TO = 11 * 60;
/** Во сколько по салону бот рассылает итог дня. */
const AUTO_CLOSE_SETTING = 'cash_auto_close_minutes';
const AUTO_CLOSE_DEFAULT = 20 * 60 + 30;

async function morningDuty(): Promise<void> {
  const minutes = salonMinutesOfDay();
  if (minutes < DUTY_MORNING_FROM || minutes > DUTY_MORNING_TO) return;
  const today = salonToday();
  const row = db.prepare('SELECT * FROM duty_days WHERE date = ? AND morning_sent_at IS NULL').get(today) as
    | { master_id: string }
    | undefined;
  if (!row) return;
  // Отмечаем заранее: лучше пропустить напоминание, чем слать его каждые пять минут.
  db.prepare(`UPDATE duty_days SET morning_sent_at = datetime('now') WHERE date = ?`).run(today);

  const name = masterName(row.master_id);
  await sendToMaster(
    row.master_id,
    `Доброе утро! Сегодня вы дежурный. Записывайте в кассу каждого клиента — вечером бот сам пришлёт итог.`,
  );
  if (maxToken()) {
    await Promise.all(
      enabledRecipients('max')
        .filter((recipient) => recipient.kind === 'chat')
        .map((recipient) => sendToMaxChat(recipient.target, `Сегодня дежурит <b>${name}</b>. Каждого клиента — в кассу.`)),
    );
  }
}

/** Итог дней с записями: сегодняшний — после закрытия салона, пропущенные прошлые — сразу. */
async function sendDueReports(): Promise<void> {
  const today = salonToday();
  const closeAt = Number(getSetting(AUTO_CLOSE_SETTING) ?? AUTO_CLOSE_DEFAULT);
  const open = db
    .prepare(
      `SELECT DISTINCT e.date FROM cash_entries e
       LEFT JOIN cash_days d ON d.date = e.date
       WHERE e.deleted_at IS NULL AND d.date IS NULL AND e.date <= ? AND e.date >= ?
       ORDER BY e.date`,
    )
    .all(today, addDays(today, -7)) as { date: string }[];

  for (const { date } of open) {
    if (date === today && salonMinutesOfDay() < closeAt) continue;
    try {
      await sendDayReport(date, null);
      console.info(`[cash] итог за ${date} разослан`);
    } catch (error) {
      console.warn(`[cash] не удалось разослать итог за ${date}:`, (error as Error).message);
    }
  }
}

export async function cashbookTick(): Promise<void> {
  await morningDuty();
  await sendDueReports();
}
