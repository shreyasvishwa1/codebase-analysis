import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'

import { AUTH_BUTTON, AUTH_INPUT, AuthLayout, PasswordField } from '../components/AuthLayout'
import { ErrorMessage } from '../components/ErrorMessage'
import { useAuth } from '../hooks/useAuth'
import { getErrorMessage } from '../services/client'

const DEFAULT_AFTER_SIGN_IN = '/projects'

/** Where to go after signing in: only a path on this site. Anything else ("//host",
 * "/\\host", "https://...", a backslash or a control character) falls back to the projects,
 * so the redirect can never be turned into an open redirect. */
export function safeReturnPath(from: unknown): string {
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) {
    return DEFAULT_AFTER_SIGN_IN
  }
  if (/[\\\u0000-\u001f\u007f]/.test(from)) return DEFAULT_AFTER_SIGN_IN
  return from
}

export function LoginPage() {
  const { status, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { from?: unknown; notice?: string } | null
  const from = safeReturnPath(state?.from)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'authenticated') {
    return <Navigate to={from} replace />
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(getErrorMessage(err, 'Sign-in failed'))
    } finally {
      setPassword('')
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
        <p className="text-sm text-slate-400">Welcome back. Pick up where you left off.</p>
      </div>
      {state?.notice && (
        <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
          {state.notice}
        </p>
      )}
      <form onSubmit={onSubmit} className="space-y-4" aria-label="Sign in">
        <label className="block text-sm">
          <span className="font-medium text-slate-300">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            className={AUTH_INPUT}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <PasswordField
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-indigo-300 hover:text-indigo-200 hover:underline">
            Forgot your password?
          </Link>
        </div>
        <ErrorMessage message={error} />
        <button type="submit" disabled={submitting} className={AUTH_BUTTON}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="text-center text-sm text-slate-400">
        No account?{' '}
        <Link to="/register" className="font-medium text-indigo-300 hover:underline">
          Create one
        </Link>
      </p>
    </AuthLayout>
  )
}
