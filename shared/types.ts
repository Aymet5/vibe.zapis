import type { CategoryId, Master } from './catalog';

/** Мастер для сайта: карточка из каталога плюс загруженная фотография. */
export interface PublicMaster extends Master {
  /** Путь к фотографии на этом же сервере, null — показываем букву имени. */
  photo: string | null;
}

export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'Ожидает подтверждения',
  confirmed: 'Подтверждена',
  completed: 'Визит состоялся',
  cancelled: 'Отменена',
  no_show: 'Клиент не пришёл',
};

export interface PublicUser {
  id: number;
  firstName: string;
  lastName: string;
  photo: string | null;
  phone: string | null;
  /** Накопленная скидка в процентах, 0..100. */
  bonusPercent: number;
  /** Разрешил ли клиент сообщения от сообщества ВК. */
  vkMessagesAllowed: boolean;
  visitsCount: number;
  /** Если аккаунт закреплён за мастером — его id, иначе null. */
  masterId: string | null;
  /** Имя мастера для заголовка кабинета. */
  masterName: string | null;
}

export interface BookingView {
  id: number;
  category: CategoryId;
  service: string;
  masterId: string;
  masterName: string;
  date: string;
  time: string;
  endTime: string;
  durationMinutes: number;
  status: BookingStatus;
  clientName: string;
  clientPhone: string;
  /** Базовая цена по прайсу, null — «цену скажем на месте». */
  basePrice: number | null;
  /** Сколько процентов скидки клиент попросил списать. */
  discountPercent: number;
  /** Цена с учётом скидки, null если базовая цена неизвестна. */
  finalPrice: number | null;
  createdAt: string;
}

export interface BonusTransactionView {
  id: number;
  delta: number;
  reason: string;
  balanceAfter: number;
  bookingId: number | null;
  createdAt: string;
}

export interface AdminBookingView extends BookingView {
  userId: number | null;
  userBonusPercent: number | null;
  vkId: string | null;
}

/** Занятый интервал в сетке окошек. Причина не раскрывается публично. */
export interface BusyInterval {
  start: string;
  end: string;
}

export interface AvailabilityResponse {
  date: string;
  masterId: string;
  durationMinutes: number;
  /** Все окошки дня с признаком доступности. */
  slots: { time: string; available: boolean }[];
}

export interface ApiError {
  error: string;
}
