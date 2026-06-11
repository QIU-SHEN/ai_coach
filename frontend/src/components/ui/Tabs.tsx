import { clsx } from 'clsx';

interface TabItem {
  key: string;
  label: string;
}

interface TabsProps {
  tabs: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeKey, onChange, className }: TabsProps) {
  return (
    <div className={clsx('flex gap-1 overflow-x-auto', className)}>
      {tabs.map((t) => {
        const isActive = t.key === activeKey;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={clsx(
              'px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors',
              isActive
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
