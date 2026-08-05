import { useEffect, useState } from 'react';
import { CalendarClock, Scissors } from 'lucide-react';
import { CATEGORIES, SCHEDULE, type CategoryId } from '../../shared/catalog';
import { api, type ScheduleResponse } from '../api';
import { formatDateFull } from '../lib/format';
import { DateStrip } from './DateStrip';
import { ErrorNote, SectionHeading, Spinner } from './ui';

interface ScheduleBoardProps {
  today: string;
  onPick: (masterId: string, date: string, time: string) => void;
}

/**
 * Открытая витрина расписания: видно, у кого какие окошки свободны,
 * без входа и без заполнения формы. Сетка построена под обычную стрижку
 * (30 минут) — для окрашивания время подбирается уже в форме записи.
 */
export function ScheduleBoard({ today, onPick }: ScheduleBoardProps) {
  const [date, setDate] = useState(today);
  const [category, setCategory] = useState<CategoryId | 'all'>('all');
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    api
      .schedule(date, category === 'all' ? undefined : category)
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [date, category]);

  return (
    <section id="schedule" className="py-20 border-t border-border relative">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          title="Свободные окошки"
          subtitle={`Обычная стрижка занимает ${SCHEDULE.stepMinutes} минут. Нажмите на время — оно подставится в форму записи.`}
        />

        <div className="space-y-6">
          <DateStrip today={today} value={date} onChange={setDate} days={SCHEDULE.bookingHorizonDays > 14 ? 14 : SCHEDULE.bookingHorizonDays} />

          <div className="flex flex-wrap gap-2">
            {[{ id: 'all' as const, label: 'Все мастера' }, ...CATEGORIES].map((item) => (
              <button
                key={item.id}
                onClick={() => setCategory(item.id as CategoryId | 'all')}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                  category === item.id
                    ? 'border-orange-500 bg-orange-500/10 text-orange-500'
                    : 'border-border bg-surface text-text-muted hover:text-text-main'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-text-muted text-sm">
            <CalendarClock className="w-4 h-4 text-orange-500" />
            {formatDateFull(date)}
          </div>

          {error && <ErrorNote>{error}</ErrorNote>}

          {loading ? (
            <div className="flex items-center gap-2 text-text-muted py-10">
              <Spinner /> Загружаем расписание…
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {data?.masters.map(({ master, slots }) => {
                const free = slots.filter((slot) => slot.available);
                return (
                  <div key={master.id} className="rounded-3xl border border-border bg-surface p-5">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div>
                        <h3 className="text-lg font-bold">{master.name}</h3>
                        <p className="text-sm text-text-muted">{master.role}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${
                          free.length
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                            : 'border-border bg-badge text-text-muted'
                        }`}
                      >
                        {free.length ? `свободно ${free.length}` : 'занят'}
                      </span>
                    </div>

                    {free.length ? (
                      <div className="flex flex-wrap gap-2">
                        {free.map((slot) => (
                          <button
                            key={slot.time}
                            onClick={() => onPick(master.id, date, slot.time)}
                            className="rounded-lg border border-border bg-bg-main px-3 py-1.5 text-sm font-bold
                              hover:border-orange-500 hover:text-orange-500 transition-colors
                              focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30"
                          >
                            {slot.time}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="flex items-center gap-2 text-sm text-text-muted">
                        <Scissors className="w-4 h-4" />
                        Все окошки заняты — посмотрите другой день
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
