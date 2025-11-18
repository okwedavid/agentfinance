import '../styles/globals.css';
import { AuthProvider } from '@/context/AuthContext';
import ProtectedLayoutClient from '@/components/ProtectedLayoutClient';

const metadata = { title: 'AgentFinance' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <div className="min-h-screen bg-gradient-to-b from-[#071033] to-[#0a0f2e] text-white">
            <nav className="backdrop-blur bg-white/5 p-4 sticky top-0 z-40">
              <div className="max-w-7xl mx-auto flex items-center justify-between">
                <div className="text-xl font-semibold">AgentFinance</div>
                <div className="flex items-center space-x-4">
                  <a href="/dashboard" className="text-sm">Dashboard</a>
                  <a href="/analytics" className="text-sm">Analytics</a>
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
