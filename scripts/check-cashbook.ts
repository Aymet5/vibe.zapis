/**
 * Проверка кассы: кто сотрудник, кто может писать, как считаются проценты
 * и что закрытый день не меняется. Запуск на временной базе:
 *   DATABASE_PATH=/tmp/cash.sqlite npx tsx scripts/check-cashbook.ts
 */
import assert from 'node:assert/strict';
import {
  addEntry,
  closeDay,
  dayView,
  deleteEntry,
  dutyFor,
  fillDutyRotation,
  phoneKey,
  reopenDay,
  setDuty,
  staffRole,
  updateStaffMaster,
} from '../server/cashbook';
import { db, type UserRow } from '../server/db';
import { activeMasters } from '../server/masters';
import { addDays, salonToday } from '../server/time';

function user(maxId: string, phone: string): UserRow {
  db.prepare('INSERT INTO users (max_id, first_name, last_name, phone) VALUES (?, ?, ?, ?)').run(maxId, 'Имя', maxId, phone);
  return db.prepare('SELECT * FROM users WHERE max_id = ?').get(maxId) as UserRow;
}

async function main() {
  assert.equal(phoneKey('+7 (999) 179-28-95'), '9991792895');
  assert.equal(phoneKey('89991792895'), '9991792895');
  assert.equal(phoneKey('123'), null);

  const today = salonToday();
  const [m1, m2] = activeMasters();

  const admin = user('a1', '+7 (999) 179-28-95');
  const admin2 = user('a2', '89911149706');
  const duty = user('d1', '+7 (900) 111-22-33');
  const other = user('o1', '+7 (900) 444-55-66');
  const client = user('c1', '+7 (900) 777-88-99');

  assert.equal(staffRole(admin)?.isAdmin, true);
  assert.equal(staffRole(admin2)?.isAdmin, true);
  assert.equal(staffRole(client), null);
  assert.equal(staffRole(duty), null, 'без телефона в карточке мастер не сотрудник');

  updateStaffMaster(m1.id, { percent: 40, phone: '8 900 111 22 33' });
  updateStaffMaster(m2.id, { percent: 30, phone: '+79004445566' });
  assert.throws(() => updateStaffMaster(m2.id, { phone: '89001112233' }), /уже у мастера/);
  assert.throws(() => updateStaffMaster(m2.id, { percent: 150 }), /от 0 до 100/);

  const dutyRole = staffRole(duty)!;
  const otherRole = staffRole(other)!;
  const adminRole = staffRole(admin)!;
  assert.equal(dutyRole.masterId, m1.id);
  assert.equal(dutyRole.isAdmin, false);

  // Пока дежурный не назначен, мастер писать не может.
  assert.throws(() => addEntry(dutyRole, duty.id, { date: today, masterId: m1.id, service: 'Фейд', price: 600 }), /дежурный/);

  await setDuty(today, m1.id, admin.id);
  assert.equal(dutyFor(today).masterId, m1.id);

  addEntry(dutyRole, duty.id, { date: today, masterId: m1.id, service: 'Фейд', price: 600 });
  addEntry(dutyRole, duty.id, { date: today, masterId: m1.id, service: 'Борода', price: 401 });
  addEntry(adminRole, admin.id, { date: today, masterId: m2.id, service: 'Модельная', price: 1000 });
  assert.throws(() => addEntry(otherRole, other.id, { date: today, masterId: m2.id, service: 'Фейд', price: 600 }), /дежурный/);
  assert.throws(() => addEntry(dutyRole, duty.id, { date: today, masterId: m1.id, service: 'Фейд', price: 0 }), /цену/);

  // Ошибочная запись удаляется и в итог не попадает.
  addEntry(dutyRole, duty.id, { date: today, masterId: m2.id, service: 'Ошибка', price: 5000 });
  const wrong = dayView(dutyRole, today).entries.find((entry) => entry.service === 'Ошибка')!;
  deleteEntry(dutyRole, duty.id, wrong.id);

  const view = dayView(adminRole, today);
  assert.equal(view.entries.length, 3);
  const t1 = view.report.masters.find((m) => m.masterId === m1.id)!;
  assert.deepEqual([t1.clients, t1.revenue, t1.owed, t1.earned], [2, 1001, 400, 601]);
  const t2 = view.report.masters.find((m) => m.masterId === m2.id)!;
  assert.deepEqual([t2.revenue, t2.owed], [1000, 300]);
  assert.equal(view.report.owed, 700);

  // Мастер не на дежурстве видит только своё.
  const own = dayView(otherRole, today);
  assert.equal(own.canWrite, false);
  assert.ok(own.entries.every((entry) => entry.masterId === m2.id));
  assert.equal(own.report.masters.length, 1);

  await closeDay(today, duty.id);
  assert.equal(dayView(adminRole, today).closed, true);
  assert.equal(dayView(dutyRole, today).canWrite, false);
  assert.throws(() => addEntry(adminRole, admin.id, { date: today, masterId: m1.id, service: 'Фейд', price: 600 }), /закрыт/);
  await assert.rejects(closeDay(today, admin.id), /уже закрыт/);

  // Процент поменяли после закрытия — отправленный итог не меняется.
  updateStaffMaster(m1.id, { percent: 50 });
  assert.equal(dayView(adminRole, today).report.owed, 700);
  reopenDay(today);
  addEntry(adminRole, admin.id, { date: today, masterId: m1.id, service: 'Фейд', price: 600 });
  assert.equal(dayView(adminRole, today).report.owed, Math.floor(1601 * 0.5) + 300);

  // Очередь: после m1 сегодня завтра дежурит следующий по порядку.
  const order = activeMasters().map((m) => m.id);
  await fillDutyRotation(addDays(today, 1), 5, admin.id);
  assert.equal(dutyFor(addDays(today, 1)).masterId, order[(order.indexOf(m1.id) + 1) % order.length]);
  assert.equal(dutyFor(addDays(today, 2)).masterId, order[(order.indexOf(m1.id) + 2) % order.length]);

  console.log('Касса: все проверки прошли');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
