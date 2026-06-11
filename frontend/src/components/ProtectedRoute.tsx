import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import type { UserRole } from '../types';

interface ProtectedRouteProps {
  allowedRoles: UserRole[];
}

export function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { isAuthenticated, user, isAuthLoading } = useAppStore();
  const location = useLocation();

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!allowedRoles.includes(user.role)) {
    const defaultRoute =
      user.role === 'employee'
        ? '/employee/home'
        : user.role === 'manager'
        ? '/manager/team'
        : '/admin/knowledge';
    return <Navigate to={defaultRoute} replace />;
  }

  return <Outlet />;
}
