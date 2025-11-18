"use client";
import React from 'react';
import TaskStatusBadge from './TaskStatusBadge';

export default function TaskCard({ task, onOpen }:{ task:any; onOpen:(id:string)=>void }){
  return (
    <div className="bg-gray-800 p-4 rounded shadow">
      <div className="flex justify-between items-start">
        <div>
          <div className="text-sm text-gray-300">{task.action}</div>
          <div className="text-xs text-gray-500">{new Date(task.createdAt).toLocaleString()}</div>
        </div>
        <div className="flex items-center gap-2">
          <TaskStatusBadge status={task.status} />
          <button onClick={()=>onOpen(task.id)} className="px-2 py-1 bg-indigo-600 rounded text-sm">Open</button>
        </div>
      </div>
    </div>
  );
}
