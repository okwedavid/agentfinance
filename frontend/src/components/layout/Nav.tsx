"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import type { WsStatus } from "@/hooks/useWebSocket";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", short: "Home", icon: "◈" },
  { href: "/analytics", label: "Analytics", short: "Stats", icon: "△" },
  { href: "/agents", label: "Agents", short: "Fleet", icon: "✦" },
  { href: "/wallet", label: "Wallet", short: "Wallet", icon: "⬡" },
  { href: "/profile", label: "Profile", short: "Profile", icon: "◎" },
  { href: "/settings", label: "Settings", short: "Config", icon: "☰" },
];

interface NavProps {
  wsStatus?: WsStatus;
}

const statusText = {
  live: "Live sync",
  connecting: "Connecting",
  offline: "Offline",
};

const statusClass = {
  live: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
  connecting: "border-amber-400/20 bg-amber-400/10 text-amber-200",
  offline: "border-rose-400/20 bg-rose-400/10 text-rose-300",
};

const statusDotClass = {
  live: "bg-emerald-300 animate-pulse",
  connecting: "bg-amber-300 animate-pulse",
  offline: "bg-rose-300",
};

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TopNav({ wsStatus = "connecting" }: NavProps) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const initials = useMemo(() => {
    const label = user?.displayName || user?.username || "AF";
    return label.slice(0, 2).toUpperCase();
  }, [user]);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[rgba(4,10,20,0.86)] backdrop-blur-2xl safe-top">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute -top-10 left-1/4 h-24 w-24 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute -right-8 top-0 h-28 w-28 rounded-full bg-orange-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/15 bg-[linear-gradient(135deg,#0f172a,#102647,#143a5c)] shadow-[0_12px_40px_rgba(15,118,110,0.18)]">
            <span className="text-sm font-black text-cyan-200">AF</span>
          </div>
          <div className="hidden sm:block">
            <div className="text-sm font-semibold tracking-[0.2em] text-cyan-100/90">AGENTFINANCE</div>
            <div className="text-[11px] text-slate-400">autonomous yield ops</div>
          </div>
        </Link>

        <nav className="ml-2 hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-full px-3 py-2 text-xs font-medium tracking-wide transition-all ${
                  active
                    ? "border border-cyan-400/25 bg-cyan-400/10 text-cyan-200 shadow-[0_0_24px_rgba(34,211,238,0.12)]"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        <div className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium sm:flex ${statusClass[wsStatus]}`}>
          <span className={`h-2 w-2 rounded-full ${statusDotClass[wsStatus]}`} />
          <span>{statusText[wsStatus]}</span>
        </div>

        {user && (
          <div className="hidden items-center gap-3 md:flex">
            <div className="text-right">
              <div className="text-xs font-medium text-white">{user.displayName || user.username}</div>
              <div className="text-[11px] text-slate-400">{user.walletAddress ? "wallet ready" : "wallet not linked"}</div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/15 bg-white/5 text-xs font-bold text-white">
              {initials}
            </div>
            <button onClick={logout} className="rounded-full border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:border-white/20 hover:bg-white/5 hover:text-white">
              Sign out
            </button>
          </div>
        )}

        <button
          onClick={() => setOpen((value) => !value)}
          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 lg:hidden"
          aria-label="Toggle navigation"
        >
          <span className="text-lg">{open ? "×" : "≡"}</span>
        </button>
      </div>

      <div className={`relative overflow-hidden border-t border-white/8 transition-all duration-300 lg:hidden ${open ? "max-h-[480px] opacity-100" : "max-h-0 opacity-0"}`}>
        <div className="space-y-2 px-4 py-4">
          <div className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs ${statusClass[wsStatus]}`}>
            <span className={`h-2 w-2 rounded-full ${statusDotClass[wsStatus]}`} />
            <span>{statusText[wsStatus]}</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {NAV_LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={`rounded-2xl border px-4 py-3 text-sm transition ${
                    active
                      ? "border-cyan-400/25 bg-cyan-400/10 text-cyan-200"
                      : "border-white/8 bg-white/4 text-slate-200 hover:bg-white/7"
                  }`}
                >
                  <div className="text-lg">{link.icon}</div>
                  <div className="mt-1">{link.label}</div>
                </Link>
              );
            })}
          </div>

          {user && (
            <div className="rounded-2xl border border-white/8 bg-white/4 p-3">
              <div className="text-sm font-medium text-white">{user.displayName || user.username}</div>
              <div className="mt-1 text-xs text-slate-400">{user.walletAddress || "No wallet linked yet"}</div>
              <button
                onClick={() => {
                  setOpen(false);
                  logout();
                }}
                className="mt-3 w-full rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/6"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const primary = NAV_LINKS.slice(0, 5);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[rgba(4,10,20,0.92)] backdrop-blur-2xl md:hidden safe-bottom">
      <div className="grid grid-cols-5">
        {primary.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition ${
                active ? "text-cyan-200" : "text-slate-400"
              }`}
            >
              <span className={`text-lg transition ${active ? "scale-110" : ""}`}>{link.icon}</span>
              <span>{link.short}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function PageFooter() {
  return (
    <footer className="mt-auto border-t border-white/8 bg-[rgba(2,6,14,0.65)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <p>AgentFinance builds autonomous research, execution, and review loops for modern crypto operators.</p>
        <div className="flex flex-wrap items-center gap-4">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="transition hover:text-slate-300">
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
