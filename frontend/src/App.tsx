import { Navigate, Route, Routes } from 'react-router-dom'

import { RequireAuth } from './components/RequireAuth'
import { AppShell } from './layouts/AppShell'
import { ArchitecturePage } from './pages/ArchitecturePage'
import { CodeAnalysisPage } from './pages/CodeAnalysisPage'
import { ComplexityPage } from './pages/ComplexityPage'
import { DependenciesPage } from './pages/DependenciesPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { HealthPage } from './pages/HealthPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { OverviewPage } from './pages/OverviewPage'
import { ProjectPage } from './pages/ProjectPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { RegisterPage } from './pages/RegisterPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { RepositoryAnalysisPage } from './pages/RepositoryAnalysisPage'
import { RepositoryArchitecturePage } from './pages/RepositoryArchitecturePage'
import { RepositoryCodeAnalysisPage } from './pages/RepositoryCodeAnalysisPage'
import { RepositoryComplexityPage } from './pages/RepositoryComplexityPage'
import { RepositoryDependenciesPage } from './pages/RepositoryDependenciesPage'
import { RepositoryHealthPage } from './pages/RepositoryHealthPage'
import { RepositoryPage } from './pages/RepositoryPage'
import { RepositorySecurityPage } from './pages/RepositorySecurityPage'
import { SecurityPage } from './pages/SecurityPage'
import { UploadPage } from './pages/UploadPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/code-analysis" element={<CodeAnalysisPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/complexity" element={<ComplexityPage />} />
          <Route path="/dependencies" element={<DependenciesPage />} />
          <Route path="/architecture" element={<ArchitecturePage />} />
          <Route path="/health-score" element={<HealthPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectPage />} />
          <Route
            path="/projects/:projectId/repositories/:repositoryId"
            element={<RepositoryPage />}
          />
          <Route
            path="/projects/:projectId/repositories/:repositoryId/analysis"
            element={<RepositoryAnalysisPage />}
          />
          <Route
            path="/projects/:projectId/repositories/:repositoryId/code-analysis"
            element={<RepositoryCodeAnalysisPage />}
          />
          <Route
            path="/projects/:projectId/repositories/:repositoryId/security"
            element={<RepositorySecurityPage />}
          />
          <Route
            path="/projects/:projectId/repositories/:repositoryId/complexity"
            element={<RepositoryComplexityPage />}
          />
          <Route
            path="/projects/:projectId/repositories/:repositoryId/dependencies"
            element={<RepositoryDependenciesPage />}
          />
          <Route
            path="/projects/:projectId/repositories/:repositoryId/architecture"
            element={<RepositoryArchitecturePage />}
          />
          <Route
            path="/projects/:projectId/repositories/:repositoryId/health"
            element={<RepositoryHealthPage />}
          />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
