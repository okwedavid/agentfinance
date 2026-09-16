"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setToken } from "@/lib/api";

// Completes the OAuth flow. The backend redirects here with the signed session
// token in the URL fragment (#access_token=...), so the token is never sent in
// any HTTP request or written to server logs. We store it and continue to the
// dashboard.
export default function OAuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = params.get("access_token");
    const err = params.get("error");

    if (err) {
      setError(err);
      return;
    }
    if (!token) {
      setError("Login could not be completed. No session token was returned.");
      return;
    }

    setToken(token);
    // Drop the token fragment from the address bar so it does not linger in
    // browser history.
    window.history.replaceState(null, "", window.location.pathname);
    router.replace("/dashboard");
  }, [router]);

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
            <p className="mt-2 text-sm text-gray-400">Completing your session securely.</p>
          </>
        )}
      </div>
    </div>
  );
}