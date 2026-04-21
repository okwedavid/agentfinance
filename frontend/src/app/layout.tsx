import type { Metadata, Viewport } from 'next';
import '../styles/globals.css';
import { AuthProvider } from '@/context/AuthContext';

export const metadata: Metadata = {
  title: 'AgentFinance – AI Agents That Generate Income',
  description: 'Deploy AI agents that research, trade, create content and generate real income for you — 24/7 on autopilot.',
  keywords: 'AI agents, crypto, DeFi, yield farming, autonomous agents, income generation',
  authors: [{ name: 'okwedavid' }],
  openGraph: {
    title: 'AgentFinance',
    description: 'AI agents working 24/7 to generate income for you',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // This is the key fix for mobile shifting — prevents content wider than viewport
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Prevent mobile zoom and horizontal scroll */}
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
      </head>
      <body className="bg-[#060b16] text-white antialiased overflow-x-hidden">
        {/* overflow-x-hidden on body prevents horizontal scroll/shift on mobile */}
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}