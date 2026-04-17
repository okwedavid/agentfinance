'use client';
import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

export default function AuthPage(){
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login'|'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string|null>(null);

  const submit = async (e:any)=>{
    e.preventDefault();
    setErr(null);
    try{
      if(mode==='login') await login(username, password);
      else await register(username, password);
    }catch(e:any){ setErr(e.message || 'failed'); }
  };

  return (
    <div className="max-w-md mx-auto mt-20 p-6 bg-gray-800 rounded-lg shadow">
      <h2 className="text-2xl mb-4">{mode==='login'?'Log in':'Register'}</h2>
      <form onSubmit={submit} className="space-y-4">
        <input className="w-full p-2 rounded bg-gray-900" placeholder="username" value={username} onChange={e=>setUsername(e.target.value)} />
        <input type="password" className="w-full p-2 rounded bg-gray-900" placeholder="password" value={password} onChange={e=>setPassword(e.target.value)} />
        {err && <div className="text-red-400">{err}</div>}
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-indigo-600 rounded">{mode==='login'?'Log in':'Register'}</button>
          <button type="button" className="px-4 py-2 border rounded" onClick={()=>setMode(mode==='login'?'register':'login')}>Switch</button>
        </div>
      </form>
    </div>
  );
}
