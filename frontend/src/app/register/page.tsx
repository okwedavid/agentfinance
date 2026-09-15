"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";

export default function Register() {
  const { register } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(''); setMessage('');
    try {
      await register(username.trim(), email.trim(), password);
      setMessage('Account created! Redirecting...');
      setTimeout(() => { router.replace('/dashboard'); }, 600);
    } catch (err: any) {
      setError(err?.message || 'Cannot reach server. Try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800 flex items-center justify-center p-6">
      <Card className="w-full max-w-md bg-white/10 backdrop-blur-xl border border-white/10 text-white shadow-2xl">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">Create Account</CardTitle>
          <p className="text-center text-cyan-300 text-sm">AgentFinance Platform</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRegister} className="space-y-5">
            <div>
              <Label className="text-cyan-200 text-sm">Username</Label>
              <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="Choose a username" required className="bg-white/10 border-white/20 text-white mt-1" />
            </div>
            <div>
              <Label className="text-cyan-200 text-sm">Email</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required className="bg-white/10 border-white/20 text-white mt-1" />
            </div>
            <div>
              <Label className="text-cyan-200 text-sm">Password</Label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Choose a password (min 8 characters)" autoComplete="new-password" required className="bg-white/10 border-white/20 text-white mt-1" />
            </div>
            {error && <div className="bg-red-500/20 border border-red-500/40 rounded-lg px-4 py-2 text-red-300 text-sm">{error}</div>}
            {message && <div className="bg-green-500/20 border border-green-500/40 rounded-lg px-4 py-2 text-green-300 text-sm">{message}</div>}
            <Button type="submit" disabled={loading} className="w-full h-12 bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-semibold text-lg">
              {loading ? 'Creating...' : 'Create Account'}
            </Button>
          </form>
          <p className="text-center mt-4 text-white/40 text-xs">
            Already have an account? <a href="/login" className="text-cyan-300 underline">Sign in</a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}