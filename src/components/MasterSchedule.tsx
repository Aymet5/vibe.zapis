import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Phone, Scissors } from 'lucide-react';
import type { BookingView } from '../../shared/types';
import { api } from '../api';
import { formatDateFull } from '../lib/format';
import { DateStrip } from './DateStrip';
import { ErrorNote, SectionHeading, Spinner, StatusBadge } from './ui';

type Scope = 'day' | 'upcoming';

/**
 * Кабинет мастера: свои записи и контакты клиентов.
 * Виден только тем, чей аккаунт ВК администратор закрепил за мастером.
 */
export function MasterSchedule({ today, masterName }: { today: string; masterName: string }) {
  const [scope, setScope] = useState<Scope>('day');
  const [date, setDate] = useState(today);
  const [bookings, setBookings] = useState<BookingView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.masterBookings({ scope, date: scope === 'day' ? date : undefined });
      setBookings(response.bookings);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [scope, date]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-4">
      <SectionHeading title={`Записи к вам, ${masterName}`} />

      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: 'day', label: 'На день' },
            { id: 'upcoming', label: 'Все предстоящие' },
          ] as { id: Scope; label: string }[]
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setScope(item.id)}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              scope === item.id
                ? 'border-orange-500 bg-orange-500 text-white'
                : 'border-border bg-surface text-text-muted hover:text-text-main'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {scope === 'day' && (
        <div className="space-y-2">
          <DateStrip today={today} value={date} onChange={setDate} days={21} />
          <p className="text-sm text-text-muted">{formatDateFull(date)}</p>
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading ? (
        <div className="flex items-center gap-2 text-text-muted py-8">
          <Spinner /> Загружаем записи…
        </div>
      ) : bookings.length ? (
        <div className="space-y-3">
          {bookings.map((booking) => (
            <div key={booking.id} className="rounded-2xl border border-border bg-surface p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <CalendarDays className="w-5 h-5 text-orange-500 shrink-0" />
                  <div>
                    <p className="font-bold">
                      {booking.time}–{booking.endTime}
                    </p>
                    {scope === 'upcoming' && (
                      <p className="text-sm text-text-muted">{formatDateFull(booking.date)}</p>
                    )}
                  </div>
                </div>
                <StatusBadge status={booking.status} />
              </div>

              <p className="flex items-center gap-2 text-sm">
                <Scissors className="w-4 h-4 text-text-muted shrink-0" />
                {booking.service}
                {booking.finalPrice !== null && (
                  <span className="text-text-muted">· {booking.finalPrice}р</span>
                )}
              </p>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-medium">{booking.clientName}</span>
                <a
                  href={`tel:${booking.clientPhone.replace(/\D/g, '')}`}
                  className="flex items-center gap-2 text-orange-500 hover:underline"
                >
                  <Phone className="w-4 h-4" />
                  {booking.clientPhone}
                </a>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-text-muted">
          {scope === 'day' ? 'На этот день записей нет.' : 'Предстоящих записей нет.'}
        </p>
      )}
    </section>
  );
}
