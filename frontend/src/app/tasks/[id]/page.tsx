"use client";
import React from 'react';
import TaskDetailPanel from '../../../components/TaskDetailPanel';

export default async function TaskDetailPage({ params }:{ params:{ id:string } }){
  const { id } = await params;
  return (
    <div className="p-6">
      <h2 className="text-xl mb-4">Task Detail</h2>
      <TaskDetailPanel taskId={params.id} />
    </div>
  );
}
