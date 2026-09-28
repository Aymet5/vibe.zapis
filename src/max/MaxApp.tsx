import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, ChevronRight, Clock, Percent, Phone, Repeat, Scissors, User } from 'lucide-react';
import {
  BONUS_PER_VISIT,
  CATEGORIES,
  MAX_BONUS_PERCENT,
  SERVICES,
  applyDiscount,
  findService,
  formatPrice,
  type CategoryId,
  type Service,
} from '../../shared/catalog';
import type { BookingView, PublicMaster } from '../../shared/types';
import { api } from '../api';
import { DateStrip } from '../components/DateStrip';
import { SlotGrid } from '../components/SlotGrid';
import { Button, ErrorNote, Spinner, StatusBadge, inputClass } from '../components/ui';
import { formatDate, formatDateFull, formatDuration, formatPhone, plural } from '../lib/format';
import { haptic, maxStartParam, requestMaxPhone, setMaxBackButton, signalMaxReady } from '../lib/maxApp';
import { useSession } from '../lib/session';
import { RescheduleForm } from '../pages/Profile';

/**
 * Сайт внутри мини-приложения MAX. Никакого лендинга: три вкладки снизу,
 * запись по шагам, системная кнопка «Назад» и отклик вибрацией —
 * чтобы ощущалось как приложение, а не как открытая в чате страница.
 */

type Tab = 'book' | 'bookings' | 'profile';

const START_DONE_KEY = 'vibe:max-start-done';

/** Ссылка из бота (?startapp=…) срабатывает один раз за запуск. */
function takeStartParam(): string | null {
  const start = maxStartParam();
  if (!start) return null;
  try {
    if (sessionStorage.getItem(START_DONE_KEY) === start) return null;
    sessionStorage.setItem(START_DONE_KEY, start);
  } catch {
    // Без хранилища просто выполняем переход.
  }
  return start;
}

export function MaxApp() {
  const { user, config, loading } = useSession();

  useEffect(() => {
    signalMaxReady();
  }, []);
  const [tab, setTab] = useState<Tab>('book');
  const [moveId, setMoveId] = useState<number | null>(null);

  // Внутри MAX следуем теме телефона, а не сохранённой на сайте.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (loading) return;
    const start = takeStartParam();
    const move = start && /^move-(\d+)$/.exec(start);
    if (move) {
      setMoveId(Number(move[1]));
      setTab('bookings');
    } else if (start === 'profile') {
      setTab('profile');
    }
  }, [loading]);

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    haptic('tap');
    setTab(next);
    window.scrollTo({ top: 0 });
  };

  if (loading || !config) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-bg-main text-text-muted">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-3 bg-bg-main text-text-main px-8 text-center">
        <Scissors className="w-10 h-10 text-orange-500" />
        <p className="text-xl font-black">Не удалось войти</p>
        <p className="text-text-muted">Закройте приложение и откройте его заново из чата с ботом ВАЙБ.</p>
      </div>
    );
  }

  return (
    <div className="max-app min-h-[100dvh] bg-bg-main text-text-main font-sans">
      <header className="sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-bg-main/90 backdrop-blur-xl border-b border-border">
        <span className="text-xl font-black tracking-tighter">
          ВАЙБ<span className="text-orange-500">.</span>
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-orange-500/10 px-3 py-1 text-sm font-bold text-orange-500">
          <Percent className="w-3.5 h-3.5" /> {user.bonusPercent}%
        </span>
      </header>

      <main className="px-4 pt-4 pb-[calc(88px+env(safe-area-inset-bottom))]">
        {tab === 'book' && <BookScreen masters={config.masters} today={config.today} onDone={() => switchTab('bookings')} />}
        {tab === 'bookings' && (
          <BookingsScreen
            today={config.today}
            horizonDays={config.horizonDays}
            moveId={moveId}
            onMoveHandled={() => setMoveId(null)}
            onBook={() => switchTab('book')}
          />
        )}
        {tab === 'profile' && <ProfileScreen />}
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-30 grid grid-cols-3 border-t border-border bg-bg-main/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
        {(
          [
            { id: 'book', label: 'Запись', icon: Scissors },
            { id: 'bookings', label: 'Мои записи', icon: CalendarDays },
            { id: 'profile', label: 'Профиль', icon: User },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => switchTab(item.id)}
            className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition-colors ${
              tab === item.id ? 'text-orange-500' : 'text-text-muted'
            }`}
          >
            <item.icon className="w-6 h-6" strokeWidth={tab === item.id ? 2.4 : 1.8} />
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── Запись по шагам ───

type Step = 'service' | 'master' | 'time' | 'confirm' | 'done';

const STEP_TITLES: Record<Exclude<Step, 'done'>, string> = {
  service: 'Выберите услугу',
  master: 'Выберите мастера',
  time: 'Выберите время',
  confirm: 'Проверьте запись',
};

const STEP_ORDER: Exclude<Step, 'done'>[] = ['service', 'master', 'time', 'confirm'];

function BookScreen({
  masters,
  today,
  onDone,
}: {
  masters: PublicMaster[];
  today: string;
  onDone: () => void;
}) {
  const { user, refresh } = useSession();
  const [step, setStep] = useState<Step>('service');
  const [category, setCategory] = useState<CategoryId>('mens');
  const [service, setService] = useState<Service | null>(null);
  const [master, setMaster] = useState<PublicMaster | null>(null);
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('');
  const [slots, setSlots] = useState<{ time: string; available: boolean }[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [discount, setDiscount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    setName((current) => current || `${user.firstName} ${user.lastName}`.trim());
    setPhone((current) => current || (user.phone ? formatPhone(user.phone) : ''));
  }, [user]);

  const categoryMasters = useMemo(
    () => masters.filter((item) => item.categories.includes(category)),
    [masters, category],
  );

  useEffect(() => {
    if (step !== 'time' || !master || !service) return;
    let cancelled = false;
    setSlotsLoading(true);
    api
      .availability(date, master.id, category, service.name)
      .then((response) => {
        if (cancelled) return;
        setSlots(response.slots);
        setTime((current) => (response.slots.some((slot) => slot.time === current && slot.available) ? current : ''));
      })
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setSlotsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [step, master, service, category, date]);

  const back = useCallback(() => {
    const index = STEP_ORDER.indexOf(step as Exclude<Step, 'done'>);
    if (index > 0) {
      haptic('tap');
      setError('');
      setStep(STEP_ORDER[index - 1]);
    }
  }, [step]);

  // Системная «Назад» в MAX ведёт на прошлый шаг, на первом шаге её нет.
  useEffect(() => setMaxBackButton(step !== 'service' && step !== 'done' ? back : null), [step, back]);

  const go = (next: Step) => {
    haptic('select');
    setError('');
    setStep(next);
    window.scrollTo({ top: 0 });
  };

  const maxDiscount = user?.bonusPercent ?? 0;
  const discountAvailable = Boolean(maxDiscount > 0 && service && service.price !== null);
  const finalPrice = service?.price == null ? null : applyDiscount(service.price, discountAvailable ? discount : 0);

  const submit = async () => {
    if (!service || !master || !time) return;
    setSubmitting(true);
    setError('');
    try {
      await api.createBooking({
        category,
        service: service.name,
        masterId: master.id,
        date,
        time,
        clientName: name,
        clientPhone: phone,
        discountPercent: discountAvailable ? discount : 0,
      });
      haptic('success');
      await refresh();
      setStep('done');
    } catch (err) {
      haptic('error');
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setService(null);
    setMaster(null);
    setTime('');
    setDiscount(0);
    setDate(today);
    setStep('service');
  };

  if (step === 'done') {
    return (
      <div className="max-step flex flex-col items-center text-center gap-4 pt-16">
        <div className="w-20 h-20 rounded-full bg-orange-500 flex items-center justify-center">
          <Check className="w-10 h-10 text-white" strokeWidth={3} />
        </div>
        <p className="text-2xl font-black tracking-tight">Вы записаны!</p>
        <p className="text-text-muted">
          {formatDateFull(date)}, {time}
          <br />
          {service?.name} · {master?.name}
        </p>
        <p className="text-sm text-text-muted">Подтверждение пришло в чат с ботом. Там же напомним о визите.</p>
        <div className="flex flex-col gap-2 w-full pt-4">
          <Button onClick={onDone} className="w-full py-4">
            Мои записи
          </Button>
          <Button variant="ghost" onClick={reset} className="w-full py-4">
            Записаться ещё
          </Button>
        </div>
      </div>
    );
  }

  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex gap-1.5">
          {STEP_ORDER.map((item, index) => (
            <span
              key={item}
              className={`h-1 flex-1 rounded-full transition-colors ${index <= stepIndex ? 'bg-orange-500' : 'bg-badge'}`}
            />
          ))}
        </div>
        <h1 className="text-2xl font-black tracking-tight">{STEP_TITLES[step]}</h1>
      </div>

      {/* Новый шаг въезжает CSS-анимацией: она не зависит от загруженности скрипта. */}
      <div key={step} className="max-step space-y-4">
        {step === 'service' && (
          <>
            <div className="grid grid-cols-3 gap-1 rounded-2xl bg-badge p-1">
              {CATEGORIES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    haptic('select');
                    setCategory(item.id);
                  }}
                  className={`rounded-xl py-2 text-sm font-semibold transition-colors ${
                    category === item.id ? 'bg-bg-main text-text-main shadow' : 'text-text-muted'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <List>
              {SERVICES[category].map((item) => (
                <Row
                  key={item.name}
                  title={item.name}
                  subtitle={formatDuration(item.duration)}
                  trailing={<span className="font-bold text-orange-500">{formatPrice(item)}</span>}
                  onClick={() => {
                    setService(findService(category, item.name) ?? item);
                    if (master && !master.categories.includes(category)) setMaster(null);
                    go('master');
                  }}
                />
              ))}
            </List>
          </>
        )}

        {step === 'master' && (
          <List>
            {categoryMasters.map((item) => (
              <Row
                key={item.id}
                leading={
                  item.photo ? (
                    <img src={item.photo} alt="" className="w-12 h-12 rounded-full object-cover" />
                  ) : (
                    <span className="w-12 h-12 rounded-full bg-orange-500/15 text-orange-500 flex items-center justify-center text-lg font-black">
                      {item.name.charAt(0)}
                    </span>
                  )
                }
                title={item.name}
                subtitle={item.role}
                onClick={() => {
                  setMaster(item);
                  go('time');
                }}
              />
            ))}
          </List>
        )}

        {step === 'time' && (
          <>
            <DateStrip
              today={today}
              value={date}
              onChange={(next) => {
                haptic('select');
                setDate(next);
              }}
            />
            <SlotGrid
              slots={slots}
              value={time}
              loading={slotsLoading}
              onChange={(next) => {
                setTime(next);
                go('confirm');
              }}
              emptyText="На этот день свободных окошек нет — выберите другой день."
            />
          </>
        )}

        {step === 'confirm' && service && master && (
          <>
            <List>
              <Row title={service.name} subtitle="Услуга" onClick={() => go('service')} />
              <Row title={master.name} subtitle="Мастер" onClick={() => go('master')} />
              <Row title={`${formatDateFull(date)}, ${time}`} subtitle="Время" onClick={() => go('time')} />
            </List>

            <div className="space-y-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ваше имя"
                className={inputClass}
              />
              <input
                type="tel"
                value={phone}
                onChange={(event) => setPhone(formatPhone(event.target.value))}
                placeholder="+7 (999) 000-00-00"
                className={inputClass}
              />
            </div>

            {discountAvailable && (
              <div className="space-y-2">
                <p className="text-sm text-text-muted">Списать скидку (накоплено {maxDiscount}%)</p>
                <div className="flex gap-2">
                  {Array.from(new Set([0, Math.floor(maxDiscount / 2), maxDiscount])).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        haptic('select');
                        setDiscount(value);
                      }}
                      className={`flex-1 rounded-xl border py-2.5 text-sm font-bold ${
                        discount === value
                          ? 'border-orange-500 bg-orange-500 text-white'
                          : 'border-border bg-surface text-text-muted'
                      }`}
                    >
                      {value === 0 ? 'Нет' : `${value}%`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <ErrorNote>{error}</ErrorNote>}

            <div className="sticky bottom-[calc(80px+env(safe-area-inset-bottom))] pt-2">
              <Button
                onClick={() => void submit()}
                loading={submitting}
                disabled={!name.trim() || phone.replace(/\D/g, '').length !== 11}
                className="w-full py-4 text-lg shadow-lg shadow-orange-500/20"
              >
                Записаться{finalPrice !== null && ` · ${service.from ? 'от ' : ''}${finalPrice}р`}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Мои записи ───

function BookingsScreen({
  today,
  horizonDays,
  moveId,
  onMoveHandled,
  onBook,
}: {
  today: string;
  horizonDays: number;
  moveId: number | null;
  onMoveHandled: () => void;
  onBook: () => void;
}) {
  const { refresh } = useSession();
  const [bookings, setBookings] = useState<BookingView[] | null>(null);
  const [movingId, setMovingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      setBookings((await api.myBookings()).bookings);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upcoming = (bookings ?? []).filter((item) => item.status === 'pending' || item.status === 'confirmed');
  const past = (bookings ?? []).filter((item) => !upcoming.includes(item)).slice(0, 10);

  // Пришли по кнопке «Перенести» из бота — сразу открываем выбор времени.
  useEffect(() => {
    if (!bookings || moveId === null) return;
    if (upcoming.some((item) => item.id === moveId)) setMovingId(moveId);
    onMoveHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, moveId]);

  useEffect(() => setMaxBackButton(movingId !== null ? () => setMovingId(null) : null), [movingId]);

  const cancel = async (id: number) => {
    setBusyId(id);
    setError('');
    try {
      await api.cancelMyBooking(id);
      haptic('success');
      setNote('Запись отменена');
      await Promise.all([load(), refresh()]);
    } catch (err) {
      haptic('error');
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (!bookings) {
    return (
      <div className="flex justify-center py-16 text-text-muted">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-black tracking-tight">Мои записи</h1>
      {error && <ErrorNote>{error}</ErrorNote>}
      {note && <p className="rounded-2xl bg-emerald-500/10 px-4 py-3 text-emerald-500">{note}</p>}

      {upcoming.length === 0 ? (
        <div className="rounded-3xl bg-surface p-8 text-center space-y-4">
          <CalendarDays className="w-10 h-10 mx-auto text-text-muted" />
          <p className="text-text-muted">Активных записей нет</p>
          <Button onClick={onBook} className="w-full">
            Записаться
          </Button>
        </div>
      ) : (
        upcoming.map((booking) => (
          <article key={booking.id} className="rounded-3xl bg-surface p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-bold">{formatDateFull(booking.date)}</p>
                <p className="text-2xl font-black text-orange-500">
                  {booking.time}
                  <span className="text-base font-medium text-text-muted">–{booking.endTime}</span>
                </p>
              </div>
              <StatusBadge status={booking.status} />
            </div>
            <p className="text-text-muted">
              {booking.service} · {booking.masterName}
              {booking.finalPrice !== null && ` · ${booking.finalPrice}р`}
            </p>

            {movingId === booking.id ? (
              <RescheduleForm
                booking={booking}
                today={today}
                horizonDays={horizonDays}
                onClose={() => setMovingId(null)}
                onMoved={async (moved) => {
                  haptic('success');
                  setMovingId(null);
                  setNote(`Перенесли на ${formatDateFull(moved.date)}, ${moved.time}`);
                  await load();
                }}
              />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    haptic('tap');
                    setNote('');
                    setMovingId(booking.id);
                  }}
                >
                  <Repeat className="w-4 h-4" /> Перенести
                </Button>
                <Button variant="danger" loading={busyId === booking.id} onClick={() => void cancel(booking.id)}>
                  Отменить
                </Button>
              </div>
            )}
          </article>
        ))
      )}

      {past.length > 0 && (
        <section className="space-y-2">
          <p className="text-sm font-semibold text-text-muted uppercase tracking-wide">История</p>
          <List>
            {past.map((booking) => (
              <Row
                key={booking.id}
                title={`${formatDate(booking.date)} · ${booking.service}`}
                subtitle={booking.masterName}
                trailing={<StatusBadge status={booking.status} />}
              />
            ))}
          </List>
        </section>
      )}
    </div>
  );
}

// ─── Профиль ───

function ProfileScreen() {
  const { user, setUser } = useSession();
  const [phone, setPhone] = useState(user?.phone ? formatPhone(user.phone) : '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  if (!user) return null;

  const save = async (value: string) => {
    setSaving(true);
    setError('');
    try {
      setUser((await api.savePhone(value)).user);
      setPhone(value);
      haptic('success');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      haptic('error');
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const fromMax = async () => {
    const number = await requestMaxPhone();
    if (number) await save(formatPhone(number));
  };

  const left = MAX_BONUS_PERCENT - user.bonusPercent;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        {user.photo ? (
          <img src={user.photo} alt="" className="w-16 h-16 rounded-full object-cover" />
        ) : (
          <span className="w-16 h-16 rounded-full bg-orange-500/15 text-orange-500 flex items-center justify-center text-2xl font-black">
            {user.firstName.charAt(0)}
          </span>
        )}
        <div>
          <p className="text-xl font-black">
            {user.firstName} {user.lastName}
          </p>
          <p className="text-text-muted text-sm">
            {user.visitsCount} {plural(user.visitsCount, 'визит', 'визита', 'визитов')} в ВАЙБ
          </p>
        </div>
      </div>

      <div className="rounded-3xl bg-gradient-to-br from-orange-500 to-red-500 p-5 text-white space-y-3">
        <p className="text-sm text-white/80">Накопленная скидка</p>
        <p className="text-5xl font-black tracking-tighter">{user.bonusPercent}%</p>
        <div className="h-2 rounded-full bg-white/25 overflow-hidden">
          <div className="h-full bg-white rounded-full" style={{ width: `${(user.bonusPercent / MAX_BONUS_PERCENT) * 100}%` }} />
        </div>
        <p className="text-sm text-white/90">
          {left <= 0
            ? 'Максимум накоплен — следующая стрижка может быть бесплатной.'
            : `${BONUS_PER_VISIT}% за каждый визит, до ${MAX_BONUS_PERCENT}%.`}
        </p>
      </div>

      <div className="rounded-3xl bg-surface p-4 space-y-3">
        <p className="font-bold flex items-center gap-2">
          <Phone className="w-4 h-4 text-orange-500" /> Телефон для связи
        </p>
        <input
          type="tel"
          value={phone}
          onChange={(event) => setPhone(formatPhone(event.target.value))}
          placeholder="+7 (999) 000-00-00"
          className={inputClass}
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={() => void fromMax()} disabled={saving}>
            Взять из MAX
          </Button>
          <Button onClick={() => void save(phone)} loading={saving}>
            {saved ? 'Сохранено' : 'Сохранить'}
          </Button>
        </div>
      </div>

      <List>
        <Row
          leading={<Clock className="w-5 h-5 text-orange-500" />}
          title="Ежедневно 09:00 — 19:00"
          subtitle="ТД «5 Звёзд», 1 этаж, г. Кызыл"
        />
      </List>
    </div>
  );
}

// ─── Список в стиле приложения ───

function List({ children }: { children: React.ReactNode }) {
  return <div className="rounded-3xl bg-surface divide-y divide-border overflow-hidden">{children}</div>;
}

function Row({
  title,
  subtitle,
  leading,
  trailing,
  onClick,
}: {
  title: string;
  subtitle?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      {leading}
      <span className="flex-1 min-w-0 text-left">
        <span className="block font-semibold truncate">{title}</span>
        {subtitle && <span className="block text-sm text-text-muted truncate">{subtitle}</span>}
      </span>
      {trailing}
      {onClick && <ChevronRight className="w-5 h-5 text-text-muted/60 shrink-0" />}
    </>
  );

  return onClick ? (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-surface-hover">
      {content}
    </button>
  ) : (
    <div className="flex items-center gap-3 px-4 py-3.5">{content}</div>
  );
}
