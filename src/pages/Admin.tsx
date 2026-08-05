import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, LogOut, Search, Users, XCircle } from 'lucide-react';
import { applyDiscount } from '../../shared/catalog';
import type { AdminBookingView, BonusTransactionView } from '../../shared/types';
import { api, type AdminClient } from '../api';
import { DateStrip } from '../components/DateStrip';
import { Button, ErrorNote, Spinner, StatusBadge, inputClass } from '../components/ui';
import { formatDate, formatDateFull, formatTimestamp } from '../lib/format';

type Tab = 'day' | 'pending' | 'upcoming' | 'clients';

const TABS: { id: Tab; label: string }[] = [
  { id: 'pending', label: 'Ждут подтверждения' },
  { id: 'day', label: 'На день' },
  { id: 'upcoming', label: 'Все предстоящие' },
  { id: 'clients', label: 'Клиенты' },
];

export function Admin({ today }: { today: string }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    api.admin
      .session()
      .then((response) => {
        setAuthenticated(response.authenticated);
        setEnabled(response.enabled);
      })
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) {
    return (
      <div className="pt-40 flex justify-center text-text-muted">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  if (!authenticated) {
    return <AdminLogin enabled={enabled} onSuccess={() => setAuthenticated(true)} />;
  }

  return <AdminPanel today={today} onLogout={() => setAuthenticated(false)} />;
}

function AdminLogin({ enabled, onSuccess }: { enabled: boolean; onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.admin.login(password);
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pt-36 pb-24 px-4">
      <form onSubmit={submit} className="max-w-sm mx-auto rounded-3xl border border-border bg-surface p-8 space-y-5">
        <h1 className="text-2xl font-black tracking-tighter uppercase text-center">Панель управления</h1>

        {!enabled ? (
          <ErrorNote>
            Пароль администратора не задан на сервере. Добавьте ADMIN_PASSWORD в .env и перезапустите сервер.
          </ErrorNote>
        ) : (
          <>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Пароль"
              autoFocus
              className={inputClass}
              required
            />
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button type="submit" loading={loading} className="w-full">
              Войти
            </Button>
          </>
        )}
      </form>
    </div>
  );
}

function AdminPanel({ today, onLogout }: { today: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('pending');
  const [date, setDate] = useState(today);
  const [bookings, setBookings] = useState<AdminBookingView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (tab === 'clients') return;
    setLoading(true);
    setError('');
    try {
      const response = await api.admin.bookings({ scope: tab, date: tab === 'day' ? date : undefined });
      setBookings(response.bookings);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tab, date]);

  useEffect(() => {
    void load();
  }, [load]);

  const logout = async () => {
    await api.admin.logout();
    onLogout();
  };

  return (
    <div className="pt-28 pb-24">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-black tracking-tighter uppercase">Панель управления</h1>
          <Button variant="ghost" onClick={() => void logout()}>
            <LogOut className="w-4 h-4" /> Выйти
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                tab === item.id
                  ? 'border-orange-500 bg-orange-500 text-white'
                  : 'border-border bg-surface text-text-muted hover:text-text-main'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        {tab === 'clients' ? (
          <ClientsTab />
        ) : (
          <>
            {tab === 'day' && (
              <div className="space-y-2">
                <DateStrip today={today} value={date} onChange={setDate} days={21} />
                <p className="text-sm text-text-muted">{formatDateFull(date)}</p>
              </div>
            )}

            {loading ? (
              <div className="flex items-center gap-2 text-text-muted py-10">
                <Spinner /> Загружаем записи…
              </div>
            ) : bookings.length ? (
              <div className="space-y-3">
                {bookings.map((booking) => (
                  <BookingCard key={booking.id} booking={booking} onChanged={load} onError={setError} />
                ))}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-border p-10 text-center text-text-muted">
                Записей нет.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BookingCard({
  booking,
  onChanged,
  onError,
}: {
  booking: AdminBookingView;
  onChanged: () => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [completing, setCompleting] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await onChanged();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const active = booking.status === 'pending' || booking.status === 'confirmed';

  return (
    <article className="rounded-2xl border border-border bg-surface p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-lg font-bold">
              {formatDate(booking.date)}, {booking.time}–{booking.endTime}
            </span>
            <StatusBadge status={booking.status} />
          </div>
          <p className="text-text-muted">
            {booking.service} · {booking.masterName}
          </p>
          <p className="text-sm">
            {booking.clientName} ·{' '}
            <a href={`tel:${booking.clientPhone.replace(/\D/g, '')}`} className="hover:text-orange-500">
              {booking.clientPhone}
            </a>
            {booking.vkId && (
              <>
                {' · '}
                <a
                  href={`https://vk.com/id${booking.vkId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#0077FF] hover:underline"
                >
                  ВКонтакте
                </a>
              </>
            )}
            {!booking.userId && <span className="text-text-muted"> · гость</span>}
          </p>
        </div>

        <div className="text-right">
          <p className="text-2xl font-black text-orange-500">
            {booking.finalPrice !== null ? `${booking.finalPrice}р` : 'цена на месте'}
          </p>
          {booking.discountPercent > 0 && (
            <p className="text-sm text-text-muted">
              скидка {booking.discountPercent}%
              {booking.status !== 'completed' && ' (в резерве)'}
            </p>
          )}
          {booking.userBonusPercent !== null && (
            <p className="text-xs text-text-muted">на счету клиента: {booking.userBonusPercent}%</p>
          )}
        </div>
      </div>

      {active && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {booking.status === 'pending' && (
            <Button variant="ghost" loading={busy} onClick={() => void run(() => api.admin.confirm(booking.id))}>
              <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Подтвердить
            </Button>
          )}
          <Button onClick={() => setCompleting((value) => !value)} disabled={busy}>
            Визит состоялся
          </Button>
          <Button variant="ghost" loading={busy} onClick={() => void run(() => api.admin.noShow(booking.id))}>
            Не пришёл
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void run(() => api.admin.cancel(booking.id))}>
            <XCircle className="w-4 h-4" /> Отменить
          </Button>
        </div>
      )}

      {completing && (
        <CompleteForm
          booking={booking}
          onCancel={() => setCompleting(false)}
          onSubmit={async (writeOff, finalPrice) => {
            await run(() => api.admin.complete(booking.id, writeOff, finalPrice));
            setCompleting(false);
          }}
        />
      )}
    </article>
  );
}

/** Здесь администратор фиксирует, сколько процентов реально списано. */
function CompleteForm({
  booking,
  onCancel,
  onSubmit,
}: {
  booking: AdminBookingView;
  onCancel: () => void;
  onSubmit: (writeOffPercent: number, finalPrice: number | null) => Promise<void>;
}) {
  const maxWriteOff = booking.discountPercent + (booking.userBonusPercent ?? 0);
  const [writeOff, setWriteOff] = useState(booking.discountPercent);
  const [price, setPrice] = useState<string>(
    booking.basePrice !== null ? String(applyDiscount(booking.basePrice, booking.discountPercent)) : '',
  );
  const [saving, setSaving] = useState(false);

  // Пока администратор двигает процент, сумма пересчитывается по прайсу.
  useEffect(() => {
    if (booking.basePrice === null) return;
    setPrice(String(applyDiscount(booking.basePrice, writeOff)));
  }, [writeOff, booking.basePrice]);

  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit(writeOff, price === '' ? null : Number(price));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-orange-500/30 bg-orange-500/5 p-5 space-y-4">
      <p className="font-bold">Завершение визита</p>

      {booking.userId ? (
        <>
          <label className="block space-y-2">
            <span className="text-sm text-text-muted">
              Списать скидку: <span className="font-bold text-orange-500">{writeOff}%</span> из доступных{' '}
              {maxWriteOff}%
            </span>
            <input
              type="range"
              min={0}
              max={maxWriteOff}
              value={writeOff}
              onChange={(event) => setWriteOff(Number(event.target.value))}
              className="w-full accent-orange-500"
            />
          </label>
          <p className="text-xs text-text-muted">
            Клиент заявил {booking.discountPercent}%. Неиспользованный остаток вернётся на его счёт, а за
            визит начислится 1%.
          </p>
        </>
      ) : (
        <p className="text-sm text-text-muted">Гостевая запись — накопительная скидка не применяется.</p>
      )}

      <label className="block space-y-2">
        <span className="text-sm text-text-muted">Итоговая сумма, ₽</span>
        <input
          type="number"
          min={0}
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          placeholder="Например, 600"
          className={inputClass}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button loading={saving} onClick={() => void submit()}>
          {booking.userId ? 'Завершить и начислить 1%' : 'Завершить визит'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

function ClientsTab() {
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.admin.clients(query);
      setClients(response.clients);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  // Поиск с задержкой, чтобы не дёргать сервер на каждую букву.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 300);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Имя, телефон или id ВКонтакте"
          className={`${inputClass} pl-11`}
        />
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading ? (
        <div className="flex items-center gap-2 text-text-muted py-8">
          <Spinner /> Ищем…
        </div>
      ) : clients.length ? (
        <div className="space-y-2">
          {clients.map((client) => (
            <div key={client.id} className="rounded-2xl border border-border bg-surface">
              <button
                onClick={() => setOpenId(openId === client.id ? null : client.id)}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <div className="min-w-0">
                  <p className="font-bold truncate">{client.name || 'Без имени'}</p>
                  <p className="text-sm text-text-muted truncate">
                    {client.phone ?? 'телефон не указан'}
                    {client.vkId && ` · vk.com/id${client.vkId}`}
                  </p>
                </div>
                <span className="shrink-0 text-2xl font-black text-orange-500">{client.bonusPercent}%</span>
              </button>

              {openId === client.id && <ClientDetails id={client.id} onChanged={load} />}
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-border p-10 text-center text-text-muted">
          <Users className="w-6 h-6 mx-auto mb-2" />
          Клиентов пока нет. Они появятся после первого входа через ВКонтакте.
        </p>
      )}
    </div>
  );
}

function ClientDetails({ id, onChanged }: { id: number; onChanged: () => Promise<void> | void }) {
  const [data, setData] = useState<{
    bookings: AdminBookingView[];
    bonusHistory: BonusTransactionView[];
  } | null>(null);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await api.admin.client(id);
    setData({ bookings: response.bookings, bonusHistory: response.bonusHistory });
  }, [id]);

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message));
  }, [load]);

  const adjust = async () => {
    setSaving(true);
    setError('');
    try {
      await api.admin.adjustBonus(id, Number(delta), reason);
      setDelta('');
      setReason('');
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!data) {
    return (
      <div className="border-t border-border px-5 py-4 flex items-center gap-2 text-text-muted">
        <Spinner /> Загружаем карточку…
      </div>
    );
  }

  return (
    <div className="border-t border-border px-5 py-5 space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-bold uppercase tracking-wide text-text-muted">Ручная корректировка скидки</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="number"
            value={delta}
            onChange={(event) => setDelta(event.target.value)}
            placeholder="+5 или -10"
            className={`${inputClass} sm:w-32`}
          />
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Причина — попадёт в историю клиента"
            className={inputClass}
          />
          <Button loading={saving} onClick={() => void adjust()} disabled={!delta || reason.length < 3}>
            Применить
          </Button>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>

      {data.bonusHistory.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-bold uppercase tracking-wide text-text-muted">Движение процентов</p>
          {data.bonusHistory.slice(0, 10).map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-text-muted">
                {formatTimestamp(item.createdAt)} — {item.reason}
              </span>
              <span className={`font-bold shrink-0 ${item.delta > 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                {item.delta > 0 ? '+' : ''}
                {item.delta}%
              </span>
            </div>
          ))}
        </div>
      )}

      {data.bookings.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-bold uppercase tracking-wide text-text-muted">Последние записи</p>
          {data.bookings.slice(0, 10).map((booking) => (
            <div key={booking.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-text-muted">
                {formatDate(booking.date)} {booking.time} — {booking.service}
              </span>
              <StatusBadge status={booking.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
