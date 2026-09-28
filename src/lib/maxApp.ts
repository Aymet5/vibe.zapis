/**
 * Сайт, открытый как мини-приложение MAX. MAX кладёт подписанные данные
 * запуска в адрес: #WebAppData=… — по ним сервер пускает клиента без
 * кнопок входа. Мост MAX (для запроса телефона) грузим только внутри MAX,
 * чтобы обычный сайт не ждал чужой скрипт.
 */

const INIT_KEY = 'WebAppData';
const BRIDGE_URL = 'https://st.max.ru/js/max-web-app.js';

function readStored(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Приватный режим — данные остаются в адресе.
  }
}

/**
 * Данные запуска. После перехода по страницам хэш пропадает, поэтому
 * запоминаем их на время вкладки — так же делает и сам мост MAX.
 */
export function maxInitData(): string | null {
  try {
    const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, '')).get(INIT_KEY);
    if (fromHash) {
      store(INIT_KEY, fromHash);
      return fromHash;
    }
  } catch {
    // Хэш не в формате параметров — значит, это не запуск из MAX.
  }
  return readStored(INIT_KEY);
}

export function isMaxApp(): boolean {
  return Boolean(maxInitData());
}

/** Параметр из ссылки https://max.ru/<бот>?startapp=… — например, move-12. */
export function maxStartParam(): string | null {
  const raw = maxInitData();
  if (!raw) return null;
  try {
    return new URLSearchParams(decodeURIComponent(raw)).get('start_param');
  } catch {
    return new URLSearchParams(raw).get('start_param');
  }
}

interface MaxBridge {
  ready?: () => void;
  requestContact?: () => Promise<{ phone?: string } | { error: unknown }>;
  openLink?: (url: string) => void;
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (handler: () => void) => void;
    offClick: (handler: () => void) => void;
  };
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'success' | 'error' | 'warning') => void;
    selectionChanged: () => void;
  };
}

let bridge: Promise<MaxBridge | null> | null = null;

function loadBridge(): Promise<MaxBridge | null> {
  bridge ??= new Promise((resolve) => {
    const existing = (window as { WebApp?: MaxBridge }).WebApp;
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement('script');
    script.src = BRIDGE_URL;
    script.async = true;
    script.onload = () => resolve((window as { WebApp?: MaxBridge }).WebApp ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return bridge;
}

/** Сообщаем MAX, что приложение отрисовалось, — он убирает заставку. */
export function signalMaxReady(): void {
  if (!isMaxApp()) return;
  void loadBridge().then((webApp) => webApp?.ready?.());
}

/**
 * Родное окно MAX «Поделиться номером». Клиент может отказаться —
 * тогда вернём null и телефон он введёт сам.
 */
export async function requestMaxPhone(): Promise<string | null> {
  const webApp = await loadBridge();
  if (!webApp?.requestContact) return null;
  try {
    const result = await webApp.requestContact();
    return 'phone' in result && result.phone ? String(result.phone) : null;
  } catch {
    return null;
  }
}

type Haptic = 'select' | 'tap' | 'success' | 'error';

/** Отклик вибрацией, как у родных приложений. Вне MAX ничего не делает. */
export function haptic(kind: Haptic): void {
  if (!isMaxApp()) return;
  void loadBridge().then((webApp) => {
    const feedback = webApp?.HapticFeedback;
    if (!feedback) return;
    try {
      if (kind === 'select') feedback.selectionChanged();
      else if (kind === 'tap') feedback.impactOccurred('light');
      else feedback.notificationOccurred(kind);
    } catch {
      // Старый клиент MAX без вибрации — не страшно.
    }
  });
}

/**
 * Системная кнопка «Назад» в шапке MAX. handler = null прячет её.
 * Возвращает функцию отписки для useEffect.
 */
export function setMaxBackButton(handler: (() => void) | null): () => void {
  if (!isMaxApp()) return () => undefined;
  let active = true;
  let attached: (() => void) | null = null;

  void loadBridge().then((webApp) => {
    const back = webApp?.BackButton;
    if (!back || !active) return;
    if (handler) {
      attached = handler;
      back.onClick(handler);
      back.show();
    } else {
      back.hide();
    }
  });

  return () => {
    active = false;
    void loadBridge().then((webApp) => {
      if (attached) webApp?.BackButton?.offClick(attached);
    });
  };
}

/** Внешняя ссылка — в браузере телефона, а не внутри мини-приложения. */
export function openExternal(url: string): void {
  void loadBridge().then((webApp) => {
    if (webApp?.openLink) webApp.openLink(url);
    else window.open(url, '_blank', 'noopener');
  });
}
