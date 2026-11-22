import { Link } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'

/** Unknown address: a way home for everyone, and to the projects for a signed-in user. */
export function NotFoundPage() {
  const { status } = useAuth()
  return (
    <div className="mx-auto mt-24 max-w-sm space-y-4 px-6 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="text-sm text-slate-400">The address may be mistyped, or the page has moved.</p>
      <div className="flex justify-center gap-5">
        <Link to="/" className="text-indigo-300 hover:underline">
          Back to home
        </Link>
        {status === 'authenticated' && (
          <Link to="/projects" className="text-indigo-300 hover:underline">
            Go to projects
          </Link>
        )}
      </div>
    </div>
  )
}
