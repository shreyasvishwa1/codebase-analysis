import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'
import { IntroPage } from '../pages/IntroPage'
import { BrandMark } from './AuthLayout'

/** Shown for the moment a saved session is being checked: the logo, powering on. */
export function BootSplash() {
  return (
    <div className="pcb-surface flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950">
      <span className="animate-pulse">
        <BrandMark size="lg" />
      </span>
      <p role="status" className="font-mono text-xs text-slate-400">
        Checking your session…
      </p>
    </div>
  )
}

/** Renders protected routes only for signed-in users; others go to /login. */
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') {
    return <BootSplash />
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}

/** The site root: the intro for visitors, the overview for signed-in users. */
export function RootRoute() {
  const { status } = useAuth()
  if (status === 'loading') return <BootSplash />
  if (status === 'authenticated') return <Navigate to="/overview" replace />
  return <IntroPage />
}
