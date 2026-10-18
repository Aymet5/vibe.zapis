import type {
  AdminBookingView,
  AvailabilityResponse,
  BonusTransactionView,
  BookingView,
  PublicMaster,
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
  masters: PublicMaster[];
  user: PublicUser | null;
}

export interface ScheduleResponse {
  date: string;
  durationMinutes: number;
  masters: (AvailabilityResponse & { master: PublicMaster })[];
}

export interface MasterInput {
  name: string;
  role: string;
  categories: CategoryId[];
}

export interface AdminMaster extends PublicMaster {
  vkId: string | null;
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

  /** Свободные окошки для переноса своей записи — у того же мастера. */
  rescheduleAvailability: (id: number, date: string) =>
    request<AvailabilityResponse>(`/me/bookings/${id}/availability?date=${date}`),

  rescheduleMyBooking: (id: number, date: string, time: string) =>
    request<{ booking: BookingView }>(`/me/bookings/${id}/reschedule`, {
      method: 'POST',
      body: JSON.stringify({ date, time }),
    }),

  /** Записи к самому мастеру — только для аккаунтов, закреплённых за мастером. */
  masterBookings: (params: { scope: 'day' | 'upcoming'; date?: string }) =>
    request<{ master: Master; date: string; bookings: BookingView[] }>(
      `/me/master/bookings?scope=${params.scope}${params.date ? `&date=${params.date}` : ''}`,
    ),

  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  /** Вход из мини-приложения MAX по подписанным данным запуска. */
  maxLogin: (initData: string) =>
    request<{ user: PublicUser }>('/auth/max', { method: 'POST', body: JSON.stringify({ initData }) }),

  /** Касса дня — только для сотрудников. */
  staff: {
    me: () => request<{ role: StaffRole; today: string }>('/staff/me'),

    day: (date: string) => request<{ day: CashDay }>(`/staff/day?date=${date}`),

    addEntry: (entry: { date: string; masterId: string; service: string; price: number }) =>
      request<{ day: CashDay }>('/staff/entries', { method: 'POST', body: JSON.stringify(entry) }),

    deleteEntry: (id: number, date: string) =>
      request<{ day: CashDay }>(`/staff/entries/${id}?date=${date}`, { method: 'DELETE' }),

    closeDay: (date: string) => request<{ day: CashDay }>(`/staff/day/${date}/close`, { method: 'POST' }),

    reopenDay: (date: string) => request<{ day: CashDay }>(`/staff/day/${date}/reopen`, { method: 'POST' }),

    duty: (from: string) => request<{ duty: DutyDay[] }>(`/staff/duty?from=${from}&days=14`),

    setDuty: (date: string, masterId: string | null, from: string) =>
      request<{ duty: DutyDay[] }>(`/staff/duty/${date}?from=${from}`, {
        method: 'PUT',
        body: JSON.stringify({ masterId }),
      }),

    fillRotation: (from: string) =>
      request<{ duty: DutyDay[] }>('/staff/duty/rotation', {
        method: 'POST',
        body: JSON.stringify({ from, days: 14 }),
      }),

    masters: () => request<{ masters: StaffMaster[] }>('/staff/masters'),

    updateMaster: (id: string, patch: { percent?: number | null; phone?: string }) =>
      request<{ masters: StaffMaster[] }>(`/staff/masters/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  },

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

    masters: () => request<{ masters: AdminMaster[] }>('/admin/masters'),

    createMaster: (input: MasterInput) =>
      request<{ masters: AdminMaster[] }>('/admin/masters', { method: 'POST', body: JSON.stringify(input) }),

    updateMaster: (id: string, input: MasterInput) =>
      request<{ masters: AdminMaster[] }>(`/admin/masters/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),

    deleteMaster: (id: string) => request<{ masters: AdminMaster[] }>(`/admin/masters/${id}`, { method: 'DELETE' }),

    setMasterVk: (id: string, vkId: string) =>
      request<{ masters: AdminMaster[] }>(`/admin/masters/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ vkId }),
      }),

    /** Файл уходит телом запроса как есть — сервер разбирает его по Content-Type. */
    uploadMasterPhoto: (id: string, file: File) =>
      request<{ masters: AdminMaster[] }>(`/admin/masters/${id}/photo`, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      }),

    deleteMasterPhoto: (id: string) =>
      request<{ masters: AdminMaster[] }>(`/admin/masters/${id}/photo`, { method: 'DELETE' }),

    notifications: () => request<NotificationsState>('/admin/notifications'),

    saveMaxToken: (token: string) =>
      request<NotificationsState>('/admin/notifications/max-token', {
        method: 'PUT',
        body: JSON.stringify({ token }),
      }),

    addVkRecipient: (target: string, title: string) =>
      request<NotificationsState>('/admin/notifications/vk', {
        method: 'POST',
        body: JSON.stringify({ target, title }),
      }),

    setRecipientEnabled: (id: number, enabled: boolean) =>
      request<NotificationsState>(`/admin/notifications/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),

    removeRecipient: (id: number) =>
      request<NotificationsState>(`/admin/notifications/${id}`, { method: 'DELETE' }),

    chatbot: () => request<ChatbotState>('/admin/chatbot'),

    saveChatbot: (
      patch: Partial<Pick<ChatbotState, 'enabled' | 'morning' | 'chance' | 'tuvanChance'>> & {
        key?: string;
        /** Фразы по одной в строке. */
        tuvanPhrases?: string;
      },
    ) =>
      request<ChatbotState>('/admin/chatbot', { method: 'PUT', body: JSON.stringify(patch) }),

    chatbotPost: () => request<{ text: string }>('/admin/chatbot/post', { method: 'POST' }),

    testNotifications: () =>
      request<{ results: { channel: 'vk' | 'max'; target: string; title: string; ok: boolean }[] }>(
        '/admin/notifications/test',
        { method: 'POST' },
      ),

    adjustBonus: (id: number, delta: number, reason: string) =>
      request<{ balance: number }>(`/admin/clients/${id}/bonus`, {
        method: 'POST',
        body: JSON.stringify({ delta, reason }),
      }),
  },
};

export interface StaffRole {
  isAdmin: boolean;
  masterId: string | null;
  masterName: string | null;
}

export interface DutyDay {
  date: string;
  masterId: string | null;
  masterName: string | null;
}

export interface CashEntry {
  id: number;
  masterId: string;
  masterName: string;
  service: string;
  price: number;
  author: string;
  time: string;
}

export interface CashMasterTotal {
  masterId: string;
  masterName: string;
  clients: number;
  revenue: number;
  percent: number | null;
  owed: number;
  earned: number;
}

export interface CashDay {
  date: string;
  duty: DutyDay;
  closed: boolean;
  closedAt: string | null;
  canWrite: boolean;
  entries: CashEntry[];
  report: {
    date: string;
    dutyMasterName: string | null;
    masters: CashMasterTotal[];
    clients: number;
    revenue: number;
    owed: number;
  };
}

export interface StaffMaster {
  id: string;
  name: string;
  percent: number | null;
  phone: string | null;
  connected: boolean;
}

export interface AdminClient {
  id: number;
  vkId: string | null;
  name: string;
  phone: string | null;
  bonusPercent: number;
  vkMessagesAllowed: boolean;
}

export interface NotifyRecipient {
  id: number;
  channel: 'vk' | 'max';
  target: string;
  kind: 'person' | 'chat';
  title: string;
  enabled: boolean;
  /** Только для людей в ВК: разрешил ли сообщения от сообщества. */
  messagesAllowed: boolean | null;
}

export interface NotificationsState {
  max: {
    configured: boolean;
    fromEnv: boolean;
    bot: { name: string; username: string | null } | null;
    error: string | null;
  };
  vk: {
    botEnabled: boolean;
    callbackReady: boolean;
    communityUrl: string | null;
    envPeers: string[];
  };
  recipients: NotifyRecipient[];
  /** Вошедшие на сайт через ВК, которых ещё нет среди получателей. */
  candidates: { vkId: string; name: string }[];
}

export interface ChatbotState {
  enabled: boolean;
  morning: boolean;
  /** Вероятность, что бот сам ответит на обычное сообщение, 0..1. */
  chance: number;
  /** Как часто бот вставляет тувинскую фразу или переходит на тувинский, 0..1. */
  tuvanChance: number;
  tuvanPhrases: string[];
  keyConfigured: boolean;
  keyFromEnv: boolean;
  /** Групповые чаты MAX, где бот разговаривает; botIsAdmin null — не удалось проверить. */
  chats: { title: string; botIsAdmin: boolean | null }[];
}
