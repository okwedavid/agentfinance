"use client";

// Route guard for authenticated pages.
//
// THE RACE THIS FIXES
// The guard used `loading: boolean` + `user: User | null`. On a hard refresh the
// sequence was:
//
//   t0  page mounts, user === null, loading === true
//   t1  AuthProvider starts GET /auth/me
//   t2  ...any code that reads user === null as "signed out" redirects to
//       /login, even though /auth/me is still in flight
//
// `loading` cannot distinguish "the check has not finished" from "the check
// finished and found nothing", so a pending check was indistinguishable from a
// confirmed logout. AuthContext now exposes an explicit three-state `status`,
// and this guard only redirects from UNAUTHENTICATED.
//
// A separate local guard is used instead of `usePathname()` because Next's
// pathname is not reactive on every navigation, which can leave a guard stuck on
// the previous route's answer.

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";

const PUBLIC_PATHS = ["/login", "/register", "/auth"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default function ProtectedLayoutClient({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Mirror the pathname into state so a guard effect re-runs on navigation even
  // where usePathname's value updates late.
  const [route, setRoute] = useState(pathname);
  useEffect(() => {
    setRoute(pathname);
  }, [pathname]);

  const routeIsPublic = isPublicPath(route || "/");

  // A public path renders immediately. /login is usable without a session, so
  // gating it behind a spinner would only add latency.
  if (routeIsPublic) {
    return <>{children}</>;
  }

  // While the check is pending on a PROTECTED path, hold the previous content and
  // wait. Redirecting here is the original bug: "not confirmed yet" was treated as
  // "signed out", which threw signed-in users back to /login on every reload.
  if (status === "AUTH_CHECKING") {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Only a CONFIRMED lack of session redirects, and via the client router so the
  // SPA shell is preserved rather than reloaded.
  if (status === "UNAUTHENTICATED") {
    const next = route && route !== "/" ? `?next=${encodeURIComponent(route)}` : "";
    router.replace(`/login${next}`);
    return null;
  }

  return <>{children}</>;
}
