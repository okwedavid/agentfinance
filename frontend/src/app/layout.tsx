import '../styles/globals.css';
import { AuthProvider } from '@/context/AuthContext';
import ProtectedLayoutClient from '@/components/ProtectedLayoutClient';
import Link from 'next/link';
import AgentStatus from '@/components/AgentStatus';
import { AgentOutput } from '@/components/AgentOutput';
import { Fira_Code } from 'next/font/google'; // Import Fira Code

// Initialize Fira Code
const firaCode = Fira_Code({
  subsets: ['latin'],
  variable: '--font-fira-code',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${firaCode.variable}`}>
      <head>
        <title>AgentFinance – Real-time Multi-Agent Platform</title>
        <meta name="description" content="156+ AI agents · Live dispatch · 75% success rate" />
      </head>
      <body className="font-mono antialiased"> 
        <AuthProvider>
          <div className="min-h-screen bg-[#0f172a] text-white">
            
            {/* 1. TOP LEVEL AGENT OUTPUT (Premium Sticky Banner) */}
            {/* We pass an empty object to data? to satisfy TypeScript requirements */}
            <AgentStatus />
            <AgentOutput />

            {/* 2. NAVBAR (Sticky under the Agent Bar) */}
            <nav className="backdrop-blur bg-white/5 px-4 py-1 sticky top-[37px] z-40 border-b border-white/10">
              <div className="max-w-7xl mx-auto flex items-center justify-between">
                <Link href="/" className="text-lg font-semibold hover:text-blue-400 transition-colors">
                  AgentFinance
                </Link>
                <div className="flex items-center space-x-6">
                  <Link className="text-xs hover:text-blue-400 transition-colors" href="/dashboard">Dashboard</Link>
                  <Link className="text-xs hover:text-blue-400 transition-colors" href="/analytics">Analytics</Link>
                  <Link className="text-xs hover:text-blue-400 transition-colors" href="/wallet">Wallet</Link>
                </div>
              </div>
            </nav>

            <main className="p-6 max-w-7xl mx-auto">
              <ProtectedLayoutClient>{children}</ProtectedLayoutClient>
            </main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
