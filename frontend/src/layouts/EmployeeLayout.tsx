import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { EmployeeSidebar, employeeMenu } from '../components/EmployeeSidebar';
import { MobileBottomNav } from '../components/MobileBottomNav';

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-sm text-gray-400">加载中...</div>
    </div>
  );
}

export function EmployeeLayout() {
  const location = useLocation();
  const hideSidebar = location.pathname.startsWith('/employee/learning/product/');

  return (
    <div className="min-h-screen bg-white pb-14 md:pb-0">
      <div className="no-print">
        <Navbar />
      </div>
      <div className="flex">
        {!hideSidebar && (
          <div className="no-print">
            <EmployeeSidebar />
          </div>
        )}
        <main className="flex-1 min-w-0">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <div className="no-print">
        <MobileBottomNav items={employeeMenu} />
      </div>
    </div>
  );
}
