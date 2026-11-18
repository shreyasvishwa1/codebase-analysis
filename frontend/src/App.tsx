import { Route, Routes } from 'react-router-dom'

import { RequireAuth } from './components/RequireAuth'
import { AppShell } from './layouts/AppShell'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { IntroPage } from './pages/IntroPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { RegisterPage } from './pages/RegisterPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { Pages } from './routes/pages'

const REPOSITORY = '/projects/:projectId/repositories/:repositoryId'

/** The intro (at / and /welcome) and the sign-in pages load with the app; every signed-in page loads on first use
 * (and in the background once the browser is idle), with a skeleton while it arrives. */
export default function App() {
  return (
    <Routes>
      {/* The intro is the front door for everyone; signed-in users get "Open the app". */}
      <Route path="/" element={<IntroPage />} />
      <Route path="/welcome" element={<IntroPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/overview" element={<Pages.OverviewPage />} />
          <Route path="/upload" element={<Pages.UploadPage />} />
          <Route path="/code-analysis" element={<Pages.CodeAnalysisPage />} />
          <Route path="/security" element={<Pages.SecurityPage />} />
          <Route path="/complexity" element={<Pages.ComplexityPage />} />
          <Route path="/dependencies" element={<Pages.DependenciesPage />} />
          <Route path="/architecture" element={<Pages.ArchitecturePage />} />
          <Route path="/health-score" element={<Pages.HealthPage />} />
          <Route path="/chat" element={<Pages.ChatPage />} />
          <Route path="/history" element={<Pages.HistoryPage />} />
          <Route path="/settings" element={<Pages.SettingsPage />} />
          <Route path="/projects" element={<Pages.ProjectsPage />} />
          <Route path="/projects/:projectId" element={<Pages.ProjectPage />} />
          <Route path={REPOSITORY} element={<Pages.RepositoryPage />} />
          <Route path={`${REPOSITORY}/analysis`} element={<Pages.RepositoryAnalysisPage />} />
          <Route path={`${REPOSITORY}/code-analysis`} element={<Pages.RepositoryCodeAnalysisPage />} />
          <Route path={`${REPOSITORY}/security`} element={<Pages.RepositorySecurityPage />} />
          <Route path={`${REPOSITORY}/complexity`} element={<Pages.RepositoryComplexityPage />} />
          <Route path={`${REPOSITORY}/dependencies`} element={<Pages.RepositoryDependenciesPage />} />
          <Route path={`${REPOSITORY}/architecture`} element={<Pages.RepositoryArchitecturePage />} />
          <Route path={`${REPOSITORY}/health`} element={<Pages.RepositoryHealthPage />} />
          <Route path={`${REPOSITORY}/chat`} element={<Pages.RepositoryChatPage />} />
          <Route path={`${REPOSITORY}/history`} element={<Pages.RepositoryHistoryPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
