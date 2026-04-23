import React from 'react';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { LogOut } from 'lucide-react';
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
  return (
    <aside className="sticky top-0 h-screen w-72 shrink-0 p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Logo size={26} />
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

      <nav className="flex-1 space-y-1">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to.endsWith('/app') || it.to.endsWith('/board')}
            className={({ isActive }) => clsx(
              'flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-sm font-medium transition-all',
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
        className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-sm font-medium text-dusk-300 hover:bg-white/40 hover:text-dusk-500 transition"
      >
        <LogOut className="w-[18px] h-[18px]" />
        Sign out
      </button>
    </aside>
  );
}
