import { useContext } from 'react';
import { ConfirmContext } from '../components/ui/ConfirmContext';
import type { ConfirmOptions } from '../components/ui/ConfirmContext';

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return { confirm: (options: ConfirmOptions) => ctx.confirm(options) };
}
