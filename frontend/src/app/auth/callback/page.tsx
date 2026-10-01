"use client";

// Post-callback landing page.
//
// The session is now established entirely by the BACKEND, which sets an HttpOnly
// cookie and then redirects here. This page therefore receives NO credential:
//
//   OLD: backend -> /auth/callback#access_token=<session JWT>
//        the page copied the JWT into sessionStorage and sent it as a Bearer
//        header. Script-readable, per-tab, and it died on every refresh.
//
//   NEW: backend sets the cookie -> /dashboard?provider=google&account=created
//        the session is in a cookie the page cannot read, so there is nothing to
//        store and nothing to leak.
//
// The authorization code never reaches this page: the callback is on the backend
// at /auth/oauth/<provider>/callback, which is where the code is redeemed.

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { useAuth } from "@/context/AuthContext";

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { status, refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A callback error is delivered by the backend as a fragment on /login, but
    // handle a query-carried error too so this route fails visibly rather than
    // silently bouncing.
    const qError = params?.get("oauth_error");
    if (qError) {
      setError(decodeURIComponent(qError));
      return;
    }

    // AUTH_CHECKING means /auth/me has not answered yet. Waiting here is exactly
    // the fix for the "reaches dashboard then logs out" symptom: the old code
    // read "no user yet" as "logged out" and redirected before the cookie-based
    // session had been confirmed.
    if (status === "UNAUTHENTICATED") {
      setError("Sign-in did not complete. Please try again.");
      return;
    }
    if (status === "AUTHENTICATED") {
      router.replace("/dashboard");
    }
  }, [status, router, params]);

  return (
    <div className="min-h-screen bg-[#050c18] flex items-center justify-center p-4">
      <div className="glass-heavy rounded-2xl p-6 w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 text-xl font-black animate-glow">
          A
        </div>
        {error ? (
          <>
            <h1 className="text-lg font-bold text-red-400">Login failed</h1>
            <p className="mt-2 text-sm text-gray-400 break-words">{error}</p>
            <Link href="/login" className="btn-primary mt-5 w-full justify-center">
              Back to login
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold">Signing you in…</h1>
            <p className="mt-2 text-sm text-gray-400">Confirming your session.</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#050c18]" />}>
      <CallbackInner />
    </Suspense>
  );
}
