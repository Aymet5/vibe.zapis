import { useSession } from '../lib/session';

/** Вход через ВК — полноценный редирект, потому что сессия ставится куки-заголовком. */
export function VkLoginButton({ compact = false, label }: { compact?: boolean; label?: string }) {
  const { config } = useSession();

  if (config && !config.vkLoginEnabled) {
    return compact ? null : (
      <p className="text-sm text-text-muted">
        Вход через ВКонтакте пока не подключён — запишитесь как гость или позвоните нам.
      </p>
    );
  }

  return (
    <a
      href="/api/auth/vk/start"
      className={`inline-flex items-center justify-center gap-2 rounded-full bg-[#0077FF] text-white font-bold
        transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0077FF]/40
        ${compact ? 'px-4 py-2.5 text-sm' : 'px-6 py-3.5'}`}
    >
      <VkGlyph />
      {label ?? (compact ? 'Войти' : 'Войти через ВКонтакте')}
    </a>
  );
}

function VkGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden>
      <path d="M13.2 18.4c-6 0-9.6-4.2-9.7-11.1h3c.1 5.1 2.4 7.2 4.2 7.7V7.3h2.8v4.3c1.7-.2 3.6-2.2 4.2-4.3h2.8c-.5 2.6-2.4 4.6-3.8 5.4 1.4.6 3.6 2.4 4.4 5.7h-3.1c-.6-2-2.3-3.6-4.5-3.8v3.8h-.3z" />
    </svg>
  );
}
