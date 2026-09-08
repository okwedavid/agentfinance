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

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {},
  outputFileTracingRoot: path.join(process.cwd(), ".."),
};

export default nextConfig;