import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, X } from 'lucide-react';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { Spinner } from './components/ui';
import { queryParam, stripQuery, useRoute } from './lib/router';
import { SessionProvider, useSession, useTheme } from './lib/session';
import { Admin } from './pages/Admin';
import { Landing } from './pages/Landing';
import { Profile } from './pages/Profile';

export default function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}

function Shell() {
  const { config, loading } = useSession();
  const { isDark, toggle } = useTheme();
  const { path, navigate } = useRoute();
  const [loginError, setLoginError] = useState<string | null>(null);

  // Ошибку входа через ВК сервер возвращает параметром в адресе.
  useEffect(() => {
    if (queryParam('login') === 'error') {
      setLoginError(queryParam('reason') ?? 'Не удалось войти через ВКонтакте');
    }
    if (queryParam('login')) stripQuery();
  }, []);

  const goToBooking = () => {
    if (path !== '/') {
      navigate('/');
      // Секция появляется только после отрисовки главной страницы.
      setTimeout(() => document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' }), 80);
      return;
    }
    document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' });
  };

  const today = config?.today ?? new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-screen font-sans bg-bg-main text-text-main selection:bg-orange-500/30 transition-colors duration-300">
      <Header isDark={isDark} onToggleTheme={toggle} onNavigate={navigate} onBook={goToBooking} path={path} />

      <AnimatePresence>
        {loginError && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-24 left-1/2 -translate-x-1/2 z-50 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-bg-main/95 backdrop-blur px-5 py-4 shadow-xl max-w-md mx-4"
          >
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-text-subtle">{loginError}</p>
            <button onClick={() => setLoginError(null)} aria-label="Закрыть" className="text-text-muted">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <main>
        {loading ? (
          <div className="pt-40 pb-40 flex justify-center text-text-muted">
            <Spinner className="w-8 h-8" />
          </div>
        ) : path === '/admin' ? (
          <Admin today={today} />
        ) : path === '/profile' ? (
          <Profile onNavigate={navigate} />
        ) : (
          <Landing today={today} />
        )}
      </main>

      <Footer onNavigate={navigate} onBook={goToBooking} />

      {/* На телефоне кнопка записи всегда под рукой */}
      {path === '/' && (
        <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-glass backdrop-blur-xl px-4 py-3">
          <button
            onClick={goToBooking}
            className="w-full py-3.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold transition-colors"
          >
            Записаться онлайн
          </button>
        </div>
      )}
    </div>
  );
}
