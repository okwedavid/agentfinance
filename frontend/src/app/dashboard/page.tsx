"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { getTasks, createTask, isLoggedIn, API_BASE } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import { TopNav, BottomNav, PageFooter } from "@/components/layout/Nav";
import Link from "next/link";

// ── Types ───────────────────────────────────────────────────────────────────
interface Ticker { symbol:string; price:string; change:number; }
interface Task   { id:string; action:string; status:string; result?:string; createdAt?:string; }

// ── Market ticker hook ──────────────────────────────────────────────────────
function useTicker() {
  const [tickers, setTickers] = useState<Ticker[]>([
    {symbol:'BTC',price:'—',change:0},{symbol:'ETH',price:'—',change:0},
    {symbol:'SOL',price:'—',change:0},{symbol:'BNB',price:'—',change:0},
    {symbol:'ARB',price:'—',change:0},
  ]);
  useEffect(() => {
    const coins='bitcoin,ethereum,solana,binancecoin,arbitrum';
    const map:Record<string,string>={bitcoin:'BTC',ethereum:'ETH',solana:'SOL',binancecoin:'BNB',arbitrum:'ARB'};
    async function fetch_() {
      try {
        const r=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coins}&vs_currencies=usd&include_24hr_change=true`);
        const d=await r.json();
        setTickers(Object.entries(d).map(([k,v]:any)=>({
          symbol:map[k],
          price:v.usd>=1000?v.usd.toLocaleString():v.usd.toFixed(2),
          change:parseFloat(v.usd_24h_change?.toFixed(2)||'0'),
        })));
      } catch {}
    }
    fetch_();
    const id=setInterval(fetch_,60000);
    return ()=>clearInterval(id);
  },[]);
  return tickers;
}

// ── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({status}:{status:string}) {
  const map:Record<string,string>={
    completed:'badge-completed',running:'badge-running',
    pending:'badge-pending',failed:'badge-failed',
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 w-fit ${map[status]||'badge-pending'}`}>
      {status==='running'&&<span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping inline-block"/>}
      {status}
    </span>
  );
}

// ── Task card ─────────────────────────────────────────────────────────────────
function TaskCard({task,onDelete}:{task:Task;onDelete:(id:string)=>void}) {
  const [expanded,setExpanded]=useState(false);
  const [deleting,setDeleting]=useState(false);
  let result='';
  try {
    const p=typeof task.result==='string'?JSON.parse(task.result):task.result;
    result=p?.summary||p?.output||p?.result||JSON.stringify(p,null,2);
  } catch { result=task.result||''; }

  async function del() {
    setDeleting(true);
    try {
      await fetch(`${API_BASE}/tasks/${task.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${localStorage.getItem('token')}`}});
      onDelete(task.id);
    } catch { setDeleting(false); }
  }

  const icons:Record<string,string>={completed:'✓',failed:'✗',running:'⟳',pending:'◷'};
  const colors:Record<string,string>={
    completed:'bg-emerald-500/15 text-emerald-300',
    running:'bg-blue-500/15 text-blue-300',
    failed:'bg-red-500/15 text-red-300',
    pending:'bg-amber-500/15 text-amber-300',
  };

  return (
    <div className="glass rounded-xl overflow-hidden animate-fade-in hover:border-white/10 transition-all">
      <div className="flex items-start gap-3 p-4">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-sm font-bold ${colors[task.status]||colors.pending}`}>
          {task.status==='running'
            ?<div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"/>
            :icons[task.status]||'◷'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white/90 text-sm font-medium leading-snug line-clamp-2">{task.action}</p>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <StatusBadge status={task.status}/>
            <span className="text-gray-600 text-xs">
              {task.createdAt?new Date(task.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}
            </span>
            {task.status==='completed'&&result&&(
              <button onClick={()=>setExpanded(!expanded)}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                {expanded?'Hide ▲':'Output ▼'}
              </button>
            )}
          </div>
        </div>
        <button onClick={del} disabled={deleting}
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-all text-xs disabled:opacity-30">
          {deleting?<div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin"/>:'✕'}
        </button>
      </div>
      {expanded&&result&&(
        <div className="px-4 pb-4 border-t border-white/[0.06] pt-3 animate-slide-down">
          <pre className="text-gray-300 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto bg-black/30 rounded-lg p-3">
            {result.slice(0,1500)}{result.length>1500?'\n…':''}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Quick task templates ──────────────────────────────────────────────────────
const TEMPLATES=[
  {label:'Find best DeFi yield',icon:'📈'},{label:'Research trending coins',icon:'🔬'},
  {label:'Check ETH arbitrage',icon:'💹'},{label:'Write crypto newsletter',icon:'✍️'},
  {label:'Analyse market sentiment',icon:'🧠'},{label:'Find passive income',icon:'💰'},
  {label:'Highest APY stablecoin',icon:'🏦'},{label:'DeFi Twitter thread',icon:'📱'},
];

// ── New task modal ─────────────────────────────────────────────────────────────
function NewTaskModal({onClose,onCreated}:{onClose:()=>void;onCreated:(t:any)=>void}) {
  const [prompt,setPrompt]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const ref=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{ref.current?.focus();},[]);

  async function submit(action:string) {
    if(!action.trim())return;
    setLoading(true);setError('');
    try { const t=await createTask(action); onCreated(t); onClose(); }
    catch(e:any) {
      const msg=e.message||'Failed';
      setError(msg);
      if(msg.toLowerCase().includes('rate')||msg.toLowerCase().includes('limit')) {
        setError(msg+'\n\n💡 Fix: Check Railway backend has GROQ_API_KEY & GOOGLE_AI_API_KEY set. Current NEXT_PUBLIC_API_URL may still point to localhost — change it in Railway frontend vars.');
      }
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-3">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative w-full max-w-lg glass-heavy rounded-2xl overflow-hidden animate-scale-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <div>
            <h2 className="text-base font-bold text-white">Deploy Agent Task</h2>
            <p className="text-gray-500 text-xs mt-0.5">Describe what you want the agent to do</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-white/[0.07] flex items-center justify-center text-gray-400 hover:text-white transition-all">✕</button>
        </div>
        <div className="px-5 pt-4">
          <p className="text-gray-500 text-xs mb-2 font-medium uppercase tracking-wide">Quick templates</p>
          <div className="grid grid-cols-2 gap-1.5 mb-4">
            {TEMPLATES.map(t=>(
              <button key={t.label} onClick={()=>submit(t.label)} disabled={loading}
                className="flex items-center gap-2 p-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-blue-500/10 hover:border-blue-500/25 text-left transition-all disabled:opacity-40">
                <span className="text-sm">{t.icon}</span>
                <span className="text-xs text-gray-300">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="px-5 pb-5">
          <p className="text-gray-500 text-xs mb-2 font-medium uppercase tracking-wide">Custom task</p>
          <textarea ref={ref} value={prompt} onChange={e=>setPrompt(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&prompt.trim()){e.preventDefault();submit(prompt);}}}
            placeholder="Describe what the agent should research, trade, or create…"
            rows={3} className="input-field resize-none mb-3"/>
          {error&&(
            <div className="mb-3 px-3 py-2.5 bg-red-500/10 border border-red-500/25 rounded-xl text-red-400 text-xs whitespace-pre-wrap leading-relaxed">
              ❌ {error}
            </div>
          )}
          <button onClick={()=>submit(prompt)} disabled={!prompt.trim()||loading}
            className="btn-primary w-full justify-center">
            {loading?<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>Deploying…</>:'🚀 Deploy Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const {user}=useAuth();
  const [tasks,setTasks]=useState<Task[]>([]);
  const [loading,setLoading]=useState(true);
  const [showModal,setShowModal]=useState(false);
  const [liveEvents,setLiveEvents]=useState<any[]>([]);
  const [filter,setFilter]=useState<'all'|'running'|'completed'|'failed'>('all');
  const [clearing,setClearing]=useState(false);
  const tickers=useTicker();

  const onEvent=useCallback((evt:any)=>{
    setLiveEvents(p=>[{...evt,ts:Date.now()},...p].slice(0,20));
    if(evt.type?.startsWith('task:')) getTasks().then(setTasks).catch(()=>{});
  },[]);
  const {connectionStatus:wsStatus}=useWebSocket({onEvent});

  useEffect(()=>{
    if(!isLoggedIn()){window.location.href='/login';return;}
    getTasks().then(setTasks).catch(()=>{}).finally(()=>setLoading(false));
  },[]);

  useEffect(()=>{
    const id=setInterval(()=>getTasks().then(setTasks).catch(()=>{}),8000);
    return ()=>clearInterval(id);
  },[]);

  const stats={
    total:tasks.length,
    running:tasks.filter(t=>t.status==='running').length,
    completed:tasks.filter(t=>t.status==='completed').length,
    failed:tasks.filter(t=>t.status==='failed').length,
    earnings:(tasks.filter(t=>t.status==='completed').length*0.0035).toFixed(4),
  };

  const filtered=filter==='all'?tasks:tasks.filter(t=>t.status===filter);

  function addTask(t:any){setTasks(p=>[t,...p]);}
  function removeTask(id:string){setTasks(p=>p.filter(t=>t.id!==id));}

  async function clearHistory(){
    if(!confirm('Delete ALL task history? Cannot be undone.'))return;
    setClearing(true);
    try {
      const res=await fetch(`${API_BASE}/tasks/all`,{method:'DELETE',headers:{Authorization:`Bearer ${localStorage.getItem('token')}`}});
      if(res.ok){setTasks([]);return;}
      // Fallback: delete individually
      await Promise.all(tasks.map(t=>
        fetch(`${API_BASE}/tasks/${t.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${localStorage.getItem('token')}`}}).catch(()=>{})
      ));
      setTasks([]);
    } catch {} finally{setClearing(false);}
  }

  const walletAddr=typeof window!=='undefined'?localStorage.getItem('agentfi_wallet'):null;

  return (
    <div className="min-h-screen bg-[#050c18] flex flex-col">
      <TopNav wsStatus={wsStatus}/>

      {/* Market ticker */}
      <div className="border-b border-white/[0.05] bg-black/20 overflow-x-auto">
        <div className="flex items-center min-w-max px-4 py-2 gap-0">
          {tickers.map(t=>(
            <div key={t.symbol} className="flex items-center gap-2 px-4 py-1 border-r border-white/[0.05] last:border-0 flex-shrink-0">
              <span className="text-gray-400 text-xs font-semibold">{t.symbol}</span>
              <span className="text-white text-xs font-mono font-bold">${t.price}</span>
              <span className={`text-xs font-medium ${t.change>=0?'text-emerald-400':'text-red-400'}`}>
                {t.change>=0?'▲':'▼'}{Math.abs(t.change)}%
              </span>
            </div>
          ))}
          <div className="flex-1"/>
          <div className="flex items-center gap-1.5 px-4 flex-shrink-0">
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"/>
            <span className="text-gray-600 text-xs">Live</span>
          </div>
        </div>
      </div>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6 pb-24 md:pb-6 space-y-5">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in">
          <div>
            <h1 className="text-xl font-bold text-white">
              Hey, <span className="gradient-text">{user?.displayName||user?.username||'Agent'}</span> 👋
            </h1>
            <p className="text-gray-400 text-sm">Your agents are monitoring markets 24/7</p>
          </div>
          <button onClick={()=>setShowModal(true)} className="btn-primary flex-shrink-0 animate-glow">
            🚀 Deploy Agent
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger-children">
          {[
            {icon:'🤖',label:'Total Tasks',value:stats.total,color:'bg-blue-500/10',delay:0},
            {icon:'⚡',label:'Running',value:stats.running,color:'bg-violet-500/10',delay:60},
            {icon:'✅',label:'Completed',value:stats.completed,color:'bg-emerald-500/10',delay:120},
            {icon:'💰',label:'Est. Earnings',value:`${stats.earnings} ETH`,color:'bg-amber-500/10',delay:180},
          ].map(s=>(
            <div key={s.label} className="glass rounded-2xl p-4 animate-fade-in card-glow" style={{animationDelay:`${s.delay}ms`}}>
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg mb-3 ${s.color}`}>{s.icon}</div>
              <p className="text-xl font-bold text-white">{s.value}</p>
              <p className="text-gray-400 text-xs mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Agent fleet */}
        <div className="glass rounded-2xl p-5 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Agent Fleet</h2>
            <Link href="/agents" className="text-xs text-blue-400 hover:text-blue-300">Manage →</Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {name:'Research',icon:'🔬',active:stats.running>0},
              {name:'Trading', icon:'📈',active:false},
              {name:'Content', icon:'✍️',active:stats.running>1},
              {name:'Execution',icon:'⚡',active:false},
            ].map(a=>(
              <div key={a.name} className="bg-white/[0.025] border border-white/[0.05] rounded-xl p-3 hover:border-white/10 transition-all">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-lg">{a.icon}</span>
                  <div className={`w-2 h-2 rounded-full ${a.active?'bg-emerald-400 animate-pulse':'bg-gray-700'}`}/>
                </div>
                <p className="text-white text-xs font-semibold">{a.name}</p>
                <p className={`text-xs capitalize mt-0.5 ${a.active?'text-emerald-400':'text-gray-600'}`}>
                  {a.active?'active':'idle'}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Main grid */}
        <div className="grid lg:grid-cols-3 gap-5">

          {/* Tasks */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-white">Task History</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-0.5 bg-white/[0.03] border border-white/[0.06] rounded-xl p-1">
                  {(['all','running','completed','failed'] as const).map(f=>(
                    <button key={f} onClick={()=>setFilter(f)}
                      className={`text-xs px-2.5 py-1 rounded-lg transition-all capitalize ${filter===f?'bg-blue-600 text-white':'text-gray-400 hover:text-white'}`}>
                      {f}
                    </button>
                  ))}
                </div>
                {tasks.length>0&&(
                  <button onClick={clearHistory} disabled={clearing}
                    className="text-xs text-red-400 hover:text-red-300 border border-red-500/20 hover:bg-red-500/10 px-3 py-1.5 rounded-xl transition-all disabled:opacity-40">
                    {clearing?'⏳ Clearing…':'🗑 Clear all'}
                  </button>
                )}
              </div>
            </div>

            {loading?(
              <div className="space-y-2">
                {[1,2,3].map(i=><div key={i} className="h-16 skeleton rounded-xl"/>)}
              </div>
            ):filtered.length===0?(
              <div className="glass rounded-2xl p-10 text-center animate-fade-in">
                <div className="text-4xl mb-3 animate-float">🤖</div>
                <h3 className="text-white font-semibold mb-1">No tasks yet</h3>
                <p className="text-gray-400 text-sm mb-4">Deploy an agent to start generating income</p>
                <button onClick={()=>setShowModal(true)} className="btn-primary">🚀 Deploy first agent</button>
              </div>
            ):(
              <div className="space-y-2">
                {filtered.map(task=><TaskCard key={task.id} task={task} onDelete={removeTask}/>)}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Live events */}
            {liveEvents.length>0&&(
              <div className="glass rounded-2xl overflow-hidden animate-fade-in">
                <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
                  <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"/>
                  <h3 className="text-xs font-semibold text-white">Live Events</h3>
                </div>
                <div className="max-h-40 overflow-y-auto divide-y divide-white/[0.04]">
                  {liveEvents.slice(0,8).map((e,i)=>(
                    <div key={i} className="flex items-start gap-2 px-4 py-2.5 animate-slide-in">
                      <span className="text-sm mt-0.5">{e.type?.includes('completed')?'✅':e.type?.includes('running')?'⚡':'📡'}</span>
                      <div className="min-w-0">
                        <p className="text-white/80 text-xs truncate">{e.taskAction||e.message||e.type}</p>
                        <p className="text-gray-600 text-xs">{new Date(e.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick launch */}
            <div className="glass rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.06]">
                <h3 className="text-xs font-semibold text-white">Quick Launch</h3>
              </div>
              <div className="p-2 space-y-1">
                {TEMPLATES.slice(0,5).map(t=>(
                  <button key={t.label} onClick={async()=>{
                    try{const task=await createTask(t.label);addTask(task);}
                    catch(e:any){alert(e.message);}
                  }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-xs text-gray-300 hover:text-white hover:bg-white/[0.05] transition-all border border-transparent hover:border-white/[0.07]">
                    <span>{t.icon}</span><span className="flex-1">{t.label}</span><span className="text-gray-600">▶</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Wallet */}
            <div className="glass rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-white">Wallet</h3>
                <Link href="/wallet" className="text-xs text-blue-400">Manage →</Link>
              </div>
              {walletAddr?(
                <div>
                  <p className="text-gray-400 text-xs font-mono truncate mb-2">{walletAddr}</p>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"/>
                    <span className="text-emerald-400 text-xs">Connected · earnings route here</span>
                  </div>
                </div>
              ):(
                <Link href="/wallet" className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-2">
                  ⚠️ Connect wallet to receive earnings
                </Link>
              )}
            </div>

            {/* Earnings card */}
            <div className="glass rounded-2xl p-4 border border-emerald-600/15">
              <h3 className="text-xs font-semibold text-white mb-3">💰 Estimated Earnings</h3>
              <p className="text-emerald-400 font-mono text-xl font-bold">{stats.earnings}</p>
              <p className="text-gray-500 text-xs mb-3">ETH · from {stats.completed} completed tasks</p>
              <Link href="/wallet" className="btn-primary w-full justify-center text-xs py-2">View Wallet →</Link>
            </div>
          </div>
        </div>
      </main>

      <PageFooter/>
      <BottomNav/>
      {showModal&&<NewTaskModal onClose={()=>setShowModal(false)} onCreated={addTask}/>}
    </div>
  );
}