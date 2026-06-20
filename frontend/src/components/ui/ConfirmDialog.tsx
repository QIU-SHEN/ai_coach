import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { AlertTriangle, HelpCircle, X } from 'lucide-react';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'default';
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    open: boolean;
    options: ConfirmOptions | null;
  }>({ open: false, options: null });
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const requestConfirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    // If a dialog is already open, resolve it as false before opening a new one
    if (resolveRef.current) {
      resolveRef.current(false);
    }
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ open: true, options });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true);
    resolveRef.current = null;
    setState({ open: false, options: null });
  }, []);

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false);
    resolveRef.current = null;
    setState({ open: false, options: null });
  }, []);

  return (
    <ConfirmContext.Provider value={{ confirm: requestConfirm }}>
      {children}
      {state.open && state.options && (
        <ConfirmDialogOverlay
          options={state.options}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return { confirm: ctx.confirm };
}

const variantConfig = {
  danger: {
    icon: AlertTriangle,
    iconClass: 'text-red-600',
    btnClass: 'bg-red-600 hover:bg-red-700 text-white',
  },
  warning: {
    icon: AlertTriangle,
    iconClass: 'text-amber-600',
    btnClass: 'bg-amber-600 hover:bg-amber-700 text-white',
  },
  default: {
    icon: HelpCircle,
    iconClass: 'text-blue-600',
    btnClass: 'bg-blue-600 hover:bg-blue-700 text-white',
  },
};

function ConfirmDialogOverlay({
  options,
  onConfirm,
  onCancel,
}: {
  options: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const variant = options.variant || 'default';
  const config = variantConfig[variant];
  const Icon = config.icon;
  const title = options.title || '确认操作';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center" onClick={onCancel}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6 fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <Icon className={clsx('w-6 h-6 shrink-0 mt-0.5', config.iconClass)} />
          <div className="flex-1">
            <h3 className="text-lg font-bold text-gray-900 mb-1">{title}</h3>
            <p className="text-sm text-gray-600">{options.message}</p>
          </div>
          <button
            onClick={onCancel}
            className="p-1 text-gray-400 hover:text-gray-600 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {options.cancelText || '取消'}
          </button>
          <button
            onClick={onConfirm}
            className={clsx('px-4 py-2 rounded-lg text-sm font-medium', config.btnClass)}
          >
            {options.confirmText || '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}
