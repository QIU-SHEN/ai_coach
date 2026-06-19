import { lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAppStore } from './store/useAppStore';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import { EmployeeLayout } from './layouts/EmployeeLayout';
import { ManagerLayout } from './layouts/ManagerLayout';
import { AdminLayout } from './layouts/AdminLayout';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
// Lazy-loaded page components
const UploadPage = lazy(() => import('./pages/sales/UploadPage').then(m => ({ default: m.UploadPage })));
const PracticeSessionPage = lazy(() => import('./pages/sales/PracticeSessionPage').then(m => ({ default: m.PracticeSessionPage })));
const DialogueTrainingPage = lazy(() => import('./pages/sales/DialogueTrainingPage').then(m => ({ default: m.DialogueTrainingPage })));
const MaterialPreviewPage = lazy(() => import('./pages/employee/MaterialPreviewPage').then(m => ({ default: m.MaterialPreviewPage })));
const DiagnosisLayout = lazy(() => import('./pages/diagnosis/DiagnosisLayout').then(m => ({ default: m.DiagnosisLayout })));
const AssessmentPage = lazy(() => import('./pages/diagnosis/AssessmentPage').then(m => ({ default: m.AssessmentPage })));
const SimulationPage = lazy(() => import('./pages/diagnosis/SimulationPage').then(m => ({ default: m.SimulationPage })));
const SimulationChatPage = lazy(() => import('./pages/diagnosis/SimulationChatPage').then(m => ({ default: m.SimulationChatPage })));
const DebriefCenterPage = lazy(() => import('./pages/diagnosis/DebriefCenterPage').then(m => ({ default: m.DebriefCenterPage })));
const TrainingPlanPage = lazy(() => import('./pages/sales/TrainingPlanPage').then(m => ({ default: m.TrainingPlanPage })));
const TeamListPage = lazy(() => import('./pages/manager/TeamListPage').then(m => ({ default: m.TeamListPage })));
const ReportDetailPage = lazy(() => import('./pages/manager/ReportDetailPage').then(m => ({ default: m.ReportDetailPage })));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const EmployeeHomePage = lazy(() => import('./pages/employee/EmployeeHomePage').then(m => ({ default: m.EmployeeHomePage })));
const LearningCenterPage = lazy(() => import('./pages/employee/LearningCenterPage').then(m => ({ default: m.LearningCenterPage })));
const LearningDetailPage = lazy(() => import('./pages/employee/LearningDetailPage').then(m => ({ default: m.LearningDetailPage })));
const ProfilePage = lazy(() => import('./pages/employee/ProfilePage').then(m => ({ default: m.ProfilePage })));
const DebriefListPage = lazy(() => import('./pages/employee/DebriefListPage').then(m => ({ default: m.DebriefListPage })));
const DebriefNewPage = lazy(() => import('./pages/employee/DebriefNewPage').then(m => ({ default: m.DebriefNewPage })));
const DebriefReportPage = lazy(() => import('./pages/employee/DebriefReportPage').then(m => ({ default: m.DebriefReportPage })));
const ProductOverviewPage = lazy(() => import('./pages/employee/ProductOverviewPage').then(m => ({ default: m.ProductOverviewPage })));
const ProductQuizPage = lazy(() => import('./pages/employee/ProductQuizPage').then(m => ({ default: m.ProductQuizPage })));
const ProductImagesPage = lazy(() => import('./pages/employee/ProductImagesPage').then(m => ({ default: m.ProductImagesPage })));
const ProductDocsPage = lazy(() => import('./pages/employee/ProductDocsPage').then(m => ({ default: m.ProductDocsPage })));
const ProductAssetsOverviewPage = lazy(() => import('./pages/manager/ProductAssetsOverviewPage').then(m => ({ default: m.ProductAssetsOverviewPage })));
const ProductImagesManagePage = lazy(() => import('./pages/manager/ProductImagesManagePage').then(m => ({ default: m.ProductImagesManagePage })));
const ProductDocsManagePage = lazy(() => import('./pages/manager/ProductDocsManagePage').then(m => ({ default: m.ProductDocsManagePage })));
const ProductQuizConfigPage = lazy(() => import('./pages/manager/ProductQuizConfigPage').then(m => ({ default: m.ProductQuizConfigPage })));
const MaterialQuizManagePage = lazy(() => import('./pages/manager/MaterialQuizManagePage').then(m => ({ default: m.MaterialQuizManagePage })));
const ProductMaterialsView = lazy(() => import('./components/ProductMaterialsView').then(m => ({ default: m.ProductMaterialsView })));

function RootRedirect() {
  const { isAuthenticated, user } = useAppStore();
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }
  if (user.role === 'employee') return <Navigate to="/employee/home" replace />;
  if (user.role === 'manager') return <Navigate to="/manager/team" replace />;
  return <Navigate to="/admin/users" replace />;
}

export default function App() {
  const { restoreSession } = useAppStore();

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route element={<ProtectedRoute allowedRoles={['employee']} />}>
            <Route path="/employee" element={<EmployeeLayout />}>
              <Route index element={<Navigate to="home" replace />} />
              <Route path="home" element={<EmployeeHomePage />} />
              <Route path="learning" element={<LearningCenterPage />} />
              <Route path="learning/material/:materialId" element={<MaterialPreviewPage />} />
              <Route path="learning/product/:productLineId" element={<ProductOverviewPage />} />
              <Route path="learning/product/:productLineId/quiz" element={<ProductQuizPage />} />
              <Route path="learning/material/:materialId/quiz" element={<ProductQuizPage />} />
              <Route path="learning/product/:productLineId/images" element={<ProductImagesPage />} />
              <Route path="learning/product/:productLineId/docs" element={<ProductDocsPage />} />
              <Route path="learning/quiz" element={<ProductQuizPage />} />
              <Route path="learning/:type/:id" element={<LearningDetailPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="debrief" element={<DebriefListPage />} />
              <Route path="debrief/new" element={<DebriefNewPage />} />
              <Route path="debrief/new/practice" element={<UploadPage />} />
              <Route path="debrief/:id" element={<DebriefReportPage />} />
              <Route path="debrief/:id/report" element={<ReportDetailPage />} />
              <Route path="debrief/:recordId/session" element={<PracticeSessionPage />} />
              <Route path="debrief/:recordId/dialogue-training" element={<DialogueTrainingPage />} />
              {/* 新销售能力诊断路由 */}
              <Route path="diagnosis" element={<DiagnosisLayout />}>
                <Route index element={<Navigate to="assessment" replace />} />
                <Route path="assessment" element={<AssessmentPage />} />
                <Route path="training-plan" element={<TrainingPlanPage />} />
                <Route path="simulation" element={<SimulationPage />} />
                <Route path="simulation/:recordId/chat" element={<SimulationChatPage />} />
                <Route path="debrief" element={<DebriefCenterPage />} />
              </Route>
            </Route>
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['manager', 'admin']} />}>
            <Route path="/manager" element={<ManagerLayout />}>
              <Route index element={<Navigate to="team" replace />} />
              <Route path="team" element={<TeamListPage />} />
              <Route path="team/:id" element={<ReportDetailPage />} />
              <Route path="team/:id/debrief" element={<DebriefReportPage />} />
              <Route path="knowledge" element={<AdminDashboard tab="knowledge" />} />
              <Route path="knowledge/material/:materialId/quiz" element={<MaterialQuizManagePage />} />
              <Route path="learning/material/:materialId" element={<MaterialPreviewPage />} />
              <Route path="assets" element={<ProductMaterialsView basePath="/manager/assets/product" allowCreateLine={true} />} />
              <Route path="assets/product/:productLineId" element={<ProductAssetsOverviewPage />} />
              <Route path="assets/product/:productLineId/quiz" element={<ProductQuizConfigPage />} />
              <Route path="assets/product/:productLineId/images" element={<ProductImagesManagePage />} />
              <Route path="assets/product/:productLineId/docs" element={<ProductDocsManagePage />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="users" replace />} />
              <Route path="users" element={<AdminDashboard tab="users" />} />
              <Route path="config" element={<AdminDashboard tab="config" />} />
              <Route path="team" element={<TeamListPage />} />
              <Route path="team/:id" element={<ReportDetailPage />} />
              <Route path="team/:id/debrief" element={<DebriefReportPage />} />
              <Route path="knowledge" element={<AdminDashboard tab="knowledge" />} />
              <Route path="knowledge/material/:materialId/quiz" element={<MaterialQuizManagePage />} />
              <Route path="learning/material/:materialId" element={<MaterialPreviewPage />} />
              <Route path="assets" element={<ProductMaterialsView basePath="/admin/assets/product" allowCreateLine={true} />} />
              <Route path="assets/product/:productLineId" element={<ProductAssetsOverviewPage />} />
              <Route path="assets/product/:productLineId/quiz" element={<ProductQuizConfigPage />} />
              <Route path="assets/product/:productLineId/images" element={<ProductImagesManagePage />} />
              <Route path="assets/product/:productLineId/docs" element={<ProductDocsManagePage />} />
            </Route>
          </Route>

          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
