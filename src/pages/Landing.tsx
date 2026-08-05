import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Percent, Phone, Scissors, Sparkles } from 'lucide-react';
import {
  BONUS_PER_VISIT,
  CATEGORIES,
  MASTERS,
  MAX_BONUS_PERCENT,
  SERVICES,
  formatPrice,
  type CategoryId,
} from '../../shared/catalog';
import { BookingForm, type BookingPreset } from '../components/BookingForm';
import { ScheduleBoard } from '../components/ScheduleBoard';
import { SectionHeading } from '../components/ui';
import { formatDuration } from '../lib/format';
import { useSession } from '../lib/session';

function scrollToBooking() {
  document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' });
}

export function Landing({ today }: { today: string }) {
  const { user, config } = useSession();
  // Фотографии приходят с сервера; пока конфиг не загрузился — карточки из каталога.
  const masters = config?.masters ?? MASTERS.map((master) => ({ ...master, photo: null }));
  const [activeTab, setActiveTab] = useState<CategoryId>('mens');
  const [preset, setPreset] = useState<BookingPreset | null>(null);

  // Каждый выбор — новый объект, иначе повторный клик по той же карточке не сработает.
  const applyPreset = useCallback((next: BookingPreset) => {
    setPreset({ ...next });
    scrollToBooking();
  }, []);

  return (
    <>
      {/* Первый экран */}
      <section className="relative pt-32 pb-20 lg:pt-44 lg:pb-28 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-orange-500/15 rounded-full blur-[150px] pointer-events-none" />
        <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-red-500/10 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className="inline-block mb-8 px-5 py-2 rounded-full border border-orange-500/30 bg-orange-500/10 text-orange-500 text-sm font-semibold tracking-widest"
          >
            ОНЛАЙН-ЗАПИСЬ ОТКРЫТА
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-5xl sm:text-7xl lg:text-8xl font-black tracking-tighter leading-[0.9] uppercase"
          >
            Точная стрижка. <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-red-500">
              Уверенный
            </span>
            <br />
            вайб.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mt-8 text-lg sm:text-xl text-text-muted max-w-2xl mx-auto font-medium"
          >
            Качественная работа, внимание к деталям и атмосфера, в которую хочется возвращаться.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.4 }}
            className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-6"
          >
            <button
              onClick={scrollToBooking}
              className="px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-full text-lg font-bold transition-all shadow-[0_0_40px_-10px_rgba(249,115,22,0.5)] hover:shadow-[0_0_60px_-15px_rgba(249,115,22,0.6)] hover:scale-105"
            >
              Записаться онлайн
            </button>
            <div className="flex items-center gap-4 text-text-subtle">
              <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center border border-border">
                <Phone className="w-5 h-5 text-orange-500" />
              </div>
              <div className="text-left">
                <div className="text-sm text-text-muted">Или по телефону</div>
                <a href="tel:+79991792895" className="text-lg font-bold tracking-wide hover:text-orange-500 transition-colors">
                  +7 (999) 179-28-95
                </a>
              </div>
            </div>
          </motion.div>

          {/* Программа лояльности — главное новое обещание, поэтому на первом экране */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.55 }}
            className="mt-14 mx-auto max-w-2xl rounded-3xl border border-border bg-surface/60 backdrop-blur px-6 py-5 flex flex-col sm:flex-row items-center gap-4 text-left"
          >
            <span className="w-12 h-12 shrink-0 rounded-2xl bg-orange-500/15 flex items-center justify-center">
              <Percent className="w-6 h-6 text-orange-500" />
            </span>
            <p className="text-text-subtle">
              <span className="font-bold text-text-main">Копите скидку:</span> {BONUS_PER_VISIT}% за каждый
              визит, до {MAX_BONUS_PERCENT}%.
              Накопленное можно потратить на одну стрижку — целиком или частями.
              {user && (
                <span className="block mt-1 text-orange-500 font-bold">
                  У вас сейчас {user.bonusPercent}%
                </span>
              )}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Мастера */}
      <section className="py-20 border-t border-border relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading title="Наши мастера" />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {masters.map((master, index) => (
              <motion.button
                key={master.id}
                type="button"
                onClick={() =>
                  applyPreset({
                    masterId: master.id,
                    category: master.categories.includes(activeTab) ? activeTab : master.categories[0],
                  })
                }
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.08 }}
                className="group relative text-left rounded-3xl p-8 bg-surface border border-border hover:border-orange-500/50 transition-all duration-500 hover:bg-surface-hover overflow-hidden focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30"
              >
                <div className="absolute -right-10 -top-10 w-40 h-40 bg-orange-500/10 rounded-full blur-[40px] group-hover:bg-orange-500/30 transition-colors duration-500" />

                <div className="relative z-10 flex items-start justify-between">
                  <div>
                    {master.photo ? (
                      <img
                        src={master.photo}
                        alt={master.name}
                        loading="lazy"
                        className="w-24 h-24 rounded-2xl object-cover border border-border mb-4 group-hover:border-orange-500/50 transition-colors duration-500"
                      />
                    ) : (
                      <div className="text-6xl font-black text-watermark mb-4 group-hover:text-orange-500/10 transition-colors duration-500">
                        {master.name.charAt(0)}
                      </div>
                    )}
                    <h3 className="text-2xl font-bold mb-1 group-hover:text-orange-500 transition-colors">
                      {master.name}
                    </h3>
                    <p className="text-text-muted font-medium">{master.role}</p>
                  </div>
                  <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center border border-border group-hover:border-orange-500/50 group-hover:bg-orange-500/10 transition-all duration-500 group-hover:scale-110 group-hover:rotate-12">
                    <Scissors className="w-5 h-5 text-text-muted group-hover:text-orange-500 transition-colors duration-500" />
                  </div>
                </div>

                <div className="mt-12 flex flex-wrap gap-2 relative z-10">
                  {master.categories.map((categoryId) => (
                    <span
                      key={categoryId}
                      className="text-xs px-3 py-1.5 rounded-full bg-badge border border-border-light text-text-muted group-hover:border-border transition-colors"
                    >
                      {CATEGORIES.find((item) => item.id === categoryId)?.label}
                    </span>
                  ))}
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      </section>

      {/* Услуги */}
      <section className="py-20 border-t border-border relative bg-surface">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading title="Услуги и цены" />

          <div className="flex overflow-x-auto no-scrollbar gap-2 p-1 bg-surface rounded-2xl mb-8 border border-border">
            {CATEGORIES.map((category) => (
              <button
                key={category.id}
                onClick={() => setActiveTab(category.id)}
                className={`flex-1 min-w-[120px] py-3 px-4 rounded-xl text-sm font-medium transition-all ${
                  activeTab === category.id
                    ? 'bg-orange-500 text-white shadow-lg'
                    : 'text-text-muted hover:text-text-main hover:bg-surface-hover'
                }`}
              >
                {category.label}
              </button>
            ))}
          </div>

          <div className="bg-surface border border-border rounded-3xl p-4 sm:p-6 backdrop-blur-sm">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-1"
              >
                {SERVICES[activeTab].map((service) => (
                  <button
                    key={service.name}
                    type="button"
                    onClick={() => applyPreset({ category: activeTab, service: service.name })}
                    className="w-full flex items-center justify-between gap-4 group p-3 hover:bg-surface-hover rounded-2xl transition-colors text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30"
                  >
                    <span className="flex items-center gap-4 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500/50 group-hover:bg-orange-500 group-hover:scale-150 transition-all shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-lg font-medium text-text-subtle group-hover:text-text-main transition-colors truncate">
                          {service.name}
                        </span>
                        <span className="block text-xs text-text-muted">{formatDuration(service.duration)}</span>
                      </span>
                    </span>
                    <span className="text-lg font-bold text-orange-500 whitespace-nowrap bg-orange-500/10 px-4 py-1 rounded-full">
                      {formatPrice(service)}
                    </span>
                  </button>
                ))}
              </motion.div>
            </AnimatePresence>

            <p className="mt-4 flex items-center gap-2 px-3 text-sm text-text-muted">
              <Sparkles className="w-4 h-4 text-orange-500" />
              Нажмите на услугу — она подставится в форму записи
            </p>
          </div>
        </div>
      </section>

      <ScheduleBoard
        today={today}
        onPick={(masterId, date, time) => applyPreset({ masterId, date, time })}
      />

      <BookingForm today={today} preset={preset} onBooked={() => setPreset(null)} />
    </>
  );
}
