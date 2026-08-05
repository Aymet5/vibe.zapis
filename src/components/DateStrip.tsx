import { addDays, dayNumber, isWeekend, weekdayShort } from '../lib/format';

interface DateStripProps {
  today: string;
  value: string;
  onChange: (date: string) => void;
  days?: number;
}

/**
 * Лента ближайших дней вместо поля «дата»: выбрать день в два тапа
 * быстрее, чем открывать системный календарь.
 */
export function DateStrip({ today, value, onChange, days = 14 }: DateStripProps) {
  const dates = Array.from({ length: days }, (_, index) => addDays(today, index));

  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
      {dates.map((date, index) => {
        const selected = date === value;
        return (
          <button
            key={date}
            type="button"
            onClick={() => onChange(date)}
            aria-pressed={selected}
            className={`shrink-0 w-16 rounded-2xl border px-2 py-3 text-center transition-all
              focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30 ${
                selected
                  ? 'border-orange-500 bg-orange-500 text-white shadow-[0_0_20px_-6px_rgba(249,115,22,0.7)]'
                  : 'border-border bg-surface hover:bg-surface-hover text-text-main'
              }`}
          >
            <span
              className={`block text-[11px] font-medium uppercase ${
                selected ? 'text-white/80' : isWeekend(date) ? 'text-orange-500' : 'text-text-muted'
              }`}
            >
              {index === 0 ? 'сегодня' : weekdayShort(date)}
            </span>
            <span className="block text-xl font-black leading-tight">{dayNumber(date)}</span>
          </button>
        );
      })}
    </div>
  );
}
