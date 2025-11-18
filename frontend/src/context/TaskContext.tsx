"use client";
import React, { createContext, useContext, useEffect, useState } from 'react';
import useWebSocket from '../hooks/useWebSocket';
import { apiFetch } from '../lib/api';

type Task = { id:string; action:string; status:string; createdAt:string; updatedAt:string; input?:any; result?:any; archived?:boolean };

type TaskContextShape = {
  tasks: Task[];
  loading: boolean;
  selectedTask: Task | null;
  selectTask: (id:string|Task|null)=>void;
  refresh: ()=>Promise<void>;
  create: (payload:{ action:string; input?:any; agentId?:string })=>Promise<Task>;
  patch: (id:string, patch:any)=>Promise<Task>;
  remove: (id:string)=>Promise<void>;
}

const TaskContext = createContext<TaskContextShape | undefined>(undefined);

export const useTasks = ()=>{ const ctx = useContext(TaskContext); if(!ctx) throw new Error('useTasks must be used within TaskProvider'); return ctx; };

export function TaskProvider({ children }:{ children: React.ReactNode }){
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task|null>(null);

  const ws = useWebSocket((process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:5000'));

  async function refresh(){
    setLoading(true);
    try{
      const j = await apiFetch('/tasks');
      setTasks(j);
    }catch(e){ console.error('refresh tasks', e); }
    setLoading(false);
  }

  async function create(payload:{ action:string; input?:any; agentId?:string }){
    const t = await apiFetch('/tasks/dispatch', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
    setTasks(prev=>[t, ...prev]);
    return t;
  }

  async function patch(id:string, patch:any){
    const t = await apiFetch(`/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(patch), credentials:'include' });
    setTasks(prev=> prev.map(p=> p.id===t.id? t: p));
    if(selectedTask?.id === t.id) setSelectedTask(t);
    return t;
  }

  async function remove(id:string){
    await apiFetch(`/tasks/${id}`, { method: 'DELETE', credentials:'include' });
    setTasks(prev=> prev.map(p=> p.id===id? ({...p, archived:true}): p));
  }

  function selectTask(id:string|Task|null){
    if(id === null) return setSelectedTask(null);
    if(typeof id === 'string'){
      const found = tasks.find(t=>t.id===id) || null;
      setSelectedTask(found);
    } else setSelectedTask(id);
  }

  // WS incoming messages -> update tasks
  useEffect(()=>{
    const msgs = ws.parsedMessages || [];
    if(msgs.length===0) return;
    const last = msgs[msgs.length-1];
    if(!last || typeof last.type !== 'string') return;
    if(last.type.startsWith('task')){
      const t = last.data;
      // Normalize
      const normalized = { ...t, input: t.input ?? t.payload, result: t.result ?? t.output };
      setTasks(prev=>{
        const exists = prev.find(p=>p.id===normalized.id);
        if(exists) return prev.map(p=> p.id===normalized.id? normalized: p);
        return [normalized, ...prev];
      });
      if(selectedTask && selectedTask.id === normalized.id) setSelectedTask(normalized);
    }
  }, [ws.parsedMessages]);

  useEffect(()=>{ refresh(); }, []);

  const value: TaskContextShape = { tasks, loading, selectedTask, selectTask, refresh, create, patch, remove };
  return (<TaskContext.Provider value={value}>{children}</TaskContext.Provider>);
}

export default TaskContext;
