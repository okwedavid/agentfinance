/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {},
  // Remove outputFileTracingRoot - it was causing the standalone server to be
  // nested at .next/standalone/agentfinance/frontend/server.js instead of
  // .next/standalone/server.js
  //
  // If you need monorepo file tracing, set this back and update server.js
  // outputFileTracingRoot: path.join(__dirname, '../../'),
};

export default nextConfig;