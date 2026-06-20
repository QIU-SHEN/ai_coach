import { useContext } from 'react';
import { ToastContext } from '../components/ui/Toast';

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');

  return {
    toast: {
      success: (message: string) => ctx.addToast('success', message),
      error: (message: string) => ctx.addToast('error', message),
      info: (message: string) => ctx.addToast('info', message),
    },
  };
}
