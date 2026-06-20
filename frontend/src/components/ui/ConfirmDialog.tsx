import { useState } from 'react';
import type { ReactNode } from 'react';
import type { JSX } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { ConfirmContext } from './ConfirmContext';
import type { ConfirmOptions } from './ConfirmContext';

export type { ConfirmOptions } from './ConfirmContext';

interface ConfirmState {
  open: boolean;
  options: ConfirmOptions | null;
  resolve: ((value: boolean) => void) | null;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState>({
    open: false,
    options: null,
    resolve: null,
  });

  const confirm = (options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ open: true, options, resolve });
    });
  };

  const handleResolve = (value: boolean) => {
    setState((prev) => {
      prev.resolve?.(value);
      return { open: false, options: null, resolve: null };
    });
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state.open && state.options && (
        <ConfirmDialogOverlay options={state.options} onResolve={handleResolve} />
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialogOverlay({
  options,
  onResolve,
}: {
  options: ConfirmOptions;
  onResolve: (value: boolean) => void;
}) {
  const variant = options.variant ?? 'default';

  const iconMap: Record<NonNullable<ConfirmOptions['variant']>, JSX.Element> = {
    danger: <AlertTriangle className="h-6 w-6 text-red-600" />,
    warning: <AlertTriangle className="h-6 w-6 text-amber-600" />,
    default: <HelpCircle className="h-6 w-6 text-blue-600" />,
  };

  const confirmBtnClass: Record<NonNullable<ConfirmOptions['variant']>, string> = {
    danger: 'bg-red-600 text-white hover:bg-red-700',
    warning: 'bg-amber-600 text-white hover:bg-amber-700',
    default: 'bg-blue-600 text-white hover:bg-blue-700',
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center"
      onClick={() => onResolve(false)}
    >
      <div
        className={clsx(
          'bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6 fade-in',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* title area */}
        <div className="flex items-center gap-3 mb-4">
          {iconMap[variant]}
          <h3 className="text-lg font-semibold text-gray-900">
            {options.title ?? '确认操作'}
          </h3>
        </div>

        {/* message area */}
        <p className="text-sm text-gray-600 mb-6">{options.message}</p>

        {/* buttons */}
        <div className="flex justify-end gap-3">
          <button
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            onClick={() => onResolve(false)}
          >
            {options.cancelText ?? '取消'}
          </button>
          <button
            className={clsx(
              'px-4 py-2 text-sm rounded-lg transition-colors',
              confirmBtnClass[variant],
            )}
            onClick={() => onResolve(true)}
          >
            {options.confirmText ?? '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}
