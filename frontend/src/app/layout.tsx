// frontend/src/app/layout.tsx
import '../styles/globals.css';
import { AuthProvider } from '@/context/AuthContext';
import ProtectedLayoutClient from '@/components/ProtectedLayoutClient';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

// Optional: Force redirect from root (/) to /login if not authenticated
function RootRedirect() {
  const pathname = headers().get('x-pathname') || '';
  const isLoggedIn = !!document?.cookie?.includes('token'); // client fallback

  // This runs only on the server side for the root page
  if (typeof window === 'undefined' && pathname === '/') {
    redirect('/login');
  }
  return null;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>AgentFinance – Real-time Multi-Agent Platform</title>
        <meta name="description" content="156+ AI agents · Live dispatch · 75% success rate" />
      </head>
      <body>
        {/* This forces root (/) → /login redirect on Vercel */}
        <RootRedirect />

        <AuthProvider>
          <div className="min-h-screen bg-gradient-to-b from-[#071033] to-[#0a0f2e] text-white">
            {/* Top Navbar – visible everywhere */}
            <nav className="backdrop-blur bg-white/5 p-4 sticky top-0 z-40 border-b border-white/10">
              <div className="max-w-7xl mx-auto flex items-center justify-between">
                <div className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                  AgentFinance
                </div>
                <div className="flex items-center space-x-8">
                  <a href="/dashboard" className="text-sm hover:text-cyan-400 transition">
                    Dashboard
                  </a>
                  <a href="/analytics" className="text-sm hover:text-cyan-400 transition">
                    Analytics
                  </a>
                </div>
              </div>
            </nav>

            {/* Main content with protection */}
            <main className="p-6 max-w-7xl mx-auto">
              <ProtectedLayoutClient>{children}</ProtectedLayoutClient>
            </main>

            {/* Optional footer */}
            <footer className="text-center text-xs text-gray-500 py-8 border-t border-white/10 mt-20">
              © 2025 AgentFinance – Built by David Okwe & Grok
            </footer>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
};