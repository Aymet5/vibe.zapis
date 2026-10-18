import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock, Percent, Send, Trash2, Users, Wallet } from 'lucide-react';
import { CATEGORIES, SERVICES, type CategoryId } from '../../shared/catalog';
import type { PublicMaster } from '../../shared/types';
import { api, type CashDay, type DutyDay, type StaffMaster, type StaffRole } from '../api';
import { Button, ErrorNote, Spinner, inputClass } from '../components/ui';
import { addDays, formatDate, formatDateFull, formatPhone, plural, weekdayShort } from '../lib/format';
import { haptic } from '../lib/maxApp';

/**
 * Касса дня для сотрудников — вместо тетради. Дежурный и администратор
 * записывают каждого клиента, в конце дня бот рассылает, кто сколько должен.
 */

type Section = 'cash' | 'duty' | 'masters';

function rub(amount: number): string {
  return `${amount.toLocaleString('ru-RU')} ₽`;
}

export function CashScreen({ role, today, masters }: { role: StaffRole; today: string; masters: PublicMaster[] }) {
  const [section, setSection] = useState<Section>('cash');

  const sections: { id: Section; label: string }[] = [
    { id: 'cash', label: 'Касса' },
    { id: 'duty', label: 'Дежурства' },
    ...(role.isAdmin ? [{ id: 'masters' as const, label: 'Проценты' }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className={`grid gap-1 rounded-2xl bg-badge p-1 ${sections.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              haptic('select');
              setSection(item.id);
            }}
            className={`rounded-xl py-2.5 font-semibold transition-colors ${
              section === item.id ? 'bg-bg-main text-text-main shadow' : 'text-text-muted'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div key={section} className="max-step">
        {section === 'cash' && <CashDayScreen role={role} today={today} masters={masters} />}
        {section === 'duty' && <DutyScreen role={role} today={today} masters={masters} />}
        {section === 'masters' && <PercentScreen />}
      </div>
    </div>
  );
}

// ─── Касса дня ───

function CashDayScreen({ role, today, masters }: { role: StaffRole; today: string; masters: PublicMaster[] }) {
  const [date, setDate] = useState(today);
  const [day, setDay] = useState<CashDay | null>(null);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setDay((await api.staff.day(date)).day);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [date]);

  useEffect(() => {
    setDay(null);
    setConfirmClose(false);
    void load();
  }, [load]);

  const close = async () => {
    if (!confirmClose) {
      haptic('tap');
      setConfirmClose(true);
      return;
    }
    setClosing(true);
    setError('');
    try {
      setDay((await api.staff.closeDay(date)).day);
      haptic('success');
    } catch (err) {
      haptic('error');
      setError((err as Error).message);
    } finally {
      setClosing(false);
      setConfirmClose(false);
    }
  };

  const reopen = async () => {
    try {
      setDay((await api.staff.reopenDay(date)).day);
      haptic('success');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Предыдущий день"
          onClick={() => setDate(addDays(date, -1))}
          className="w-11 h-11 rounded-full bg-surface flex items-center justify-center"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="text-center">
          <p className="text-xl font-black">{date === today ? 'Сегодня' : formatDate(date)}</p>
          <p className="text-sm text-text-muted">{formatDateFull(date)}</p>
        </div>
        <button
          type="button"
          aria-label="Следующий день"
          disabled={date >= today}
          onClick={() => setDate(addDays(date, 1))}
          className="w-11 h-11 rounded-full bg-surface flex items-center justify-center disabled:opacity-30"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {!day ? (
        <div className="flex justify-center py-12 text-text-muted">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="rounded-2xl bg-orange-500/10 px-4 py-3 text-orange-500 font-semibold">
            {day.duty.masterName ? `Дежурный: ${day.duty.masterName}` : 'Дежурный не назначен'}
          </div>

          {day.canWrite && <EntryForm date={date} masters={masters} onSaved={setDay} defaultMaster={role.masterId} />}

          <Totals day={day} isAdmin={role.isAdmin} />

          <EntryList day={day} onChange={setDay} />

          {day.closed ? (
            <div className="rounded-3xl bg-surface p-4 space-y-3 text-center">
              <p className="font-semibold flex items-center justify-center gap-2">
                <Lock className="w-5 h-5 text-orange-500" /> День закрыт, итог отправлен
              </p>
              {role.isAdmin && (
                <Button variant="ghost" onClick={() => void reopen()} className="w-full">
                  Открыть заново, чтобы исправить
                </Button>
              )}
            </div>
          ) : (
            (day.canWrite || role.isAdmin) &&
            day.entries.length > 0 && (
              <Button onClick={() => void close()} loading={closing} className="w-full py-4 text-lg">
                <Send className="w-5 h-5" />
                {confirmClose ? 'Нажмите ещё раз — отправить итог' : 'Закрыть день и отправить итог'}
              </Button>
            )
          )}
        </>
      )}
    </div>
  );
}

function EntryForm({
  date,
  masters,
  defaultMaster,
  onSaved,
}: {
  date: string;
  masters: PublicMaster[];
  defaultMaster: string | null;
  onSaved: (day: CashDay) => void;
}) {
  const [masterId, setMasterId] = useState(defaultMaster && masters.some((m) => m.id === defaultMaster) ? defaultMaster : '');
  const [category, setCategory] = useState<CategoryId>('mens');
  const [service, setService] = useState('');
  const [custom, setCustom] = useState(false);
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const pick = (name: string, value: number | null) => {
    haptic('select');
    setCustom(false);
    setService(name);
    setPrice(value ? String(value) : '');
  };

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const day = (await api.staff.addEntry({ date, masterId, service, price: Number(price) })).day;
      haptic('success');
      const name = masters.find((m) => m.id === masterId)?.name ?? '';
      setSaved(`Записано: ${name}, ${service}, ${rub(Number(price))}`);
      setService('');
      setPrice('');
      setCustom(false);
      onSaved(day);
    } catch (err) {
      haptic('error');
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const ready = Boolean(masterId && service.trim() && Number(price) > 0);

  return (
    <div className="rounded-3xl bg-surface p-4 space-y-4">
      <p className="text-lg font-black">Новый клиент</p>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-text-muted">Мастер</p>
        <div className="flex flex-wrap gap-2">
          {masters.map((master) => (
            <Chip
              key={master.id}
              active={masterId === master.id}
              onClick={() => {
                haptic('select');
                setMasterId(master.id);
              }}
            >
              {master.name}
            </Chip>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-text-muted">Услуга</p>
        <div className="grid grid-cols-3 gap-1 rounded-2xl bg-badge p-1">
          {CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                haptic('select');
                setCategory(item.id);
              }}
              className={`rounded-xl py-2 text-sm font-semibold ${
                category === item.id ? 'bg-bg-main text-text-main shadow' : 'text-text-muted'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {SERVICES[category]
            .filter((item) => item.price !== null)
            .map((item) => (
              <Chip key={item.name} active={!custom && service === item.name} onClick={() => pick(item.name, item.price)}>
                {item.name} · {item.from ? 'от ' : ''}
                {item.price}
              </Chip>
            ))}
          <Chip
            active={custom}
            onClick={() => {
              haptic('select');
              setCustom(true);
              setService('');
            }}
          >
            Другое
          </Chip>
        </div>
        {custom && (
          <input
            value={service}
            onChange={(event) => setService(event.target.value)}
            placeholder="Что делали"
            className={inputClass}
          />
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-text-muted">Цена, ₽</p>
        <input
          type="number"
          inputMode="numeric"
          value={price}
          onChange={(event) => setPrice(event.target.value.replace(/\D/g, ''))}
          placeholder="600"
          className={inputClass}
        />
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {saved && !error && <p className="rounded-2xl bg-emerald-500/10 px-4 py-3 text-emerald-500">{saved}</p>}

      <Button onClick={() => void submit()} loading={saving} disabled={!ready} className="w-full py-4 text-lg">
        Записать клиента{Number(price) > 0 && ` · ${rub(Number(price))}`}
      </Button>
    </div>
  );
}

function Totals({ day, isAdmin }: { day: CashDay; isAdmin: boolean }) {
  const { report } = day;
  if (report.masters.length === 0) {
    return (
      <div className="rounded-3xl bg-surface p-6 text-center text-text-muted">
        <Wallet className="w-9 h-9 mx-auto mb-2" />
        Клиентов пока не записано
      </div>
    );
  }

  return (
    <section className="space-y-2">
      <p className="text-sm font-semibold text-text-muted uppercase tracking-wide">Итог дня</p>
      <div className="rounded-3xl bg-surface divide-y divide-border overflow-hidden">
        {report.masters.map((item) => (
          <div key={item.masterId} className="px-4 py-3.5 space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-lg font-bold">{item.masterName}</span>
              <span className="text-lg font-black">{rub(item.revenue)}</span>
            </div>
            <p className="text-text-muted">
              {item.clients} {plural(item.clients, 'клиент', 'клиента', 'клиентов')}
              {item.percent
                ? ` · ${item.percent}% админу: ${rub(item.owed)} · мастеру: ${rub(item.earned)}`
                : ' · не на процентах'}
            </p>
          </div>
        ))}
        {isAdmin && (
          <div className="px-4 py-3.5 bg-orange-500/10">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-lg font-bold">Всего</span>
              <span className="text-lg font-black">{rub(report.revenue)}</span>
            </div>
            <p className="font-semibold text-orange-500">
              {report.clients} {plural(report.clients, 'клиент', 'клиента', 'клиентов')} · к сдаче {rub(report.owed)}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function EntryList({ day, onChange }: { day: CashDay; onChange: (day: CashDay) => void }) {
  const [armed, setArmed] = useState<number | null>(null);
  const [error, setError] = useState('');

  if (day.entries.length === 0) return null;

  const remove = async (id: number) => {
    if (armed !== id) {
      haptic('tap');
      setArmed(id);
      return;
    }
    setError('');
    try {
      onChange((await api.staff.deleteEntry(id, day.date)).day);
      haptic('success');
    } catch (err) {
      haptic('error');
      setError((err as Error).message);
    } finally {
      setArmed(null);
    }
  };

  return (
    <section className="space-y-2">
      <p className="text-sm font-semibold text-text-muted uppercase tracking-wide">
        Клиенты · {day.entries.length}
      </p>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="rounded-3xl bg-surface divide-y divide-border overflow-hidden">
        {day.entries.map((entry) => (
          <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
            <span className="text-text-muted tabular-nums w-12 shrink-0">{entry.time}</span>
            <span className="flex-1 min-w-0">
              <span className="block font-semibold truncate">
                {entry.masterName} · {entry.service}
              </span>
              <span className="block text-sm text-text-muted truncate">записал(а) {entry.author}</span>
            </span>
            <span className="font-bold shrink-0">{rub(entry.price)}</span>
            {day.canWrite && (
              <button
                type="button"
                aria-label="Удалить"
                onClick={() => void remove(entry.id)}
                className={`shrink-0 rounded-full p-2 ${armed === entry.id ? 'bg-red-500 text-white' : 'text-text-muted'}`}
              >
                <Trash2 className="w-5 h-5" />
              </button>
            )}
          </div>
        ))}
      </div>
      {armed !== null && <p className="text-sm text-red-400 text-center">Нажмите корзину ещё раз, чтобы удалить</p>}
    </section>
  );
}

// ─── Дежурства ───

function DutyScreen({ role, today, masters }: { role: StaffRole; today: string; masters: PublicMaster[] }) {
  const [duty, setDuty] = useState<DutyDay[] | null>(null);
  const [error, setError] = useState('');
  const [filling, setFilling] = useState(false);

  useEffect(() => {
    api.staff
      .duty(today)
      .then((response) => setDuty(response.duty))
      .catch((err: Error) => setError(err.message));
  }, [today]);

  const assign = async (date: string, masterId: string) => {
    setError('');
    try {
      setDuty((await api.staff.setDuty(date, masterId || null, today)).duty);
      haptic('success');
    } catch (err) {
      haptic('error');
      setError((err as Error).message);
    }
  };

  const fill = async () => {
    setFilling(true);
    setError('');
    try {
      setDuty((await api.staff.fillRotation(today)).duty);
      haptic('success');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFilling(false);
    }
  };

  if (!duty) {
    return error ? (
      <ErrorNote>{error}</ErrorNote>
    ) : (
      <div className="flex justify-center py-12 text-text-muted">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-text-muted">
        {role.isAdmin
          ? 'Назначенному дежурному сразу придёт сообщение, а утром в его день — напоминание.'
          : 'Дежурный записывает в кассу каждого клиента и следит за порядком.'}
      </p>
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="rounded-3xl bg-surface divide-y divide-border overflow-hidden">
        {duty.map((item) => {
          const mine = role.masterId !== null && item.masterId === role.masterId;
          return (
            <div key={item.date} className={`flex items-center gap-3 px-4 py-3 ${mine ? 'bg-orange-500/10' : ''}`}>
              <span className="w-24 shrink-0">
                <span className="block font-bold">{item.date === today ? 'Сегодня' : formatDate(item.date)}</span>
                <span className="block text-sm text-text-muted">{weekdayShort(item.date)}</span>
              </span>
              {role.isAdmin ? (
                <select
                  value={item.masterId ?? ''}
                  onChange={(event) => void assign(item.date, event.target.value)}
                  className={`${inputClass} flex-1 py-2.5`}
                >
                  <option value="">— не назначен —</option>
                  {masters.map((master) => (
                    <option key={master.id} value={master.id}>
                      {master.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className={`flex-1 font-semibold ${item.masterName ? '' : 'text-text-muted'}`}>
                  {item.masterName ?? 'не назначен'}
                  {mine && ' — вы'}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {role.isAdmin && (
        <Button variant="ghost" onClick={() => void fill()} loading={filling} className="w-full py-3.5">
          <Users className="w-5 h-5" /> Заполнить пустые дни по очереди
        </Button>
      )}
    </div>
  );
}

// ─── Проценты и телефоны мастеров ───

function PercentScreen() {
  const [masters, setMasters] = useState<StaffMaster[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.staff
      .masters()
      .then((response) => setMasters(response.masters))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (!masters) {
    return error ? (
      <ErrorNote>{error}</ErrorNote>
    ) : (
      <div className="flex justify-center py-12 text-text-muted">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-text-muted">
        Процент — сколько мастер отдаёт администратору с выручки. Пусто — мастер не на процентах. По телефону бот
        узнаёт мастера в MAX и присылает ему итог дня.
      </p>
      {masters.map((master) => (
        <MasterCard key={master.id} master={master} onSaved={setMasters} />
      ))}
    </div>
  );
}

function MasterCard({ master, onSaved }: { master: StaffMaster; onSaved: (masters: StaffMaster[]) => void }) {
  const [percent, setPercent] = useState(master.percent ? String(master.percent) : '');
  const [phone, setPhone] = useState(master.phone ? formatPhone(master.phone) : '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      onSaved(
        (await api.staff.updateMaster(master.id, { percent: percent ? Number(percent) : null, phone })).masters,
      );
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

  return (
    <div className="rounded-3xl bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-lg font-black">{master.name}</p>
        <span className={`text-sm font-semibold ${master.connected ? 'text-emerald-500' : 'text-text-muted'}`}>
          {master.connected ? 'в MAX подключён' : master.phone ? 'ещё не открывал приложение' : 'телефон не указан'}
        </span>
      </div>
      <div className="grid grid-cols-[6.5rem_1fr] gap-2">
        <label className="relative">
          <input
            type="number"
            inputMode="numeric"
            value={percent}
            onChange={(event) => setPercent(event.target.value.replace(/\D/g, '').slice(0, 3))}
            placeholder="—"
            className={`${inputClass} pr-9`}
          />
          <Percent className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
        </label>
        <input
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value ? formatPhone(event.target.value) : '')}
          placeholder="+7 (999) 000-00-00"
          className={inputClass}
        />
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Button onClick={() => void save()} loading={saving} className="w-full">
        {saved ? 'Сохранено' : 'Сохранить'}
      </Button>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2.5 font-semibold transition-colors ${
        active ? 'border-orange-500 bg-orange-500 text-white' : 'border-border bg-bg-main text-text-main'
      }`}
    >
      {children}
    </button>
  );
}
