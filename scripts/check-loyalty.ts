/**
 * Проверка правил накопительной скидки на временной базе.
 * Запуск: npm run check:loyalty
 *
 * Проверяем то, что нельзя увидеть через HTTP без настоящего входа в ВК:
 * резерв процентов при записи, возврат при отмене, списание и начисление за визит.
 */
process.env.DATABASE_PATH = process.env.DATABASE_PATH ?? '/tmp/vibe-loyalty-check.sqlite';
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'check';

import assert from 'node:assert/strict';
import fs from 'node:fs';

for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(`${process.env.DATABASE_PATH}${suffix}`, { force: true });
}

const { db } = await import('../server/db');
const { cancelBooking, completeBooking, createBooking, getAvailability, markNoShow } = await import(
  '../server/bookings'
);
const { addDays, salonToday } = await import('../server/time');
import type { UserRow } from '../server/db';

const DATE = addDays(salonToday(), 5);
let passed = 0;

function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function makeUser(bonus: number): UserRow {
  const result = db
    .prepare('INSERT INTO users (vk_id, first_name, last_name, bonus_percent) VALUES (?, ?, ?, ?)')
    .run(`vk${Date.now()}${Math.random()}`, 'Тест', 'Клиент', bonus);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(result.lastInsertRowid)) as UserRow;
}

function balance(userId: number): number {
  return (db.prepare('SELECT bonus_percent FROM users WHERE id = ?').get(userId) as { bonus_percent: number })
    .bonus_percent;
}

function book(user: UserRow | undefined, time: string, discount = 0, master = 'aydis') {
  return createBooking({
    category: 'mens',
    service: 'Модельная',
    masterId: master,
    date: DATE,
    time,
    clientName: 'Тест Клиент',
    clientPhone: '+7 (999) 000-00-00',
    discountPercent: discount,
    user,
  });
}

console.log('\nНачисление и списание процентов');

check('за завершённый визит начисляется 1%', () => {
  const user = makeUser(0);
  const booking = book(user, '09:00');
  completeBooking(booking.id, { writeOffPercent: 0, finalPrice: null });
  assert.equal(balance(user.id), 1);
});

check('процент за визит начисляется один раз', () => {
  const user = makeUser(0);
  const booking = book(user, '09:30');
  completeBooking(booking.id, { writeOffPercent: 0, finalPrice: null });
  assert.throws(() => completeBooking(booking.id, { writeOffPercent: 0, finalPrice: null }));
  assert.equal(balance(user.id), 1);
});

check('баланс не превышает 100%', () => {
  const user = makeUser(100);
  const booking = book(user, '10:00');
  completeBooking(booking.id, { writeOffPercent: 0, finalPrice: null });
  assert.equal(balance(user.id), 100);
});

check('скидка резервируется в момент записи', () => {
  const user = makeUser(30);
  book(user, '10:30', 20);
  assert.equal(balance(user.id), 10, 'зарезервированные 20% списаны с баланса сразу');
});

check('нельзя заявить больше, чем накоплено', () => {
  const user = makeUser(5);
  assert.throws(() => book(user, '11:00', 10), /накоплено/);
  assert.equal(balance(user.id), 5);
});

check('один и тот же процент нельзя занять дважды', () => {
  const user = makeUser(50);
  book(user, '11:30', 50);
  assert.equal(balance(user.id), 0);
  assert.throws(() => book(user, '12:00', 50), /накоплено/);
});

check('отмена возвращает зарезервированную скидку', () => {
  const user = makeUser(40);
  const booking = book(user, '12:30', 40);
  assert.equal(balance(user.id), 0);
  cancelBooking(booking.id, 'тест');
  assert.equal(balance(user.id), 40);
});

check('неявка возвращает скидку и не начисляет процент', () => {
  const user = makeUser(15);
  const booking = book(user, '13:00', 15);
  markNoShow(booking.id);
  assert.equal(balance(user.id), 15);
});

check('администратор списывает меньше заявленного — остаток возвращается', () => {
  const user = makeUser(50);
  const booking = book(user, '13:30', 50);
  completeBooking(booking.id, { writeOffPercent: 20, finalPrice: null });
  // 50 зарезервировано, списано 20, возвращено 30, плюс 1% за визит.
  assert.equal(balance(user.id), 31);
});

check('администратор может списать больше заявленного в пределах баланса', () => {
  const user = makeUser(50);
  const booking = book(user, '14:00', 10);
  assert.equal(balance(user.id), 40);
  completeBooking(booking.id, { writeOffPercent: 45, finalPrice: null });
  // Списано 45 из 50, остаётся 5, плюс 1% за визит.
  assert.equal(balance(user.id), 6);
});

check('списать больше доступного нельзя', () => {
  const user = makeUser(10);
  const booking = book(user, '14:30', 10);
  assert.throws(() => completeBooking(booking.id, { writeOffPercent: 60, finalPrice: null }), /доступно/);
});

check('цена считается со скидкой', () => {
  const user = makeUser(25);
  const booking = book(user, '15:00', 25);
  assert.equal(booking.base_price, 600);
  assert.equal(booking.final_price, 450, '600р минус 25%');
});

check('скидка 100% обнуляет счёт услуги', () => {
  const user = makeUser(100);
  const booking = book(user, '15:30', 100);
  assert.equal(booking.final_price, 0);
  completeBooking(booking.id, { writeOffPercent: 100, finalPrice: null });
  assert.equal(balance(user.id), 1, 'после полного списания остаётся только процент за этот визит');
});

check('на услугу без фиксированной цены скидку заранее не заявить', () => {
  const user = makeUser(50);
  assert.throws(
    () =>
      createBooking({
        category: 'mens',
        service: 'Я скажу потом',
        masterId: 'aydis',
        date: DATE,
        time: '16:00',
        clientName: 'Тест Клиент',
        clientPhone: '+7 (999) 000-00-00',
        discountPercent: 10,
        user,
      }),
    /администратор/,
  );
});

check('у гостевой записи скидки нет', () => {
  const booking = book(undefined, '16:30');
  assert.throws(() => completeBooking(booking.id, { writeOffPercent: 5, finalPrice: null }), /гостевой/);
});

console.log('\nСетка окошек');

// Отдельный день, чтобы записи из проверок выше не мешали сетке.
const GRID_DATE = addDays(salonToday(), 6);

check('занятое окошко пропадает из доступных', () => {
  const availabilityBefore = getAvailability(GRID_DATE, 'kezhik', 30);
  const slot = availabilityBefore.slots.find((s) => s.available)!;
  createBooking({
    category: 'mens',
    service: 'Модельная',
    masterId: 'kezhik',
    date: GRID_DATE,
    time: slot.time,
    clientName: 'Тест Клиент',
    clientPhone: '+7 (999) 000-00-00',
    discountPercent: 0,
    user: undefined,
  });
  const availabilityAfter = getAvailability(GRID_DATE, 'kezhik', 30);
  assert.equal(availabilityAfter.slots.find((s) => s.time === slot.time)?.available, false);
});

check('длинная услуга закрывает несколько окошек подряд', () => {
  createBooking({
    category: 'coloring',
    service: 'Мелирование',
    masterId: 'aydis',
    date: GRID_DATE,
    time: '16:00',
    clientName: 'Тест Клиент',
    clientPhone: '+7 (999) 000-00-00',
    discountPercent: 0,
    user: undefined,
  });
  const slots = getAvailability(GRID_DATE, 'aydis', 30).slots;
  // Мелирование идёт 3 часа: 16:00, 16:30, 17:00, 17:30, 18:00, 18:30.
  for (const time of ['16:00', '16:30', '17:00', '17:30', '18:00', '18:30']) {
    assert.equal(slots.find((s) => s.time === time)?.available, false, `${time} должно быть занято`);
  }
});

check('нельзя записаться так, чтобы услуга не успела до закрытия', () => {
  assert.throws(
    () =>
      createBooking({
        category: 'coloring',
        service: 'Мелирование',
        masterId: 'aydis',
        date: GRID_DATE,
        time: '18:00',
        clientName: 'Тест Клиент',
        clientPhone: '+7 (999) 000-00-00',
        discountPercent: 0,
        user: undefined,
      }),
    /закрытия/,
  );
});

check('мастеру нельзя назначить чужую категорию', () => {
  assert.throws(
    () =>
      createBooking({
        category: 'coloring',
        service: 'Тонирование',
        masterId: 'kezhik',
        date: DATE,
        time: '09:00',
        clientName: 'Тест Клиент',
        clientPhone: '+7 (999) 000-00-00',
        discountPercent: 0,
        user: undefined,
      }),
    /не оказывает/,
  );
});

check('на прошедшую дату записаться нельзя', () => {
  assert.throws(
    () =>
      createBooking({
        category: 'mens',
        service: 'Модельная',
        masterId: 'mengi',
        date: addDays(salonToday(), -1),
        time: '09:00',
        clientName: 'Тест Клиент',
        clientPhone: '+7 (999) 000-00-00',
        discountPercent: 0,
        user: undefined,
      }),
    /прошедшую дату/,
  );
});

console.log(`\nВсе проверки пройдены: ${passed}\n`);
