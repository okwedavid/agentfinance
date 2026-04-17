"use client";
import React from 'react';

export default function TaskStatusBadge({ status }:{ status:string }){
  const color = status === 'pending'? 'bg-yellow-600' : status === 'running'? 'bg-blue-600' : status === 'completed'? 'bg-green-600' : 'bg-red-600';
  return (<span className={`px-2 py-1 rounded text-xs ${color}`}>{status}</span>);
}
