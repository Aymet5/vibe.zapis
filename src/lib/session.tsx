import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PublicUser } from '../../shared/types';
import { api, type AppConfig } from '../api';

interface SessionValue {
  config: AppConfig | null;
  user: PublicUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (user: PublicUser | null) => void;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const next = await api.config();
      setConfig(next);
      setUser(next.user);
    } catch (error) {
      console.error('Не удалось получить настройки приложения', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ config, user, loading, refresh, setUser, logout }),
    [config, user, loading, refresh, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession использован вне SessionProvider');
  return value;
}

/** Тема запоминается между визитами: тёмная по умолчанию. */
export function useTheme(): { isDark: boolean; toggle: () => void } {
  const [isDark, setIsDark] = useState(() => localStorage.getItem('vibe-theme') !== 'light');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('vibe-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  return { isDark, toggle: () => setIsDark((value) => !value) };
}
