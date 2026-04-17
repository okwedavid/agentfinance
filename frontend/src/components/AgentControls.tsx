import React from "react";
export default function AgentControls({ agentId, status, onPause, onResume, onTerminate }: { agentId: string, status: string, onPause: () => void, onResume: () => void, onTerminate: () => void }) {
  return (
    <div className="flex gap-2 mt-2">
      <button className="bg-yellow-600 text-white px-2 py-1 rounded hover:bg-yellow-500 disabled:opacity-50" onClick={onPause} disabled={status === 'paused'}>Pause</button>
      <button className="bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-500 disabled:opacity-50" onClick={onResume} disabled={status === 'online'}>Resume</button>
      <button className="bg-red-600 text-white px-2 py-1 rounded hover:bg-red-500" onClick={onTerminate}>Terminate</button>
    </div>
  );
}
