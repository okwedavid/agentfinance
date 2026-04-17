"use client";
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';

export function NewTaskModal() {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      // Use cookie-based auth (credentials: 'include') so we don't rely on localStorage tokens
      const res = await fetch(`/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: prompt }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('failed');
      setOpen(false);
      setPrompt('');
      window.location.reload();
    } catch (err) {
      alert('Task creation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-blue-600 hover:bg-blue-700">New Task</Button>
      </DialogTrigger>
      <DialogContent className="bg-slate-900 text-white border-white/20">
        <DialogHeader>
          <DialogTitle>Create New Task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="prompt">Task Prompt</Label>
            <Input
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., Analyze Q3 financials"
              className="bg-white/10 border-white/30 text-white"
            />
          </div>
          <Button onClick={handleSubmit} disabled={loading} className="w-full">
            {loading ? 'Creating...' : 'Create Task'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
