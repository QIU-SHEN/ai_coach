import { Outlet, useLocation } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { EmployeeSidebar, employeeMenu } from '../components/EmployeeSidebar';
import { MobileBottomNav } from '../components/MobileBottomNav';

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
          <Outlet />
        </main>
      </div>
      <div className="no-print">
        <MobileBottomNav items={employeeMenu} />
      </div>
    </div>
  );
}
