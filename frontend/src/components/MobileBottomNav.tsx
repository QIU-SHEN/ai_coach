import { NavLink } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export function MobileBottomNav({ items }: { items: NavItem[] }) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t z-50 pb-safe">
      <div className="flex items-center justify-around h-14">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 w-full h-full text-[10px] font-medium transition-colors ${
                isActive
                  ? 'text-blue-600'
                  : 'text-gray-500'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className={`w-5 h-5 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
