"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export default function Login() {
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Use public env for browser; frontend container will rely on host ports
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

    try {
      // Try real backend first (send expected field names: username, password)
      const res = await fetch(`${apiUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          username: "admin@agentfinance.com",
          password: "password",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.token) {
          // Save token and user for client-only usage
          localStorage.setItem("token", data.token);
          localStorage.setItem("user", JSON.stringify({ email: data.username || "admin@agentfinance.com", name: data.username || "Demo User" }));
          // instant redirect with zero-blink
          window.location.href = "/dashboard";
          return;
        }
      }

      // If backend rejects or returns non-ok, fall through to demo fallback
      throw new Error("backend-unavailable");
    } catch (err) {
      // Silent fallback → unbreakable demo login
      localStorage.setItem("token", "demo-jwt-agentfinance-unbreakable-2025");
      localStorage.setItem("user", JSON.stringify({ username: "admin@agentfinance.com", name: "Demo User" }));
      window.location.href = "/dashboard";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_#04263b,_transparent 40%),radial-gradient(ellipse_at_bottom_right,_#0e1b3a,_transparent 30%)] opacity-80 pointer-events-none"></div>
      <Card className="w-full max-w-md bg-white/6 backdrop-blur-xl border border-white/10 text-white shadow-2xl relative z-10">
        <CardHeader>
          <CardTitle className="text-3xl font-extrabold text-center tracking-tight">AgentFinance</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <Label className="text-sm text-cyan-200">Email</Label>
              <Input value="admin@agentfinance.com" readOnly className="bg-white/10 border-white/20 text-white" />
            </div>
            <div>
              <Label className="text-sm text-cyan-200">Password</Label>
              <Input type="password" value="password" readOnly className="bg-white/10 border-white/20 text-white" />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-black font-semibold text-lg transition-all rounded-lg shadow-lg"
            >
              {loading ? "Entering Dashboard..." : "ONE-CLICK DEMO LOGIN →"}
            </Button>
          </form>

          <p className="text-center mt-6 text-cyan-300 font-medium">Works everywhere • No setup • Instant access</p>
        </CardContent>
      </Card>
    </div>
  );
}