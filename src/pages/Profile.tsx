import { useCallback, useEffect, useState } from 'react';
import { Bell, CalendarDays, History, Percent, Phone, Scissors } from 'lucide-react';
import { BONUS_PER_VISIT, MAX_BONUS_PERCENT } from '../../shared/catalog';
import type { BonusTransactionView, BookingView } from '../../shared/types';
import { api } from '../api';
import { MasterSchedule } from '../components/MasterSchedule';
import { Button, ErrorNote, SectionHeading, Spinner, StatusBadge } from '../components/ui';
import { VkLoginButton } from '../components/VkLoginButton';
import { formatDate, formatDateFull, formatDuration, formatPhone, formatTimestamp, plural } from '../lib/format';
import { useSession } from '../lib/session';

export function Profile({ onNavigate }: { onNavigate: (to: string) => void }) {
  const { user, config, loading: sessionLoading, refresh } = useSession();

  const [bookings, setBookings] = useState<BookingView[]>([]);
  const [history, setHistory] = useState<BonusTransactionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [phone, setPhone] = useState('');
  const [phoneSaved, setPhoneSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bookingsResponse, bonusesResponse] = await Promise.all([api.myBookings(), api.myBonuses()]);
      setBookings(bookingsResponse.bookings);
      setHistory(bonusesResponse.history);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  useEffect(() => {
    if (user?.phone) setPhone(formatPhone(user.phone));
  }, [user]);

  if (sessionLoading) {
    return (
      <div className="pt-40 pb-20 flex justify-center text-text-muted">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="pt-36 pb-24 px-4">
        <div className="max-w-md mx-auto text-center rounded-3xl border border-border bg-surface p-8 space-y-5">
          <Percent className="w-12 h-12 text-orange-500 mx-auto" />
          <h1 className="text-2xl font-black tracking-tighter uppercase">Личный кабинет</h1>
          <p className="text-text-muted">
            Войдите через ВКонтакте, чтобы копить скидку — {BONUS_PER_VISIT}% за каждый визит, до{' '}
            {MAX_BONUS_PERCENT}% — и видеть свои записи.
          </p>
          <div className="flex justify-center">
            <VkLoginButton />
          </div>
          <button onClick={() => onNavigate('/')} className="text-sm text-text-muted hover:text-text-main">
            Вернуться на главную
          </button>
        </div>
      </div>
    );
  }

  const upcoming = bookings.filter((booking) => booking.status === 'pending' || booking.status === 'confirmed');
  const past = bookings.filter((booking) => !upcoming.includes(booking));

  const cancel = async (id: number) => {
    setBusyId(id);
    setError('');
    try {
      await api.cancelMyBooking(id);
      await Promise.all([load(), refresh()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const savePhone = async () => {
    setError('');
    try {
      await api.savePhone(phone);
      await refresh();
      setPhoneSaved(true);
      setTimeout(() => setPhoneSaved(false), 3000);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="pt-32 pb-24">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
        <SectionHeading title={`Привет, ${user.firstName}!`} />

        {error && <ErrorNote>{error}</ErrorNote>}

        {/* Кабинет мастера — только для закреплённых аккаунтов */}
        {user.masterId && config && (
          <MasterSchedule today={config.today} masterName={user.masterName ?? user.firstName} />
        )}

        {/* Накопленная скидка */}
        <section className="rounded-3xl border border-orange-500/30 bg-gradient-to-br from-orange-500/10 to-transparent p-6 sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-text-muted text-sm mb-1">Накопленная скидка</p>
              <p className="text-6xl font-black tracking-tighter text-orange-500">{user.bonusPercent}%</p>
            </div>
            <p className="text-text-muted text-sm">
              {user.visitsCount} {plural(user.visitsCount, 'визит', 'визита', 'визитов')} в ВАЙБ
            </p>
          </div>

          <div className="mt-6 h-3 rounded-full bg-badge overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-orange-500 to-red-500 transition-[width] duration-700"
              style={{ width: `${(user.bonusPercent / MAX_BONUS_PERCENT) * 100}%` }}
            />
          </div>

          <p className="mt-3 text-sm text-text-muted">
            {user.bonusPercent >= MAX_BONUS_PERCENT
              ? 'Максимум накоплен — следующая стрижка может быть бесплатной.'
              : `До ${MAX_BONUS_PERCENT}% осталось ${MAX_BONUS_PERCENT - user.bonusPercent} ${plural(
                  MAX_BONUS_PERCENT - user.bonusPercent,
                  'визит',
                  'визита',
                  'визитов',
                )}. Списать можно целиком или частями при записи.`}
          </p>
        </section>

        {/* Уведомления в ВК */}
        {config?.vkBotEnabled && !user.vkMessagesAllowed && config.communityChatUrl && (
          <section className="rounded-3xl border border-border bg-surface p-6 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <div className="flex items-start gap-3">
              <Bell className="w-5 h-5 text-orange-500 shrink-0 mt-1" />
              <div>
                <p className="font-bold">Включите уведомления от нашего сообщества</p>
                <p className="text-sm text-text-muted">
                  Будем присылать подтверждение записи и напоминание перед визитом.
                </p>
              </div>
            </div>
            <a
              href={config.communityChatUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-xl bg-[#0077FF] px-5 py-3 font-bold text-white text-center"
            >
              Разрешить сообщения
            </a>
          </section>
        )}

        {/* Телефон */}
        <section className="rounded-3xl border border-border bg-surface p-6">
          <p className="font-bold flex items-center gap-2 mb-3">
            <Phone className="w-4 h-4 text-orange-500" /> Телефон для связи
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(formatPhone(event.target.value))}
              placeholder="+7 (999) 000-00-00"
              className="flex-1 bg-bg-main border border-border rounded-xl px-4 py-3 focus:outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all"
            />
            <Button variant="ghost" onClick={() => void savePhone()}>
              {phoneSaved ? 'Сохранено' : 'Сохранить'}
            </Button>
          </div>
        </section>

        {/* Записи */}
        <section>
          <h2 className="text-xl font-black uppercase tracking-tight mb-4 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-orange-500" /> Ближайшие записи
          </h2>

          {loading ? (
            <div className="flex items-center gap-2 text-text-muted">
              <Spinner /> Загружаем…
            </div>
          ) : upcoming.length ? (
            <div className="space-y-3">
              {upcoming.map((booking) => (
                <article
                  key={booking.id}
                  className="rounded-2xl border border-border bg-surface p-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-lg font-bold">{formatDateFull(booking.date)}</span>
                      <StatusBadge status={booking.status} />
                    </div>
                    <p className="text-text-muted">
                      {booking.time}–{booking.endTime} · {booking.service} · {booking.masterName}
                    </p>
                    {booking.finalPrice !== null && (
                      <p className="text-sm">
                        <span className="font-bold text-orange-500">{booking.finalPrice}р</span>
                        {booking.discountPercent > 0 && (
                          <span className="text-text-muted"> · списываем {booking.discountPercent}%</span>
                        )}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="danger"
                    loading={busyId === booking.id}
                    onClick={() => void cancel(booking.id)}
                    className="shrink-0"
                  >
                    Отменить
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center space-y-4">
              <p className="text-text-muted">Активных записей нет.</p>
              <Button onClick={() => onNavigate('/')}>Записаться</Button>
            </div>
          )}
        </section>

        {/* История визитов */}
        {past.length > 0 && (
          <section>
            <h2 className="text-xl font-black uppercase tracking-tight mb-4 flex items-center gap-2">
              <Scissors className="w-5 h-5 text-orange-500" /> История визитов
            </h2>
            <div className="space-y-2">
              {past.map((booking) => (
                <div
                  key={booking.id}
                  className="rounded-2xl border border-border bg-surface px-5 py-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <p className="font-medium">
                      {formatDate(booking.date)} · {booking.service}
                    </p>
                    <p className="text-sm text-text-muted">
                      {booking.masterName} · {formatDuration(booking.durationMinutes)}
                      {booking.finalPrice !== null && ` · ${booking.finalPrice}р`}
                    </p>
                  </div>
                  <StatusBadge status={booking.status} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Движение процентов */}
        {history.length > 0 && (
          <section>
            <h2 className="text-xl font-black uppercase tracking-tight mb-4 flex items-center gap-2">
              <History className="w-5 h-5 text-orange-500" /> Движение скидки
            </h2>
            <div className="rounded-2xl border border-border bg-surface divide-y divide-border">
              {history.map((item) => (
                <div key={item.id} className="px-5 py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate">{item.reason}</p>
                    <p className="text-xs text-text-muted">{formatTimestamp(item.createdAt)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`font-black ${item.delta > 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                      {item.delta > 0 ? '+' : ''}
                      {item.delta}%
                    </span>
                    <p className="text-xs text-text-muted">стало {item.balanceAfter}%</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
