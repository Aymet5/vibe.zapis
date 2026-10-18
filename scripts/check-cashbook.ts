/**
 * Проверка кассы: кто сотрудник, кто может писать, как считаются проценты
 * и что закрытый день не меняется. Запуск на временной базе:
 *   DATABASE_PATH=/tmp/cash.sqlite npx tsx scripts/check-cashbook.ts
 */
import assert from 'node:assert/strict';
import {
  addEntry,
  cancelPayment,
  confirmPayment,
  masterDebt,
  dayView,
  deleteEntry,
  dutyFor,
  fillDutyRotation,
  finishShift,
  phoneKey,
  sendDayReport,
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
  assert.equal(staffRole(duty), null, 'без привязки мастер не сотрудник');

  // Кто позже впишет себе номер администратора, админом не станет.
  const impostor = user('x1', '+7 (999) 179-28-95');
  assert.equal(staffRole(impostor), null);

  updateStaffMaster(m1.id, { percent: 40, phone: '8 900 111 22 33' });
  updateStaffMaster(m2.id, { percent: 30, phone: '+79004445566' });
  // Одного номера мало — мастера привязывает администратор, и только подходящий по номеру аккаунт.
  assert.equal(staffRole(duty), null);
  assert.throws(() => updateStaffMaster(m1.id, { userId: client.id }), /не подходит/);
  updateStaffMaster(m1.id, { userId: duty.id });
  updateStaffMaster(m2.id, { userId: other.id });
  assert.throws(() => addEntry(staffRole(admin)!, admin.id, { date: addDays(today, 1), masterId: m1.id, service: 'Фейд', price: 600 }), /будущий/);
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

  // Долги: пока смена идёт, сегодняшнее ещё не долг; прошлые дни копятся.
  assert.equal(masterDebt(m1.id).balance, 0);
  addEntry(adminRole, admin.id, { date: addDays(today, -2), masterId: m1.id, service: 'Фейд', price: 1000 });
  addEntry(adminRole, admin.id, { date: addDays(today, -1), masterId: m1.id, service: 'Фейд', price: 500 });
  // Процент запомнился в записях: 40% от 1000 и от 500.
  assert.equal(masterDebt(m1.id).balance, 600);
  assert.deepEqual(masterDebt(m1.id).unpaidDays.map((day) => day.amount), [400, 200]);
  // Частичная оплата гасит самый старый день.
  await confirmPayment(m1.id, 450, admin.id);
  assert.deepEqual(masterDebt(m1.id).unpaidDays, [{ date: addDays(today, -1), amount: 150 }]);
  await assert.rejects(confirmPayment(m1.id, 1000, admin.id), /должен только/);
  const wrongPayment = masterDebt(m1.id).payments[0];
  cancelPayment(wrongPayment.id);
  assert.equal(masterDebt(m1.id).balance, 600);
  await confirmPayment(m1.id, 600, admin.id);
  assert.equal(masterDebt(m1.id).balance, 0);

  // Итог видно сразу, без закрытия дня. После рассылки дежурный уже не правит, админ — может.
  // Мастер не на дежурстве смену не завершает, дежурный — да.
  await assert.rejects(finishShift(otherRole, other.id, today), /дежурный или администратор/);
  await finishShift(dutyRole, duty.id, today);
  assert.ok(dayView(adminRole, today).reportSentAt);
  assert.equal(dayView(dutyRole, today).canWrite, false);
  assert.throws(() => addEntry(dutyRole, duty.id, { date: today, masterId: m1.id, service: 'Фейд', price: 600 }), /уже отправлен/);
  await assert.rejects(sendDayReport(today, null), /уже отправлен/);
  addEntry(adminRole, admin.id, { date: today, masterId: m1.id, service: 'Фейд', price: 600 });
  // После рассылки сегодняшнее стало долгом: 40% от 1601.
  assert.equal(masterDebt(m1.id).balance, Math.floor(1601 * 0.4));
  // Процент поменяли — уже записанные клиенты не пересчитываются, новые идут по новому.
  updateStaffMaster(m1.id, { percent: 50 });
  addEntry(adminRole, admin.id, { date: today, masterId: m1.id, service: 'Кроп', price: 600 });
  assert.equal(dayView(adminRole, today).report.owed, Math.floor(1601 * 0.4 + 600 * 0.5) + 300);

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
