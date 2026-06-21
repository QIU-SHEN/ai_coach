import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAppStore } from './store/useAppStore';
import { ProtectedRoute } from './components/ProtectedRoute';
import { EmployeeLayout } from './layouts/EmployeeLayout';
import { ManagerLayout } from './layouts/ManagerLayout';
import { AdminLayout } from './layouts/AdminLayout';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { UploadPage } from './pages/sales/UploadPage';
import { PracticeSessionPage } from './pages/sales/PracticeSessionPage';
import { DialogueTrainingPage } from './pages/sales/DialogueTrainingPage';
import { MaterialPreviewPage } from './pages/employee/MaterialPreviewPage';
import { DiagnosisLayout } from './pages/diagnosis/DiagnosisLayout';
import { AssessmentPage } from './pages/diagnosis/AssessmentPage';
import { SimulationPage } from './pages/diagnosis/SimulationPage';
import { SimulationChatPage } from './pages/diagnosis/SimulationChatPage';
import { DebriefCenterPage } from './pages/diagnosis/DebriefCenterPage';
import { TrainingPlanPage } from './pages/sales/TrainingPlanPage';
import { TeamListPage } from './pages/manager/TeamListPage';
import { ReportDetailPage } from './pages/manager/ReportDetailPage';

import { AdminDashboard } from './pages/admin/AdminDashboard';
import { EmployeeHomePage } from './pages/employee/EmployeeHomePage';
import { LearningCenterPage } from './pages/employee/LearningCenterPage';
import { LearningDetailPage } from './pages/employee/LearningDetailPage';
import { ProfilePage } from './pages/employee/ProfilePage';
import { DebriefListPage } from './pages/employee/DebriefListPage';
import { DebriefNewPage } from './pages/employee/DebriefNewPage';
import { DebriefReportPage } from './pages/employee/DebriefReportPage';
import { ProductOverviewPage } from './pages/employee/ProductOverviewPage';
import { ProductQuizPage } from './pages/employee/ProductQuizPage';
import { ProductImagesPage } from './pages/employee/ProductImagesPage';
import { ProductDocsPage } from './pages/employee/ProductDocsPage';
import { ProductMaterialsView } from './components/ProductMaterialsView';
import { ProductAssetsOverviewPage } from './pages/manager/ProductAssetsOverviewPage';
import { ProductImagesManagePage } from './pages/manager/ProductImagesManagePage';
import { ProductDocsManagePage } from './pages/manager/ProductDocsManagePage';
import { ProductQuizConfigPage } from './pages/manager/ProductQuizConfigPage';
import { MaterialQuizManagePage } from './pages/manager/MaterialQuizManagePage';

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
            <Route path="monitor" element={<AdminDashboard tab="monitor" />} />
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
  );
}
