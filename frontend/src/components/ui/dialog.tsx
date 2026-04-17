"use client";
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;

const DialogContent = React.forwardRef<HTMLDivElement, any>(({ className = '', children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 bg-black/50" />
    <DialogPrimitive.Content
      ref={ref}
      className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg p-6 shadow-lg ${className}`}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));

const DialogHeader = ({ className = '', ...props }: any) => <div className={className} {...props} />;
const DialogTitle = React.forwardRef<HTMLHeadingElement, any>(({ className = '', ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={`text-xl font-semibold ${className}`} {...props} />
));

export { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle };
