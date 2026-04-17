import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone', // This is the crucial line for Railway
  experimental: {},
  // We keep this to help Next.js find the monorepo root if needed
  outputFileTracingRoot: path.join(__dirname, '../../'), 
};

export default nextConfig;