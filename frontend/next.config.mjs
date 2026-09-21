import path from "path";

// NEXT_PUBLIC_* variables are inlined into the client bundle at build time.
// Production must be told which backend it talks to; we deliberately fail the
// build instead of silently baking in an obsolete/hardcoded backend URL.
if (
  process.env.NODE_ENV === "production" &&
  !process.env.NEXT_PUBLIC_API_URL
) {
  throw new Error(
    "NEXT_PUBLIC_API_URL is required for a production build. " +
      "Set it in Render to the backend origin (e.g. https://<backend>.onrender.com) and rebuild.",
  );
}

const apiOrigin = (process.env.NEXT_PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
const wsOrigin = (process.env.NEXT_PUBLIC_WS_URL || "").trim().replace(/\/+$/, "")
  || (apiOrigin ? apiOrigin.replace(/^http/, "ws") : "");

// Content-Security-Policy for the Next.js document. Connect-src is the API and
// WebSocket origins baked in at build time; scripts/styles fall back to
// 'unsafe-inline' to keep Next.js's bootstrapping and third-party widgets
// working while every other source stays locked to 'self'.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${[apiOrigin, wsOrigin].filter(Boolean).join(" ")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {},
  poweredByHeader: false,
  outputFileTracingRoot: path.join(process.cwd(), ".."),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;