import { Spinner } from './ui';

interface SlotGridProps {
  slots: { time: string; available: boolean }[];
  value: string;
  onChange: (time: string) => void;
  loading?: boolean;
  emptyText?: string;
}

/** Сетка окошек: занятые видно, но нажать нельзя — так понятнее, чем прятать. */
export function SlotGrid({ slots, value, onChange, loading, emptyText }: SlotGridProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-text-muted py-6">
        <Spinner /> Смотрим свободное время…
      </div>
    );
  }

  const free = slots.filter((slot) => slot.available).length;

  if (!slots.length || free === 0) {
    return (
      <p className="rounded-2xl border border-border bg-surface px-4 py-6 text-center text-text-muted">
        {emptyText ?? 'На этот день свободных окошек нет. Выберите другой день или мастера.'}
      </p>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
        {slots.map((slot) => {
          const selected = slot.time === value;
          return (
            <button
              key={slot.time}
              type="button"
              disabled={!slot.available}
              onClick={() => onChange(slot.time)}
              aria-pressed={selected}
              className={`rounded-xl border py-2.5 text-sm font-bold transition-all
                focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30 ${
                  selected
                    ? 'border-orange-500 bg-orange-500 text-white'
                    : slot.available
                      ? 'border-border bg-surface hover:bg-surface-hover hover:border-orange-500/50 text-text-main'
                      : 'border-transparent bg-badge text-text-muted/40 line-through cursor-not-allowed'
                }`}
            >
              {slot.time}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-text-muted">Свободно окошек: {free}</p>
    </div>
  );
}
