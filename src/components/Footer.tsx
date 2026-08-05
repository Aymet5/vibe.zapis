import { Clock, MapPin, Percent, Phone } from 'lucide-react';
import { useSession } from '../lib/session';

export function Footer({ onNavigate, onBook }: { onNavigate: (to: string) => void; onBook: () => void }) {
  const { config } = useSession();

  return (
    <footer className="border-t border-border bg-bg-main py-12 pb-28 sm:pb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <div className="text-3xl font-black tracking-tighter text-orange-500 mb-4">ВАЙБ.</div>
            <p className="text-text-muted text-sm max-w-xs">
              Мы верим, что хорошая прическа — это не просто стрижка, это уверенность в себе и правильный
              настрой на весь день.
            </p>
            <p className="mt-4 flex items-start gap-2 text-sm text-text-subtle">
              <Percent className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
              1% скидки за каждый визит, до 100% на одну стрижку
            </p>
          </div>

          <div className="flex flex-col gap-4 md:items-center">
            <div className="flex items-center gap-3 text-text-subtle">
              <Phone className="w-5 h-5 text-orange-500" />
              <a href="tel:+79991792895" className="hover:text-text-main transition-colors">
                +7 (999) 179-28-95
              </a>
            </div>
            <div className="flex items-center gap-3 text-text-subtle">
              <MapPin className="w-5 h-5 text-orange-500" />
              <span>ТД «5 Звёзд» 1 этаж, г. Кызыл</span>
            </div>
            <div className="flex items-center gap-3 text-text-subtle">
              <Clock className="w-5 h-5 text-orange-500" />
              <span>Ежедневно 09:00 — 19:00</span>
            </div>
          </div>

          <div className="flex flex-col gap-3 md:items-end">
            <button
              onClick={onBook}
              className="px-6 py-3 bg-surface hover:bg-surface-hover border border-border rounded-xl text-sm font-medium transition-colors"
            >
              Записаться онлайн
            </button>
            <button
              onClick={() => onNavigate('/profile')}
              className="px-6 py-3 text-sm text-text-muted hover:text-text-main transition-colors"
            >
              Личный кабинет
            </button>
            {config?.adminEnabled && (
              <button
                onClick={() => onNavigate('/admin')}
                className="px-6 py-1 text-xs text-text-muted/60 hover:text-text-muted transition-colors"
              >
                Вход для персонала
              </button>
            )}
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between text-xs text-text-muted">
          <p>© {new Date().getFullYear()} ВАЙБ. Все права защищены.</p>
          <p className="mt-2 sm:mt-0">Разработано с душой</p>
        </div>
      </div>
    </footer>
  );
}
