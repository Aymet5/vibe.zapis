import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Clock, Percent, Phone, Scissors, User } from 'lucide-react';
import {
  CATEGORIES,
  MASTERS,
  SERVICES,
  applyDiscount,
  findService,
  formatPrice,
  type CategoryId,
} from '../../shared/catalog';
import { api } from '../api';
import { formatDuration, formatPhone } from '../lib/format';
import { useSession } from '../lib/session';
import { DateStrip } from './DateStrip';
import { SlotGrid } from './SlotGrid';
import { VkLoginButton } from './VkLoginButton';
import { Button, ErrorNote, Field, SectionHeading, inputClass } from './ui';

export interface BookingPreset {
  category?: CategoryId;
  service?: string;
  masterId?: string;
  date?: string;
  time?: string;
}

interface BookingFormProps {
  today: string;
  preset: BookingPreset | null;
  onBooked: () => void;
}

export function BookingForm({ today, preset, onBooked }: BookingFormProps) {
  const { user, config, refresh } = useSession();

  const [category, setCategory] = useState<CategoryId>('mens');
  const [service, setService] = useState('');
  const [masterId, setMasterId] = useState('');
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [discount, setDiscount] = useState(0);

  const [slots, setSlots] = useState<{ time: string; available: boolean }[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Имя и телефон подставляем из профиля, но оставляем редактируемыми:
  // клиент может записывать не себя.
  useEffect(() => {
    if (!user) return;
    setName((current) => current || `${user.firstName} ${user.lastName}`.trim());
    setPhone((current) => current || (user.phone ? formatPhone(user.phone) : ''));
  }, [user]);

  // Внешний выбор — клик по мастеру, услуге или свободному окошку.
  useEffect(() => {
    if (!preset) return;
    if (preset.category) setCategory(preset.category);
    if (preset.service) setService(preset.service);
    if (preset.masterId) setMasterId(preset.masterId);
    if (preset.date) setDate(preset.date);
    if (preset.time) setTime(preset.time);
  }, [preset]);

  const availableMasters = useMemo(
    () => MASTERS.filter((master) => master.categories.includes(category)),
    [category],
  );

  const selectedService = service ? findService(category, service) : undefined;
  const duration = selectedService?.duration ?? 30;

  // Услуга и мастер должны существовать в выбранной категории.
  useEffect(() => {
    if (service && !findService(category, service)) setService('');
    if (masterId && !availableMasters.some((master) => master.id === masterId)) setMasterId('');
  }, [category, service, masterId, availableMasters]);

  // Свободные окошки зависят от мастера, дня и длительности услуги.
  // Услуга не обязательна: пока её не выбрали, сервер отдаёт сетку под обычную стрижку.
  useEffect(() => {
    if (!masterId) {
      setSlots([]);
      return;
    }

    let cancelled = false;
    setSlotsLoading(true);

    api
      .availability(date, masterId, category, service)
      .then((response) => {
        if (cancelled) return;
        setSlots(response.slots);
        // Выбранное время могло стать недоступным после смены услуги или дня.
        setTime((current) =>
          response.slots.some((slot) => slot.time === current && slot.available) ? current : '',
        );
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [masterId, service, category, date]);

  const maxDiscount = user?.bonusPercent ?? 0;
  const discountAvailable = Boolean(user && maxDiscount > 0 && selectedService?.price !== null);

  // Больше накопленного списать нельзя — например, после отмены другой записи.
  useEffect(() => {
    if (!discountAvailable) setDiscount(0);
    else setDiscount((current) => Math.min(current, maxDiscount));
  }, [discountAvailable, maxDiscount]);

  const basePrice = selectedService?.price ?? null;
  const finalPrice = basePrice === null ? null : applyDiscount(basePrice, discount);

  // Быстрый выбор: ничего, половина накопленного, всё.
  const quickDiscounts = useMemo(
    () => Array.from(new Set([0, Math.floor(maxDiscount / 2), maxDiscount])),
    [maxDiscount],
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!time) {
      setError('Выберите свободное окошко');
      return;
    }

    setSubmitting(true);
    try {
      await api.createBooking({
        category,
        service,
        masterId,
        date,
        time,
        clientName: name,
        clientPhone: phone,
        discountPercent: discount,
      });

      setSuccess(true);
      setService('');
      setMasterId('');
      setTime('');
      setDiscount(0);
      await refresh();
      onBooked();
      setTimeout(() => setSuccess(false), 8000);
    } catch (err) {
      setError((err as Error).message);
      // Окошко мог занять кто-то другой — обновляем сетку.
      if (masterId) {
        api
          .availability(date, masterId, category, service)
          .then((response) => setSlots(response.slots))
          .catch(() => undefined);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="booking" className="py-20 border-t border-border relative">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading title="Оформить запись" />

        <div className="bg-surface border border-border rounded-3xl p-6 sm:p-10 backdrop-blur-md relative overflow-hidden">
          <AnimatePresence>
            {success && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-10 bg-bg-main/95 backdrop-blur-xl flex flex-col items-center justify-center text-center p-8"
              >
                <motion.div
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', delay: 0.1 }}
                >
                  <CheckCircle2 className="w-20 h-20 text-orange-500 mb-6" />
                </motion.div>
                <h3 className="text-3xl font-black tracking-tighter mb-2">ВЫ УСПЕШНО ЗАПИСАНЫ</h3>
                <p className="text-text-muted max-w-sm">
                  {user && config?.vkBotEnabled
                    ? 'Подтверждение отправили вам в личные сообщения ВКонтакте. Там же напомним о визите.'
                    : 'Мы свяжемся с вами для подтверждения. До встречи в ВАЙБ!'}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSubmit} className="space-y-7">
            {/* Категория */}
            <div className="space-y-2">
              <span className="text-sm font-medium text-text-muted flex items-center gap-2">
                <Scissors className="w-4 h-4" /> Категория
              </span>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCategory(item.id)}
                    className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                      category === item.id
                        ? 'border-orange-500 bg-orange-500 text-white'
                        : 'border-border bg-bg-main hover:bg-surface-hover text-text-main'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Услуга */}
            <Field label="Услуга" icon={<Scissors className="w-4 h-4" />}>
              <select
                value={service}
                onChange={(event) => setService(event.target.value)}
                className={`${inputClass} appearance-none`}
                required
              >
                <option value="" disabled className="bg-dropdown text-text-main">
                  Выберите услугу
                </option>
                {SERVICES[category].map((item) => (
                  <option key={item.name} value={item.name} className="bg-dropdown text-text-main">
                    {item.name} — {formatPrice(item)} · {formatDuration(item.duration)}
                  </option>
                ))}
              </select>
            </Field>

            {/* Мастер */}
            <Field label="Мастер" icon={<User className="w-4 h-4" />}>
              <select
                value={masterId}
                onChange={(event) => setMasterId(event.target.value)}
                className={`${inputClass} appearance-none`}
                required
              >
                <option value="" disabled className="bg-dropdown text-text-main">
                  Выберите мастера
                </option>
                {availableMasters.map((master) => (
                  <option key={master.id} value={master.id} className="bg-dropdown text-text-main">
                    {master.name} ({master.role})
                  </option>
                ))}
              </select>
            </Field>

            {/* День */}
            <div className="space-y-2">
              <span className="text-sm font-medium text-text-muted flex items-center gap-2">
                <Clock className="w-4 h-4" /> День
              </span>
              <DateStrip today={today} value={date} onChange={setDate} />
            </div>

            {/* Окошки */}
            <div className="space-y-2">
              <span className="text-sm font-medium text-text-muted flex items-center gap-2">
                <Clock className="w-4 h-4" /> Время
                {selectedService ? (
                  <span className="text-text-muted/70">· услуга займёт {formatDuration(duration)}</span>
                ) : (
                  masterId && (
                    <span className="text-text-muted/70">
                      · сетка под обычную стрижку, после выбора услуги пересчитаем
                    </span>
                  )
                )}
              </span>
              {masterId ? (
                <SlotGrid slots={slots} value={time} onChange={setTime} loading={slotsLoading} />
              ) : (
                <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-text-muted">
                  Выберите мастера — покажем свободные окошки
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <Field label="Ваше имя" icon={<User className="w-4 h-4" />}>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Иван Иванов"
                  className={inputClass}
                  required
                />
              </Field>

              <Field label="Телефон" icon={<Phone className="w-4 h-4" />}>
                <input
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(formatPhone(event.target.value))}
                  placeholder="+7 (999) 000-00-00"
                  className={inputClass}
                  required
                />
              </Field>
            </div>

            {/* Скидка */}
            {user ? (
              discountAvailable ? (
                <div className="rounded-2xl border border-orange-500/30 bg-orange-500/5 p-5 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium flex items-center gap-2">
                      <Percent className="w-4 h-4 text-orange-500" />
                      Списать накопленную скидку
                    </span>
                    <span className="text-sm text-text-muted">накоплено {maxDiscount}%</span>
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={maxDiscount}
                    value={discount}
                    onChange={(event) => setDiscount(Number(event.target.value))}
                    className="w-full accent-orange-500"
                    aria-label="Сколько процентов списать"
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    {quickDiscounts.map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setDiscount(value)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                            discount === value
                              ? 'border-orange-500 bg-orange-500 text-white'
                              : 'border-border bg-bg-main text-text-muted hover:text-text-main'
                          }`}
                        >
                          {value === 0 ? 'не списывать' : `${value}%`}
                        </button>
                      ))}
                  </div>

                  {basePrice !== null && (
                    <div className="flex items-baseline justify-between border-t border-border pt-4">
                      <span className="text-text-muted text-sm">К оплате</span>
                      <span className="text-2xl font-black text-orange-500">
                        {finalPrice}р
                        {discount > 0 && (
                          <span className="ml-2 text-base font-medium text-text-muted line-through">
                            {basePrice}р
                          </span>
                        )}
                      </span>
                    </div>
                  )}

                  <p className="text-xs text-text-muted">
                    Проценты резервируются под эту запись, окончательно списывает их администратор после
                    стрижки. Если запись отменить — вернутся на счёт.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-text-muted">
                  {maxDiscount === 0
                    ? 'После первого визита начнём копить вашу скидку: по 1% за каждую стрижку.'
                    : 'Для этой услуги цену определяют на месте — скидку спишет администратор.'}
                </p>
              )
            ) : (
              <div className="rounded-2xl border border-border bg-bg-main p-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
                <div>
                  <p className="font-bold">Записаться можно и без входа</p>
                  <p className="text-sm text-text-muted">
                    Но тогда не копится скидка — 1% за каждый визит, до 100%.
                  </p>
                </div>
                <VkLoginButton compact label="Войти через ВК" />
              </div>
            )}

            {basePrice !== null && !discountAvailable && (
              <div className="flex items-baseline justify-between rounded-2xl border border-border bg-bg-main px-5 py-4">
                <span className="text-text-muted text-sm">Стоимость</span>
                <span className="text-2xl font-black text-orange-500">{formatPrice(selectedService!)}</span>
              </div>
            )}

            {error && <ErrorNote>{error}</ErrorNote>}

            <Button type="submit" loading={submitting} className="w-full py-4 text-lg">
              {submitting ? 'Отправляем…' : 'Подтвердить запись'}
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
