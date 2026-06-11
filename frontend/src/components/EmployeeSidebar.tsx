import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  BookOpen,
  UserCircle,
  ClipboardList,
} from 'lucide-react';

export const employeeMenu = [
  { to: '/employee/home', label: '首页', icon: LayoutDashboard },
  { to: '/employee/debrief', label: '复盘', icon: ClipboardList },
  { to: '/employee/learning', label: '学习', icon: BookOpen },
  { to: '/employee/profile', label: '我的', icon: UserCircle },
];

export function EmployeeSidebar() {
  return (
    <aside className="hidden md:block w-56 bg-white border-r min-h-[calc(100vh-64px)] sticky top-0">
      <nav className="p-4 space-y-1">
        {employeeMenu.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`
            }
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
