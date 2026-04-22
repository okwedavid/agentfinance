"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useState } from "react";
import type { WsStatus } from "@/hooks/useWebSocket";

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard', icon: '⚡', short: 'Home' },
  { href: '/analytics', label: 'Analytics',  icon: '📊', short: 'Stats' },
  { href: '/agents',    label: 'Agents',     icon: '🤖', short: 'Agents' },
  { href: '/wallet',    label: 'Wallet',     icon: '💳', short: 'Wallet' },
  { href: '/profile',   label: 'Profile',    icon: '👤', short: 'Profile' },
  { href: '/settings',  label: 'Settings',   icon: '⚙️', short: 'Settings' },
];

interface NavProps {
  wsStatus?: WsStatus;
}

export function TopNav({ wsStatus = 'connecting' }: NavProps) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const wsLabel = { live: 'Live', connecting: 'Connecting', offline: 'Offline' }[wsStatus];
  const wsClass = {
    live:       'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    connecting: 'text-amber-400  border-amber-500/30  bg-amber-500/10',
    offline:    'text-red-400    border-red-500/30    bg-red-500/10',
  }[wsStatus];
  const dotClass = {
    live:       'bg-emerald-400 animate-[pulse-dot_2s_ease-in-out_infinite]',
    connecting: 'bg-amber-400   animate-[spin_1.5s_linear_infinite] rounded-none',
    offline:    'bg-red-400',
  }[wsStatus];

  return (
    <>
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-50 border-b border-white/[0.06] glass-heavy safe-top">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">

          {/* Brand */}
          <Link href="/dashboard" className="flex items-center gap-2 flex-shrink-0 group">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-xs font-black">A</div>
            <span className="text-sm font-bold gradient-text hidden sm:inline">AgentFinance</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-0.5 ml-3">
            {NAV_LINKS.map(l => {
              const active = pathname === l.href || pathname.startsWith(l.href + '/');
              return (
                <Link key={l.href} href={l.href}
                  className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all duration-150 whitespace-nowrap ${
                    active
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/25'
                      : 'text-gray-400 hover:text-white hover:bg-white/[0.06]'
                  }`}>
                  <span className="text-sm leading-none">{l.icon}</span>
                  {l.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex-1" />

          {/* WS status badge — dynamic */}
          <div className={`hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border flex-shrink-0 transition-all duration-500 ${wsClass}`}>
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`} />
            <span className="hidden lg:inline font-medium">{wsLabel}</span>
          </div>

          {/* User pill */}
          {user && (
            <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-xs font-bold">
                {(user.displayName || user.username).slice(0,2).toUpperCase()}
              </div>
              <button onClick={logout}
                className="text-xs text-gray-500 hover:text-gray-200 transition-colors">
                Sign out
              </button>
            </div>
          )}

          {/* Mobile hamburger */}
          <button
            onClick={() => setOpen(o => !o)}
            className="md:hidden flex-shrink-0 w-9 h-9 flex flex-col items-center justify-center gap-1 rounded-xl hover:bg-white/[0.06] transition-colors"
            aria-label="Toggle menu"
          >
            <span className={`block w-5 h-0.5 bg-gray-300 rounded transition-all duration-200 ${open ? 'rotate-45 translate-y-[6px]' : ''}`} />
            <span className={`block w-5 h-0.5 bg-gray-300 rounded transition-all duration-200 ${open ? 'opacity-0' : ''}`} />
            <span className={`block w-5 h-0.5 bg-gray-300 rounded transition-all duration-200 ${open ? '-rotate-45 -translate-y-[6px]' : ''}`} />
          </button>
        </div>

        {/* ── Mobile dropdown (fixed height collapse) ── */}
        <div className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out ${open ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
          <div className="px-3 py-3 border-t border-white/[0.06] space-y-1 animate-slide-down">
            {/* WS badge in mobile menu */}
            <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl border mb-2 w-fit ${wsClass}`}>
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`} />
              {wsLabel}
            </div>

            {NAV_LINKS.map(l => {
              const active = pathname === l.href;
              return (
                <Link key={l.href} href={l.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                    active
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/25'
                      : 'text-gray-300 hover:bg-white/[0.06] hover:text-white'
                  }`}>
                  <span className="text-xl">{l.icon}</span>
                  {l.label}
                </Link>
              );
            })}

            {/* Sign out in mobile menu */}
            <button onClick={() => { setOpen(false); logout(); }}
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-gray-500 hover:text-red-400 hover:bg-red-500/[0.07] transition-all w-full mt-1 border-t border-white/[0.05] pt-3">
              <span className="text-xl">🚪</span>
              Sign out
            </button>
          </div>
        </div>
      </header>
    </>
  );
}

/** Bottom tab bar — mobile only, 5 most important links */
export function BottomNav() {
  const pathname = usePathname();
  const primary = NAV_LINKS.slice(0, 5); // dashboard, analytics, agents, wallet, profile

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass-heavy border-t border-white/[0.06] safe-bottom">
      <div className="flex">
        {primary.map(l => {
          const active = pathname === l.href || pathname.startsWith(l.href + '/');
          return (
            <Link key={l.href} href={l.href}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-all ${
                active ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'
              }`}>
              <span className={`text-xl leading-none transition-transform ${active ? 'scale-110' : ''}`}>{l.icon}</span>
              <span className={`text-[9px] font-medium ${active ? 'text-blue-400' : ''}`}>{l.short}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function PageFooter() {
  return (
    <footer className="border-t border-white/[0.05] mt-auto pb-20 md:pb-0">
      <div className="max-w-7xl mx-auto px-4 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-gray-600 text-xs">
          © {new Date().getFullYear()} AgentFinance · Built by <span className="text-gray-400">okwedavid</span>
        </p>
        <div className="flex items-center gap-5 text-xs text-gray-600">
          {NAV_LINKS.slice(0,4).map(l => (
            <Link key={l.href} href={l.href} className="hover:text-gray-300 transition-colors">{l.label}</Link>
          ))}
          <span>All rights reserved</span>
        </div>
      </div>
    </footer>
  );
}