import React from 'react';
import { LogOut, Moon, Phone, Sun, User } from 'lucide-react';
import { useSession } from '../lib/session';
import { VkLoginButton } from './VkLoginButton';

interface HeaderProps {
  isDark: boolean;
  onToggleTheme: () => void;
  onNavigate: (to: string) => void;
  onBook: () => void;
  path: string;
}

export function Header({ isDark, onToggleTheme, onNavigate, onBook, path }: HeaderProps) {
  const { user, logout } = useSession();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-glass backdrop-blur-xl transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-3">
        <button
          onClick={() => onNavigate('/')}
          className="text-2xl font-black tracking-tighter text-orange-500 shrink-0"
        >
          ВАЙБ.
        </button>

        <div className="flex items-center gap-2 sm:gap-4">
          <a
            href="tel:+79991792895"
            className="hidden lg:flex items-center gap-2 text-text-subtle hover:text-text-main transition-colors font-medium"
          >
            <Phone className="w-4 h-4 text-orange-500" />
            <span>+7 (999) 179-28-95</span>
          </a>

          <button
            onClick={onToggleTheme}
            className="p-2.5 bg-surface hover:bg-surface-hover border border-border rounded-full text-text-main transition-colors"
            aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
          >
            {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>

          {user ? (
            <>
              <button
                onClick={() => onNavigate('/profile')}
                className={`flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 transition-colors ${
                  path === '/profile'
                    ? 'border-orange-500/50 bg-orange-500/10'
                    : 'border-border bg-surface hover:bg-surface-hover'
                }`}
              >
                {user.photo ? (
                  <img src={user.photo} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <span className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center">
                    <User className="w-4 h-4 text-orange-500" />
                  </span>
                )}
                <span className="hidden sm:block text-sm font-medium">{user.firstName}</span>
                <span className="text-sm font-black text-orange-500">{user.bonusPercent}%</span>
              </button>
              <button
                onClick={() => void logout()}
                className="hidden sm:block p-2.5 bg-surface hover:bg-surface-hover border border-border rounded-full text-text-muted hover:text-text-main transition-colors"
                aria-label="Выйти"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </>
          ) : (
            <VkLoginButton compact />
          )}

          <button
            onClick={onBook}
            className="hidden sm:block px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-full text-sm font-bold transition-colors"
          >
            Записаться
          </button>
        </div>
      </div>
    </header>
  );
}
