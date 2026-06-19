import { Suspense } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-sm text-gray-400">加载中...</div>
    </div>
  );
}
import { Navbar } from '../components/Navbar';

export function AdminLayout() {
  const location = useLocation();
  const tabs = [
    { key: 'users', label: '用户权限管理' },
    { key: 'team', label: '团队数据' },
    { key: 'knowledge', label: '知识库管理' },
    { key: 'assets', label: '产品素材' },
    { key: 'config', label: '系统配置' },
  ];

  const hideTabs = location.pathname.includes('/assets/product/');

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className={hideTabs ? 'min-h-[calc(100vh-64px)]' : 'max-w-7xl mx-auto px-2 md:px-4 py-4 md:py-6'}>
        {!hideTabs && (
          <div className="flex gap-1 mb-4 md:mb-6 overflow-x-auto no-print scrollbar-hide">
            {tabs.map((t) => (
              <NavLink
                key={t.key}
                to={`/admin/${t.key}`}
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
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
