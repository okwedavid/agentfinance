"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/api";
import { useState } from "react";

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard', icon: '⚡' },
  { href: '/analytics', label: 'Analytics', icon: '📊' },
  { href: '/agents',    label: 'Agents',    icon: '🤖' },
  { href: '/wallet',    label: 'Wallet',    icon: '💳' },
  { href: '/profile',   label: 'Profile',   icon: '👤' },
  { href: '/settings',  label: 'Settings',  icon: '⚙️' },
];

interface NavProps {
  username?: string;
  wsStatus?: 'live' | 'connecting' | 'offline';
  right?: React.ReactNode;
}

export function TopNav({ username, wsStatus = 'connecting', right }: NavProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const wsColors = {
    live:       'border-emerald-700/40 text-emerald-400 bg-emerald-900/20',
    connecting: 'border-yellow-700/40 text-yellow-400 bg-yellow-900/20',
    offline:    'border-red-700/40 text-red-400 bg-red-900/20',
  };
  const wsDot = {
    live: 'bg-emerald-400 animate-pulse',
    connecting: 'bg-yellow-400',
    offline: 'bg-red-400',
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-white/[0.05] bg-[#060b16]/95 backdrop-blur">
        {/* Single row — everything uses flex-shrink-0 where needed, flex-1 for spacer */}
        <div className="px-4 h-14 flex items-center gap-2 max-w-7xl mx-auto w-full">
          {/* Brand */}
          <Link href="/dashboard" className="flex items-center gap-2 flex-shrink-0">
            <span className="text-sm font-bold gradient-text">AgentFinance</span>
          </Link>

          {username && (
            <span className="text-blue-400/60 text-xs hidden sm:inline flex-shrink-0">/ {username}</span>
          )}

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-0.5 ml-4">
            {NAV_LINKS.map(l => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex-shrink-0 ${
                  pathname === l.href || pathname.startsWith(l.href + '/')
                    ? 'bg-blue-600/20 text-blue-300 border border-blue-600/30'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="flex-1" />

          {/* WS status */}
          <div className={`hidden sm:flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border flex-shrink-0 ${wsColors[wsStatus]}`}>
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${wsDot[wsStatus]}`} />
            <span className="hidden lg:inline">{wsStatus === 'live' ? 'Live' : wsStatus === 'connecting' ? 'Connecting' : 'Offline'}</span>
          </div>

          {/* Right slot */}
          {right && <div className="flex-shrink-0">{right}</div>}

          {/* Sign out */}
          <button
            onClick={() => { logout(); window.location.href = '/login'; }}
            className="text-xs text-gray-500 hover:text-gray-300 flex-shrink-0 hidden sm:block"
          >
            Sign out
          </button>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 transition-colors"
            aria-label="Menu"
          >
            <div className="flex flex-col gap-1">
              <div className={`w-4 h-0.5 bg-gray-400 transition-all ${mobileOpen ? 'rotate-45 translate-y-1.5' : ''}`} />
              <div className={`w-4 h-0.5 bg-gray-400 transition-all ${mobileOpen ? 'opacity-0' : ''}`} />
              <div className={`w-4 h-0.5 bg-gray-400 transition-all ${mobileOpen ? '-rotate-45 -translate-y-1.5' : ''}`} />
            </div>
          </button>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-white/[0.05] bg-[#060b16] px-4 py-3">
            <nav className="flex flex-col gap-1">
              {NAV_LINKS.map(l => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                    pathname === l.href
                      ? 'bg-blue-600/20 text-blue-300'
                      : 'text-gray-300 hover:bg-white/5'
                  }`}
                >
                  <span>{l.icon}</span>
                  {l.label}
                </Link>
              ))}
              <button
                onClick={() => { logout(); window.location.href = '/login'; }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-500 hover:bg-white/5 mt-1 border-t border-white/[0.05] pt-3"
              >
                <span>🚪</span> Sign out
              </button>
            </nav>
          </div>
        )}
      </header>
    </>
  );
}

// Bottom nav for mobile — shows on small screens
export function BottomNav() {
  const pathname = usePathname();
  const short = NAV_LINKS.slice(0, 5); // Show first 5

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#060b16]/95 backdrop-blur border-t border-white/[0.05] safe-bottom">
      <div className="flex items-center">
        {short.map(l => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors ${
              pathname === l.href ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <span className="text-lg leading-none">{l.icon}</span>
            <span className="text-[10px]">{l.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function PageFooter() {
  return (
    <footer className="border-t border-white/[0.05] mt-auto pb-16 md:pb-0">
      <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2">
        <p className="text-gray-600 text-xs">© 2025 AgentFinance · Built by <span className="text-gray-400">okwedavid</span></p>
        <div className="flex items-center gap-4 text-xs text-gray-600">
          <Link href="/dashboard" className="hover:text-gray-400 transition-colors">Dashboard</Link>
          <Link href="/analytics" className="hover:text-gray-400 transition-colors">Analytics</Link>
          <Link href="/wallet" className="hover:text-gray-400 transition-colors">Wallet</Link>
          <Link href="/settings" className="hover:text-gray-400 transition-colors">Settings</Link>
          <span>All rights reserved</span>
        </div>
      </div>
    </footer>
  );
}