import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, LogOut, Menu, X } from 'lucide-react';
import Logo from './Logo';
import Avatar from './Avatar';
import { useAuth } from '../lib/auth';
import { SidebarLangSwitcher, t, useLocale } from '../lib/i18n';

const COLLAPSED_KEY = 'condoos_sidebar_collapsed';

export interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number | string;
}

interface Props {
  items: NavItem[];
  title: string;
  subtitle?: string;
  // Optional content rendered between the user profile card and the nav
  // list. BoardApp uses this to inject a live WhatsApp connectivity pill
  // so the admin sees session status across every board page without a
  // sub-route. Kept generic (ReactNode) so future surfaces — billing
  // status, integration health, anything — can use the same slot.
  headerSlot?: React.ReactNode;
}

export default function Sidebar({ items, title, subtitle, headerSlot }: Props) {
  const { user, logout } = useAuth();
  const { locale } = useLocale();
  const tr = (key: string) => t(key, locale);
  const [open, setOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true,
  );
  // Desktop collapse — icon-only rail. Persisted so the choice survives a
  // reload. Mobile keeps its full-width drawer (collapsed mode would be
  // confusing on a narrow viewport).
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  }, [collapsed]);
  const compact = collapsed && isDesktop;
  const location = useLocation();

  // Close drawer on route change
  useEffect(() => { setOpen(false); }, [location.pathname]);

  // Lock body scroll while drawer open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = open ? 'hidden' : prev;
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const body = (
    <>
      <div className={clsx('flex items-center', compact ? 'justify-center' : 'justify-between')}>
        <Logo size={compact ? 22 : 26} />
        <button
          onClick={() => setOpen(false)}
          className="lg:hidden w-10 h-10 rounded-2xl bg-white/60 text-dusk-500 flex items-center justify-center hover:bg-white/80 transition"
          aria-label={tr('Fechar menu')}
        >
          <X className="w-5 h-5" />
        </button>
        {/* Desktop collapse toggle — flush right, only renders on lg. The
            mobile drawer already has its own dismiss (the X above). */}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className={clsx(
            'hidden lg:inline-flex w-8 h-8 items-center justify-center rounded-xl bg-white/60 text-dusk-400 hover:bg-white/80 transition',
            compact && 'mt-3',
          )}
          aria-label={collapsed ? tr('Expandir menu') : tr('Recolher menu')}
          title={collapsed ? tr('Expandir menu') : tr('Recolher menu')}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {compact ? (
        <div className="flex justify-center">
          <Avatar name={`${user?.first_name} ${user?.last_name}`} size="md" />
        </div>
      ) : (
        <div className="glass p-4 animate-fade-up">
          <div className="flex items-center gap-3">
            <Avatar name={`${user?.first_name} ${user?.last_name}`} size="md" />
            <div className="min-w-0">
              <div className="font-semibold text-dusk-500 truncate">{user?.first_name} {user?.last_name}</div>
              <div className="text-xs text-dusk-200 truncate">{subtitle || (user?.unit_number ? `Unit ${user.unit_number}` : user?.email)}</div>
            </div>
          </div>
          <div className="mt-3 chip">{tr(title)}</div>
        </div>
      )}

      {!compact && headerSlot}

      <nav className="flex-1 overflow-y-auto space-y-1 pr-1">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to.endsWith('/app') || it.to.endsWith('/board')}
            title={compact ? tr(it.label) : undefined}
            className={({ isActive }) => clsx(
              'flex items-center rounded-2xl text-sm font-medium transition-all w-full',
              compact ? 'justify-center px-2 py-2.5' : 'gap-3 px-3.5 py-2.5',
              isActive
                ? 'bg-white/70 text-dusk-500 shadow-clay border border-white/80'
                : 'text-dusk-300 hover:bg-white/40 hover:text-dusk-500',
            )}
          >
            <it.icon className="w-[18px] h-[18px]" />
            {!compact && <span className="flex-1">{tr(it.label)}</span>}
            {!compact && it.badge !== undefined && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-peach-200 text-peach-500">{it.badge}</span>
            )}
            {compact && it.badge !== undefined && (
              <span className="absolute ml-5 -mt-3 text-[10px] font-semibold w-4 h-4 leading-4 text-center rounded-full bg-peach-200 text-peach-500">{it.badge}</span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto pt-2 border-t border-white/30 space-y-2">
        {!compact && <SidebarLangSwitcher />}
        <button
          onClick={logout}
          title={compact ? tr('Sair') : undefined}
          className={clsx(
            'flex w-full shrink-0 items-center rounded-2xl text-sm font-medium text-dusk-300 hover:bg-white/40 hover:text-dusk-500 transition',
            compact ? 'justify-center px-2 py-2.5' : 'gap-3 px-3.5 py-2.5',
          )}
        >
          <LogOut className="w-[18px] h-[18px]" />
          {!compact && tr('Sair')}
        </button>
      </div>
    </>
  );

  const drawerHidden = !open && !isDesktop;

  return (
    <>
      {/* Mobile top bar — only visible below lg */}
      <header className="lg:hidden sticky top-0 z-20 px-4 py-3 flex items-center justify-between backdrop-blur-xl bg-cream-50/60 border-b border-white/40">
        <Logo size={24} />
        <div className="flex items-center gap-2">
          <div className="chip !py-1 !px-2.5 text-[11px]">{tr(title)}</div>
          <button
            onClick={() => setOpen(true)}
            className="w-10 h-10 rounded-2xl bg-white/70 text-dusk-500 flex items-center justify-center shadow-clay-sm hover:bg-white/90 transition"
            aria-label={tr('Abrir menu')}
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Mobile backdrop */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-dusk-500/30 backdrop-blur-sm animate-fade-up"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar: sliding drawer on mobile, static on desktop */}
      <aside
        className={clsx(
          'shrink-0 p-4 flex flex-col gap-4 overflow-y-auto',
          // mobile: drawer
          'fixed lg:static inset-y-0 left-0 z-50 w-[86%] max-w-[340px] lg:max-w-none',
          // desktop width — compact (icon rail) vs full
          compact ? 'lg:p-3 lg:w-20 lg:gap-3' : 'lg:p-6 lg:w-72 lg:gap-6',
          'bg-cream-50/95 lg:bg-transparent backdrop-blur-xl lg:backdrop-blur-0',
          'shadow-clay-lg lg:shadow-none border-r border-white/50 lg:border-none',
          'lg:sticky lg:top-0 lg:h-screen',
          'transition-[width,padding,gap] duration-200 ease-out',
          'data-[mobile-open=true]:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
        aria-hidden={drawerHidden ? true : undefined}
      >
        {drawerHidden ? null : body}
      </aside>
    </>
  );
}
