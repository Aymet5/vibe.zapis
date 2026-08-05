import { useCallback, useEffect, useState } from 'react';

/**
 * Роутер на три страницы. Отдельная библиотека здесь была бы тяжелее
 * самого приложения, поэтому обходимся History API.
 */
export function useRoute(): { path: string; navigate: (to: string) => void } {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string) => {
    if (to === window.location.pathname) return;
    window.history.pushState({}, '', to);
    setPath(to);
    window.scrollTo({ top: 0 });
  }, []);

  return { path, navigate };
}

/** Разовое чтение параметров из строки запроса (?login=ok). */
export function queryParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

/** Убирает служебные параметры из адреса, не перезагружая страницу. */
export function stripQuery(): void {
  window.history.replaceState({}, '', window.location.pathname);
}
