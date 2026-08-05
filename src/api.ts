import type {
  AdminBookingView,
  AvailabilityResponse,
  BonusTransactionView,
  BookingView,
  PublicUser,
} from '../shared/types';
import type { CategoryId, Master } from '../shared/catalog';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(payload?.error ?? 'Не удалось связаться с сервером', response.status);
  }
  return payload as T;
}

export interface AppConfig {
  vkLoginEnabled: boolean;
  vkBotEnabled: boolean;
  communityChatUrl: string | null;
  adminEnabled: boolean;
  today: string;
  horizonDays: number;
  user: PublicUser | null;
}

export interface ScheduleResponse {
  date: string;
  durationMinutes: number;
  masters: (AvailabilityResponse & { master: Master })[];
}

export interface CreateBookingPayload {
  category: CategoryId;
  service: string;
  masterId: string;
  date: string;
  time: string;
  clientName: string;
  clientPhone: string;
  discountPercent: number;
}

export const api = {
  config: () => request<AppConfig>('/config'),

  schedule: (date: string, category?: CategoryId) =>
    request<ScheduleResponse>(`/schedule?date=${date}${category ? `&category=${category}` : ''}`),

  availability: (date: string, masterId: string, category: CategoryId, service: string) =>
    request<AvailabilityResponse>(
      `/availability?date=${date}&master=${masterId}&category=${category}&service=${encodeURIComponent(service)}`,
    ),

  createBooking: (payload: CreateBookingPayload) =>
    request<{ booking: BookingView }>('/bookings', { method: 'POST', body: JSON.stringify(payload) }),

  me: () => request<{ user: PublicUser }>('/me'),

  savePhone: (phone: string) =>
    request<{ user: PublicUser }>('/me', { method: 'PATCH', body: JSON.stringify({ phone }) }),

  myBookings: () => request<{ bookings: BookingView[] }>('/me/bookings'),

  myBonuses: () => request<{ balance: number; history: BonusTransactionView[] }>('/me/bonuses'),

  cancelMyBooking: (id: number) =>
    request<{ booking: BookingView }>(`/me/bookings/${id}/cancel`, { method: 'POST' }),

  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  admin: {
    session: () => request<{ authenticated: boolean; enabled: boolean }>('/admin/session'),

    login: (password: string) =>
      request<{ ok: true }>('/admin/login', { method: 'POST', body: JSON.stringify({ password }) }),

    logout: () => request<{ ok: true }>('/admin/logout', { method: 'POST' }),

    bookings: (params: { scope: 'day' | 'upcoming' | 'pending'; date?: string }) =>
      request<{ bookings: AdminBookingView[] }>(
        `/admin/bookings?scope=${params.scope}${params.date ? `&date=${params.date}` : ''}`,
      ),

    confirm: (id: number) =>
      request<{ booking: AdminBookingView }>(`/admin/bookings/${id}/confirm`, { method: 'POST' }),

    cancel: (id: number) =>
      request<{ booking: AdminBookingView }>(`/admin/bookings/${id}/cancel`, { method: 'POST' }),

    noShow: (id: number) =>
      request<{ booking: AdminBookingView }>(`/admin/bookings/${id}/no-show`, { method: 'POST' }),

    complete: (id: number, writeOffPercent: number, finalPrice: number | null) =>
      request<{ booking: AdminBookingView }>(`/admin/bookings/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify({ writeOffPercent, finalPrice }),
      }),

    clients: (query: string) =>
      request<{ clients: AdminClient[] }>(`/admin/clients?query=${encodeURIComponent(query)}`),

    client: (id: number) =>
      request<{
        client: AdminClient & { createdAt: string };
        bookings: AdminBookingView[];
        bonusHistory: BonusTransactionView[];
      }>(`/admin/clients/${id}`),

    adjustBonus: (id: number, delta: number, reason: string) =>
      request<{ balance: number }>(`/admin/clients/${id}/bonus`, {
        method: 'POST',
        body: JSON.stringify({ delta, reason }),
      }),
  },
};

export interface AdminClient {
  id: number;
  vkId: string | null;
  name: string;
  phone: string | null;
  bonusPercent: number;
  vkMessagesAllowed: boolean;
}
