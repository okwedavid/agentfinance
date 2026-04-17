"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'https://serene-magic-production-6d0c.up.railway.app').replace(/\/$/, '');

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed. Check your credentials.');
        setLoading(false);
        return;
      }
      if (data.token) {
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify({ id: data.id, username: data.username }));
        window.location.href = "/dashboard";
      } else {
        setError('No token received from server.');
        setLoading(false);
      }
    } catch (err) {
      setError('Cannot reach the server. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800 flex items-center justify-center p-6">
      <Card className="w-full max-w-md bg-white/10 backdrop-blur-xl border border-white/10 text-white shadow-2xl">
        <CardHeader>
          <CardTitle className="text-3xl font-extrabold text-center">AgentFinance</CardTitle>
          <p className="text-center text-cyan-300 text-sm mt-1">Agentic AI Platform</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <Label className="text-sm text-cyan-200">Username</Label>
              <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter your username" required className="bg-white/10 border-white/20 text-white mt-1" />
            </div>
            <div>
              <Label className="text-sm text-cyan-200">Password</Label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" required className="bg-white/10 border-white/20 text-white mt-1" />
            </div>
            {error && <div className="bg-red-500/20 border border-red-500/40 rounded-lg px-4 py-2 text-red-300 text-sm">{error}</div>}
            <Button type="submit" disabled={loading} className="w-full h-12 bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-semibold text-lg">
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
          <p className="text-center mt-4 text-white/40 text-xs">
            No account yet? <a href="/register" className="text-cyan-300 underline">Create one here</a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
