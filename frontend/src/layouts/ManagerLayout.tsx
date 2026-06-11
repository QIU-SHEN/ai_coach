import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { Navbar } from '../components/Navbar';

export function ManagerLayout() {
  const location = useLocation();
  const tabs = [
    { key: 'team', label: '团队诊断列表' },
    { key: 'knowledge', label: '知识库管理' },
    { key: 'assets', label: '产品素材' },
  ];

  const hideTabs = location.pathname.includes('/assets/product/');

  return (
    <div className="min-h-screen bg-white">
      <div className="no-print">
        <Navbar />
      </div>
      <main className={hideTabs ? 'min-h-[calc(100vh-64px)]' : 'max-w-7xl mx-auto px-2 md:px-4 py-4 md:py-6'}>
        {!hideTabs && (
          <div className="flex gap-1 mb-4 md:mb-6 overflow-x-auto no-print scrollbar-hide">
            {tabs.map((t) => (
              <NavLink
                key={t.key}
                to={`/manager/${t.key}`}
                end={t.key === 'team'}
                className={({ isActive }) =>
                  `px-3 md:px-4 py-2 text-sm font-medium whitespace-nowrap rounded-lg transition-colors flex-shrink-0 ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                  }`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
