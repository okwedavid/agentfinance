import '../styles/globals.css';
import { AuthProvider } from '@/context/AuthContext';
import ProtectedLayoutClient from '@/components/ProtectedLayoutClient';
import Link from 'next/link'; // For smooth navigation
import  AgentStatus  from '@/components/AgentStatus'; 
import { AgentOutput } from '@/components/AgentOutput';


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>AgentFinance – Real-time Multi-Agent Platform</title>
        <meta name="description" content="156+ AI agents · Live dispatch · 75% success rate" />
      </head>
      <body>
        <AuthProvider>
          <div className="min-h-screen bg-gradient-to-b from-[#071033] to-[#0a0f2e] text-white">
            
            {/* 1. TOP LEVEL AGENT OUTPUT (Premium Sticky Banner) */}
            <AgentStatus />
            <AgentOutput data={{}} />
            {/* 2. NAVBAR (Updated with Link components for better Analytics routing) */}
            <nav className="backdrop-blur bg-white/5 p-4 sticky top-12 z-40 border-b border-white/10">
              <div className="max-w-7xl mx-auto flex items-center justify-between">
                <Link href="/" className="text-xl font-semibold hover:text-green-400 transition-colors">
                  AgentFinance
                </Link>
                <div className="flex items-center space-x-6">
                  <Link href="/dashboard" className="text-sm hover:text-green-400 transition-colors">Dashboard</Link>
                  <Link href="/analytics" className="text-sm hover:text-green-400 transition-colors">Analytics</Link>
                  <Link href="/wallet" className="text-sm hover:text-green-400 transition-colors">Wallet</Link>
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
