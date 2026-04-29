import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { LogOut, Menu, X } from 'lucide-react';
import Logo from './Logo';
import Avatar from './Avatar';
import { useAuth } from '../lib/auth';

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
}

export default function Sidebar({ items, title, subtitle }: Props) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close drawer on route change
  useEffect(() => { setOpen(false); }, [location.pathname]);

  // Lock body scroll while drawer open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = open ? 'hidden' : prev;
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const body = (
    <>
      <div className="flex items-center justify-between">
        <Logo size={26} />
        <button
          onClick={() => setOpen(false)}
          className="lg:hidden w-10 h-10 rounded-2xl bg-white/60 text-dusk-500 flex items-center justify-center hover:bg-white/80 transition"
          aria-label="Fechar menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="glass p-4 animate-fade-up">
        <div className="flex items-center gap-3">
          <Avatar name={`${user?.first_name} ${user?.last_name}`} size="md" />
          <div className="min-w-0">
            <div className="font-semibold text-dusk-500 truncate">{user?.first_name} {user?.last_name}</div>
            <div className="text-xs text-dusk-200 truncate">{subtitle || (user?.unit_number ? `Unit ${user.unit_number}` : user?.email)}</div>
          </div>
        </div>
        <div className="mt-3 chip">{title}</div>
      </div>

      <nav className="space-y-1 pr-1">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to.endsWith('/app') || it.to.endsWith('/board')}
            className={({ isActive }) => clsx(
              'flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-sm font-medium transition-all w-full',
              isActive
                ? 'bg-white/70 text-dusk-500 shadow-clay border border-white/80'
                : 'text-dusk-300 hover:bg-white/40 hover:text-dusk-500',
            )}
          >
            <it.icon className="w-[18px] h-[18px]" />
            <span className="flex-1">{it.label}</span>
            {it.badge !== undefined && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-peach-200 text-peach-500">{it.badge}</span>
            )}
          </NavLink>
        ))}
      </nav>

      <button
        onClick={logout}
        className="flex shrink-0 items-center gap-3 px-3.5 py-2.5 rounded-2xl text-sm font-medium text-dusk-300 hover:bg-white/40 hover:text-dusk-500 transition"
      >
        <LogOut className="w-[18px] h-[18px]" />
        Sair
      </button>
    </>
  );

  return (
    <>
      {/* Mobile top bar — only visible below lg */}
      <header className="lg:hidden sticky top-0 z-20 px-4 py-3 flex items-center justify-between backdrop-blur-xl bg-cream-50/60 border-b border-white/40">
        <Logo size={24} />
        <div className="flex items-center gap-2">
          <div className="chip !py-1 !px-2.5 text-[11px]">{title}</div>
          <button
            onClick={() => setOpen(true)}
            className="w-10 h-10 rounded-2xl bg-white/70 text-dusk-500 flex items-center justify-center shadow-clay-sm hover:bg-white/90 transition"
            aria-label="Abrir menu"
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
          'shrink-0 p-4 lg:p-6 flex flex-col gap-4 lg:gap-6 overflow-y-auto',
          // mobile: drawer
          'fixed lg:static inset-y-0 left-0 z-50 w-[86%] max-w-[340px] lg:w-72 lg:max-w-none',
          'bg-cream-50/95 lg:bg-transparent backdrop-blur-xl lg:backdrop-blur-0',
          'shadow-clay-lg lg:shadow-none border-r border-white/50 lg:border-none',
          'lg:sticky lg:top-0 lg:h-screen',
          'transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
        aria-hidden={!open && typeof window !== 'undefined' && window.innerWidth < 1024}
      >
        {body}
      </aside>
    </>
  );
}
