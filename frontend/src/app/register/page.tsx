"use client";
import { useEffect } from "react";
import Link from "next/link";

/**
 * Registration lives on the same auth shell as /login. /register reuses that
 * canonical route via ?mode=register so there is exactly one auth UI to
 * maintain and one redirect target after account deletion.
 */
export default function Register() {
  useEffect(() => {
    const current = window.location.search;
    const nextSearch = current.includes("mode=register") ? current : "?mode=register";
    window.location.replace(`/login${nextSearch}`);
  }, []);

  return (
    <div className="min-h-screen bg-[#050c18] flex items-center justify-center p-4">
      <div className="text-center">
        <div className="mx-auto h-9 w-9 border-2 border-white/10 border-t-blue-500 rounded-full animate-spin" />
        <Link href="/login?mode=register" className="mt-6 block text-sm text-cyan-200 hover:underline">
          Create your account →
        </Link>
      </div>
    </div>
  );
}