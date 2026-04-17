"use client";
import React from 'react';
import { TaskProvider, useTasks } from '../../context/TaskContext';
import TaskCard from '../../components/TaskCard';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

function TasksListInner(){
  const { tasks, loading, refresh } = useTasks();
  return (
    <div>
      <div className="grid grid-cols-3 gap-4">
        {tasks.map(t=> (
          <TaskCard key={t.id} task={t} onOpen={(id)=>{ window.location.href = `/tasks/${id}`; }} />
        ))}
      </div>
    </div>
  );
}

export default function TasksPage(){
  return (
    <TaskProvider>
      <div className="p-6">
        <h2 className="text-xl mb-4">Tasks</h2>
        <TasksListInner />
      </div>
    </TaskProvider>
  );
}
